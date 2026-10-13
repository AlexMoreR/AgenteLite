import { Prisma } from "@prisma/client";

import { rangoDeSemana } from "@/features/embudo/dominio/semanal";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

import { claseDeSeguimiento, type EventoDelLead, type LeadDeRecuperacion } from "../dominio/semana";

/**
 * Lo que lee la pantalla "Semana" de Recuperación (/cliente/crm/recuperacion). Definiciones en
 * dominio/semana.ts.
 *
 * DOS consultas por semana, acotadas por negocio y fechas:
 *  1. Los leads: chats con algún entrante en la semana (índice Message[workspaceId, createdAt]),
 *     de líneas SALES del negocio, cuyo PRIMER entrante cae en la semana (índice
 *     Message[conversationId, createdAt]); con su etapa y su último entrante (mismo índice, un salto).
 *  2. Sus entrantes y sus seguimientos automáticos de la semana + 7 días (índice
 *     Message[conversationId, createdAt]). El seguimiento "follow" se clasifica con el Follow del
 *     contacto ejecutado entre −3 min y +1 min del mensaje (índice Follow[workspaceId, contactId, …]).
 * Se guarda 10 minutos en memoria por negocio y semana: la semana anterior (comparación) también.
 */

const TTL_MS = 10 * 60_000;
/** Los seguimientos de un lead del domingo siguen saliendo después: se mira la semana + 7 días. */
const COLA_MS = 7 * 86_400_000;

export type LecturaDeRecuperacion = { lunes: string; leads: LeadDeRecuperacion[]; ms: number };

const cache = new CacheConTtl<LecturaDeRecuperacion>({ ttlMs: TTL_MS, maxEntradas: 40 });

type FilaLead = { id: string; contactId: string; crmStage: string | null; ultimoIn: Date | null };
type FilaEvento = { conversationId: string; direction: string; origen: string | null; follow: string | null; createdAt: Date };

export function leerSemanaDeRecuperacion(workspaceId: string, lunes: string): Promise<LecturaDeRecuperacion> {
  return cache.obtener(`${workspaceId}:${lunes}`, () => cargar(workspaceId, lunes));
}

async function cargar(workspaceId: string, lunes: string): Promise<LecturaDeRecuperacion> {
  const empezo = Date.now();
  const { inicio, fin } = rangoDeSemana(lunes);
  const hasta = new Date(fin.getTime() + COLA_MS);

  const filas = await prisma.$queryRaw<FilaLead[]>(Prisma.sql`
    WITH cand AS MATERIALIZED (
      SELECT DISTINCT m."conversationId"
      FROM "Message" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${inicio} AND m."createdAt" < ${fin}
        AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."isStatusBroadcast" = false
    ),
    leads AS MATERIALIZED (
      SELECT c."id", c."contactId"
      FROM cand
      JOIN "Conversation" c ON c."id" = cand."conversationId" AND c."workspaceId" = ${workspaceId}
      JOIN "WhatsAppChannel" w ON w."id" = c."channelId" AND w."workspaceId" = ${workspaceId} AND w."purpose" = 'SALES'
      JOIN LATERAL (
        SELECT min(m."createdAt") AS "primer" FROM "Message" m
        WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM'
      ) p ON true
      WHERE p."primer" >= ${inicio} AND p."primer" < ${fin}
    )
    SELECT l."id", l."contactId", ct."crmStage"::text AS "crmStage",
           (SELECT max(m."createdAt") FROM "Message" m
             WHERE m."conversationId" = l."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM') AS "ultimoIn"
    FROM leads l
    JOIN "Contact" ct ON ct."id" = l."contactId"
  `);

  const ids = filas.map((fila) => fila.id);
  const eventos = ids.length
    ? await prisma.$queryRaw<FilaEvento[]>(Prisma.sql`
        SELECT m."conversationId", m."direction"::text AS "direction", m."rawPayload"->>'source' AS "origen",
               f."name" AS "follow", m."createdAt"
        FROM "Message" m
        JOIN "Conversation" c ON c."id" = m."conversationId"
        LEFT JOIN LATERAL (
          SELECT fo."name" FROM "Follow" fo
          WHERE m."rawPayload"->>'source' = 'follow'
            AND fo."workspaceId" = ${workspaceId} AND fo."contactId" = c."contactId"
            AND fo."executedAt" >= m."createdAt" - interval '3 minutes'
            AND fo."executedAt" <= m."createdAt" + interval '1 minute'
          ORDER BY abs(extract(epoch FROM (fo."executedAt" - m."createdAt")))
          LIMIT 1
        ) f ON true
        WHERE m."conversationId" = ANY(${ids})
          AND m."createdAt" >= ${inicio} AND m."createdAt" < ${hasta}
          AND m."type" <> 'SYSTEM'
          AND (m."direction" = 'INBOUND' OR m."rawPayload"->>'source' IN ('follow', 'agente-v3-seguimiento'))
      `)
    : [];

  const porChat = new Map<string, EventoDelLead[]>();
  for (const fila of eventos) {
    let evento: EventoDelLead | null = null;
    if (fila.direction === "INBOUND") {
      evento = { tipo: "IN", en: fila.createdAt };
    } else {
      const clase = claseDeSeguimiento(fila.origen, fila.follow);
      if (clase) evento = { tipo: "SEG", clase, en: fila.createdAt };
    }
    if (!evento) continue;
    const lista = porChat.get(fila.conversationId) ?? [];
    lista.push(evento);
    porChat.set(fila.conversationId, lista);
  }

  const leads = filas.map(
    (fila): LeadDeRecuperacion => ({
      conversationId: fila.id,
      ganado: fila.crmStage === "GANADO",
      ultimoClienteEn: fila.ultimoIn ? new Date(fila.ultimoIn) : null,
      eventos: porChat.get(fila.id) ?? [],
    }),
  );
  return { lunes, leads, ms: Date.now() - empezo };
}
