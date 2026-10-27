import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { CANAL_ADMIN_ID, agruparPorAnuncio, diaAnterior, type ConversacionDeAnuncio, type NumerosDeAnuncio } from "../dominio/reglas";
import { rangoDelDia } from "./numeros";

/**
 * LOS NÚMEROS DE MARKETING POR ANUNCIO DE ORIGEN (solo lectura): contactos, conversaciones, mensajes y embudo.
 * El CRM guarda el anuncio de origen de cada lead (id y título), no la campaña: el agente une anuncio con
 * campaña leyendo Meta. Las conversaciones sin anuncio no se inventan: salen contadas aparte, con su porcentaje.
 */

const MAX_CONVERSACIONES = 2000;
const MAX_CHATS_CON_MENSAJES = 300;
const MENSAJES_POR_CHAT = 3;
const LARGO_DEL_MENSAJE = 200;

type FilaDeLead = {
  conversationId: string;
  anuncioId: string | null;
  anuncioTitulo: string | null;
  etapa: string;
  temperatura: string | null;
  exterior: boolean;
  wonQuoteRef: string | null;
  minutos: number | null;
};

type FilaDeMensaje = { conversationId: string; anuncioId: string | null; contenido: string | null; orden: bigint | number };

export type PrimerosMensajes = { conversacionId: string; anuncioId: string | null; mensajesDelCliente: string[] };

export type NumerosDeMarketing = {
  desde: string;
  hasta: string;
  porAnuncio: Array<NumerosDeAnuncio & { cotizaciones: string[] }>;
  total: number;
  sinAnuncio: { conversaciones: number; porCiento: number | null };
  /** Solo cuando se pide un día: lo primero que escribió cada cliente, para separar reales de curiosos. */
  primerosMensajes: PrimerosMensajes[] | null;
  advertencias: string[];
};


/** Los últimos `dias` días terminando en `fecha` (incluida), en hora de Colombia. */
export function rangoDeDias(fecha: string, dias: number): { desde: Date; hasta: Date; primero: string } {
  let primero = fecha;
  for (let i = 1; i < dias; i += 1) primero = diaAnterior(primero);
  return { desde: rangoDelDia(primero).desde, hasta: rangoDelDia(fecha).hasta, primero };
}

export async function numerosDeMarketing(workspaceId: string, fecha: string, dias: number): Promise<NumerosDeMarketing> {
  const { desde, hasta, primero } = rangoDeDias(fecha, dias);

  const filas = await prisma.$queryRaw<FilaDeLead[]>(Prisma.sql`
    SELECT e."conversationId" AS "conversationId", e."anuncioId" AS "anuncioId", e."anuncioTitulo" AS "anuncioTitulo",
           ct."crmStage"::text AS "etapa", e."temperatura" AS "temperatura", e."exterior" AS "exterior",
           ct."wonQuoteRef" AS "wonQuoteRef",
           CASE WHEN e."primeraRespuestaAsesoraEn" IS NULL THEN NULL
                ELSE GREATEST(EXTRACT(EPOCH FROM (e."primeraRespuestaAsesoraEn" - e."entradaEn")) / 60.0, 0) END AS "minutos"
      FROM "EmbudoLead" e
      JOIN "Contact" ct ON ct."id" = e."contactId"
      LEFT JOIN "WhatsAppChannel" w ON w."id" = e."channelId"
     WHERE e."workspaceId" = ${workspaceId}
       AND e."channelId" <> ${CANAL_ADMIN_ID}
       AND (w."purpose" IS NULL OR w."purpose" <> 'ADMIN')
       AND e."entradaEn" >= ${desde} AND e."entradaEn" < ${hasta}
     ORDER BY e."entradaEn" DESC
     LIMIT ${MAX_CONVERSACIONES}`);

  const conversaciones: ConversacionDeAnuncio[] = filas.map((fila) => ({
    anuncioId: fila.anuncioId,
    anuncioTitulo: fila.anuncioTitulo,
    etapa: fila.etapa,
    temperatura: fila.temperatura,
    exterior: Boolean(fila.exterior),
    minutosPrimeraRespuesta: fila.minutos === null || fila.minutos === undefined ? null : Math.round(Number(fila.minutos)),
  }));
  const agrupado = agruparPorAnuncio(conversaciones);

  const cotizaciones = new Map<string, string[]>();
  for (const fila of filas) {
    if (fila.etapa !== "GANADO" || !fila.anuncioId) continue;
    cotizaciones.set(fila.anuncioId, [...(cotizaciones.get(fila.anuncioId) ?? []), fila.wonQuoteRef ?? "sin cotización"]);
  }

  // Lo primero que escribió cada cliente: solo cuando se mira UN día (para Calidad del Lead).
  let primerosMensajes: PrimerosMensajes[] | null = null;
  if (dias === 1 && filas.length) {
    const ids = filas.slice(0, MAX_CHATS_CON_MENSAJES).map((fila) => fila.conversationId);
    const mensajes = await prisma.$queryRaw<FilaDeMensaje[]>(Prisma.sql`
      SELECT x."conversationId", x."anuncioId", x."contenido", x."orden"
        FROM (
          SELECT m."conversationId" AS "conversationId", e."anuncioId" AS "anuncioId",
                 left(m."content", ${LARGO_DEL_MENSAJE}) AS "contenido",
                 row_number() OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt" ASC) AS "orden"
            FROM "Message" m
            JOIN "EmbudoLead" e ON e."conversationId" = m."conversationId"
           WHERE m."workspaceId" = ${workspaceId} AND m."direction" = 'INBOUND'
             AND m."conversationId" IN (${Prisma.join(ids)})
             AND m."content" IS NOT NULL AND m."deletedAt" IS NULL) x
       WHERE x."orden" <= ${MENSAJES_POR_CHAT}
       ORDER BY x."conversationId", x."orden"`);
    const porChat = new Map<string, PrimerosMensajes>();
    for (const fila of mensajes) {
      if (!fila.contenido?.trim()) continue;
      const actual = porChat.get(fila.conversationId) ?? { conversacionId: fila.conversationId, anuncioId: fila.anuncioId, mensajesDelCliente: [] };
      actual.mensajesDelCliente.push(fila.contenido.trim());
      porChat.set(fila.conversationId, actual);
    }
    primerosMensajes = [...porChat.values()];
  }

  const advertencias = [
    "El CRM guarda el ANUNCIO de origen (id y título), no la campaña: la campaña se une leyendo Meta (cada anuncio dice de cuál es).",
    "Las ventas son leads en etapa GANADO (con su cotización de Gestión); el dinero se confirma en el MCP de Gestión.",
    "Sin respuesta = la asesora no le escribió nunca; no es lo mismo que un lead malo.",
  ];
  if (agrupado.sinAnuncio.porCiento !== null && agrupado.sinAnuncio.porCiento >= 20) {
    advertencias.push(`${agrupado.sinAnuncio.porCiento} % de las conversaciones no tiene anuncio de origen: el costo por venta sale incompleto y no se debe inventar.`);
  }
  if (filas.length >= MAX_CONVERSACIONES) advertencias.push(`Hay más de ${MAX_CONVERSACIONES} conversaciones en el rango: solo se contaron las más recientes.`);

  return {
    desde: primero,
    hasta: fecha,
    porAnuncio: agrupado.porAnuncio.map((fila) => ({ ...fila, cotizaciones: fila.anuncioId ? cotizaciones.get(fila.anuncioId) ?? [] : [] })),
    total: agrupado.total,
    sinAnuncio: agrupado.sinAnuncio,
    primerosMensajes,
    advertencias,
  };
}

