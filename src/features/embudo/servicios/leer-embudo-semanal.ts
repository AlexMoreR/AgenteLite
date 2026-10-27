import { Prisma } from "@prisma/client";

import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

import {
  VENTANA_DE_MENSAJES_MS,
  familiaDelLead,
  rangoDeSemana,
  type ClaveDeFamilia,
  type LeadSemanal,
  type MensajeDelLead,
} from "../dominio/semanal";

/**
 * Lo que lee la pantalla del embudo semanal (/cliente/direccion/embudo). Ver las definiciones en
 * dominio/semanal.ts.
 *
 * DOS consultas por semana, acotadas:
 *  1. Los leads: chats con algún mensaje entrante en la semana (índice Message[workspaceId,
 *     createdAt]) cuyo PRIMER entrante cae en la semana (índice [conversationId, createdAt]), de las
 *     líneas de ventas, con su contacto, su EmbudoLead y si tiene evento COTIZACION/ANTICIPO.
 *  2. Sus mensajes, solo de esos chats y solo de la entrada a la entrada + 14 días (texto recortado
 *     a 1.500 letras, sin las notas de actividad).
 * Se calcula una vez por semana para TODAS las familias y se guarda 10 minutos en memoria: cambiar
 * de pestaña no vuelve a la base.
 */

export type LeadDeLaSemana = LeadSemanal & { familia: ClaveDeFamilia };

export type LecturaSemanal = {
  lunes: string;
  leads: LeadDeLaSemana[];
  /** Cuánto tardaron las consultas (ms), para medir. */
  ms: number;
};

/** La línea de Marketplace: "Ventas 2" (memoria del negocio: Ventas 2 = Marketplace). */
export const PATRON_LINEA_MARKETPLACE = /ventas\s*2|marketplace/i;

const TTL_MS = 10 * 60_000;
const cache = new CacheConTtl<LecturaSemanal>({ ttlMs: TTL_MS, maxEntradas: 40 });

type FilaLead = {
  id: string;
  canal: string | null;
  primer: Date;
  telefono4: string | null;
  asesora: string | null;
  anuncio: string | null;
  crmStage: string | null;
  wonQuoteRef: string | null;
  productoInteres: string | null;
  productoActual: string | null;
  cotizacionEn: Date | null;
  cotizacionRef: string | null;
  anticipoEn: Date | null;
  ventaEn: Date | null;
  productoV3: string | null;
  eventoCotizacion: boolean | null;
};

type FilaMensaje = {
  conversationId: string;
  direction: string;
  type: string;
  origen: string | null;
  texto: string | null;
  createdAt: Date;
};

export function leerEmbudoSemanal(workspaceId: string, lunes: string): Promise<LecturaSemanal> {
  return cache.obtener(`${workspaceId}:${lunes}`, () => cargarSemana(workspaceId, lunes));
}

async function cargarSemana(workspaceId: string, lunes: string): Promise<LecturaSemanal> {
  const empezo = Date.now();
  const { inicio, fin } = rangoDeSemana(lunes);

  const filas = await prisma.$queryRaw<FilaLead[]>(Prisma.sql`
    WITH cand AS MATERIALIZED (
      SELECT DISTINCT m."conversationId"
      FROM "Message" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${inicio} AND m."createdAt" < ${fin}
        AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."isStatusBroadcast" = false
    ),
    leads AS MATERIALIZED (
      SELECT c."id", c."channelId", c."contactId", c."assignedToUserId", c."activeProductContext", p."primer"
      FROM cand
      JOIN "Conversation" c ON c."id" = cand."conversationId"
      JOIN "WhatsAppChannel" w ON w."id" = c."channelId" AND w."purpose" = 'SALES'
      JOIN LATERAL (
        SELECT min(m."createdAt") AS "primer" FROM "Message" m
        WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM'
      ) p ON true
      WHERE p."primer" >= ${inicio} AND p."primer" < ${fin}
    )
    SELECT l."id", w."name" AS "canal", l."primer",
           right(ct."phoneNumber", 4) AS "telefono4",
           u."name" AS "asesora",
           ct."metadata"->>'adTitle' AS "anuncio",
           ct."crmStage"::text AS "crmStage", ct."wonQuoteRef",
           el."productoInteres", el."productoActual", el."cotizacionEn", el."cotizacionRef", el."anticipoEn", el."ventaEn",
           COALESCE(l."activeProductContext"->>'productName', l."activeProductContext"->>'slug') AS "productoV3",
           EXISTS (
             SELECT 1 FROM "EmbudoEvento" e
             WHERE e."conversationId" = l."id" AND e."tipo" IN ('COTIZACION', 'ANTICIPO')
           ) AS "eventoCotizacion"
    FROM leads l
    JOIN "WhatsAppChannel" w ON w."id" = l."channelId"
    JOIN "Contact" ct ON ct."id" = l."contactId"
    LEFT JOIN "User" u ON u."id" = l."assignedToUserId"
    LEFT JOIN "EmbudoLead" el ON el."conversationId" = l."id"
    WHERE ct."excludedFromCrm" = false AND COALESCE(el."exterior", false) = false
  `);

  const ids = filas.map((fila) => fila.id);
  const hasta = new Date(fin.getTime() + VENTANA_DE_MENSAJES_MS);
  const mensajes = ids.length
    ? await prisma.$queryRaw<FilaMensaje[]>(Prisma.sql`
        SELECT m."conversationId", m."direction"::text AS "direction", m."type"::text AS "type",
               m."rawPayload"->>'source' AS "origen",
               left(COALESCE(NULLIF(m."content", ''), m."transcripcion"), 1500) AS "texto",
               m."createdAt"
        FROM "Message" m
        WHERE m."conversationId" = ANY(${ids})
          AND m."createdAt" >= ${inicio} AND m."createdAt" < ${hasta}
          AND m."type" <> 'SYSTEM'
          AND COALESCE(m."rawPayload"->>'source', '') <> 'activity'
        ORDER BY m."conversationId", m."createdAt"
      `)
    : [];

  const porChat = new Map<string, MensajeDelLead[]>();
  for (const mensaje of mensajes) {
    const lista = porChat.get(mensaje.conversationId) ?? [];
    lista.push({
      direccion: mensaje.direction,
      tipo: mensaje.type,
      origen: mensaje.origen,
      texto: mensaje.texto,
      en: mensaje.createdAt,
    });
    porChat.set(mensaje.conversationId, lista);
  }

  const leads = filas.map((fila): LeadDeLaSemana => {
    const lista = porChat.get(fila.id) ?? [];
    const primerMensaje = lista.find((mensaje) => mensaje.direccion === "INBOUND")?.texto ?? null;
    const datos = {
      esMarketplace: PATRON_LINEA_MARKETPLACE.test(fila.canal ?? ""),
      productoInteres: fila.productoInteres,
      productoActual: fila.productoActual,
      productoV3: fila.productoV3,
      anuncioTitulo: fila.anuncio,
      primerMensaje,
    };
    return {
      ...datos,
      familia: familiaDelLead(datos),
      conversationId: fila.id,
      entradaEn: fila.primer,
      mensajes: lista,
      cotizacionCrm: Boolean(
        fila.cotizacionEn || fila.cotizacionRef || fila.anticipoEn || fila.wonQuoteRef || fila.eventoCotizacion,
      ),
      ventaCrm: fila.crmStage === "GANADO" || Boolean(fila.ventaEn),
      telefono4: fila.telefono4,
      asesora: fila.asesora,
    };
  });

  return { lunes, leads, ms: Date.now() - empezo };
}

export type ChatDeLaFuga = {
  conversationId: string;
  telefono4: string | null;
  asesora: string | null;
  ultimoTexto: string | null;
  ultimoEn: Date | null;
  ultimoDeCliente: boolean;
};

/** El último mensaje de cada chat de la lista "Ver esos chats" (máximo 200 chats). */
export async function chatsDeLaFuga(leads: ReadonlyArray<LeadDeLaSemana>, ids: ReadonlyArray<string>): Promise<ChatDeLaFuga[]> {
  const elegidos = ids.slice(0, 200);
  if (!elegidos.length) return [];
  const ultimos = await prisma.$queryRaw<Array<{ id: string; texto: string | null; en: Date | null; direction: string | null; type: string | null }>>(Prisma.sql`
    SELECT x."id", u."texto", u."en", u."direction", u."type"
    FROM unnest(${[...elegidos]}::text[]) AS x("id")
    LEFT JOIN LATERAL (
      SELECT left(COALESCE(NULLIF(m."content", ''), m."transcripcion"), 140) AS "texto", m."createdAt" AS "en",
             m."direction"::text AS "direction", m."type"::text AS "type"
      FROM "Message" m
      WHERE m."conversationId" = x."id" AND m."type" <> 'SYSTEM'
        AND COALESCE(m."rawPayload"->>'source', '') <> 'activity'
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) u ON true
  `);
  const porId = new Map(ultimos.map((fila) => [fila.id, fila]));
  const leadPorId = new Map(leads.map((lead) => [lead.conversationId, lead]));
  return elegidos.map((id) => {
    const lead = leadPorId.get(id);
    const ultimo = porId.get(id);
    const tipo = (ultimo?.type ?? "TEXT").toUpperCase();
    return {
      conversationId: id,
      telefono4: lead?.telefono4 ?? null,
      asesora: lead?.asesora ?? null,
      ultimoTexto: ultimo?.texto || (ultimo && tipo !== "TEXT" ? `[${tipo.toLowerCase()}]` : null),
      ultimoEn: ultimo?.en ?? null,
      ultimoDeCliente: ultimo?.direction === "INBOUND",
    };
  });
}
