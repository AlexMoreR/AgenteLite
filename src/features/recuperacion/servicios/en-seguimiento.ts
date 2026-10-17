import { Prisma } from "@prisma/client";

import { CacheConTtl } from "@/lib/cache-en-memoria";
import { SQL_CHAT_ABIERTO } from "@/lib/chat-resuelto-sql";
import { prisma } from "@/lib/prisma";

import { DIAS_DE_CHATS_ACTIVOS, VENTANA_EN_SEGUIMIENTO_MS, type LeadEnSeguimiento } from "../dominio/en-seguimiento";

/**
 * "EN SEGUIMIENTO AHORA" de Recuperación (definición en dominio/en-seguimiento.ts). Número en vivo.
 *
 * UNA consulta acotada por negocio:
 *  1. `chats`: conversaciones de líneas SALES del negocio con mensaje en los últimos 30 días
 *     (índice Conversation[channelId, lastMessageAt]) y contacto abierto (no Ganado/Perdido).
 *  2. `seg`: por chat, el último entrante (índice Message[conversationId, createdAt], un salto) y los
 *     mensajes automáticos posteriores (mismo índice, rango corto). Se quedan los que tienen ≥ 1 y el
 *     último de hace 72 h o menos.
 *  3. Lo de la lista (nombre, últimos 4, línea, asesora, producto) y si hay un Follow PENDING del
 *     contacto (índice Follow[workspaceId, contactId, status, executeAt]).
 * 5 minutos en memoria por negocio.
 */

const cache = new CacheConTtl<LeadEnSeguimiento[]>({ ttlMs: 5 * 60_000, maxEntradas: 20 });

type Fila = {
  conversationId: string;
  sinRespuesta: bigint | number;
  ultimoSeguimientoEn: Date;
  programado: boolean;
  ultimoClienteEn: Date | null;
  ultimoTexto: string | null;
  ultimoTipo: string | null;
  etapa: string | null;
  nombre: string | null;
  telefono4: string | null;
  linea: string | null;
  asesora: string | null;
  producto: string | null;
};

export function leerEnSeguimientoAhora(workspaceId: string): Promise<LeadEnSeguimiento[]> {
  return cache.obtener(workspaceId, () => cargar(workspaceId));
}

async function cargar(workspaceId: string): Promise<LeadEnSeguimiento[]> {
  const ahora = Date.now();
  const desdeChats = new Date(ahora - DIAS_DE_CHATS_ACTIVOS * 86_400_000);
  const desdeSeguimiento = new Date(ahora - VENTANA_EN_SEGUIMIENTO_MS);
  const filas = await prisma.$queryRaw<Fila[]>(Prisma.sql`
    WITH chats AS MATERIALIZED (
      SELECT c."id", c."contactId", c."channelId", c."assignedToUserId", c."activeProductContext",
             ct."crmStage"::text AS "etapa", ct."name" AS "nombre", ct."phoneNumber" AS "telefono"
      FROM "WhatsAppChannel" w
      JOIN "Conversation" c ON c."channelId" = w."id" AND c."lastMessageAt" > ${desdeChats}
      JOIN "Contact" ct ON ct."id" = c."contactId"
      WHERE w."workspaceId" = ${workspaceId} AND w."purpose" = 'SALES'
        AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
        ${SQL_CHAT_ABIERTO}
    ),
    seg AS MATERIALIZED (
      SELECT ch.*, ui."en" AS "ultimoIn", ui."texto", ui."tipo", s."n", s."ultimo"
      FROM chats ch
      LEFT JOIN LATERAL (
        SELECT m."createdAt" AS "en", left(COALESCE(NULLIF(m."content", ''), m."transcripcion"), 140) AS "texto",
               m."type"::text AS "tipo"
        FROM "Message" m
        WHERE m."conversationId" = ch."id" AND m."direction" = 'INBOUND'
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) ui ON true
      JOIN LATERAL (
        SELECT count(*) AS "n", max(m."createdAt") AS "ultimo"
        FROM "Message" m
        WHERE m."conversationId" = ch."id"
          AND m."createdAt" > COALESCE(ui."en", '2000-01-01'::timestamp)
          AND m."rawPayload"->>'source' IN ('follow', 'agente-v3-seguimiento')
      ) s ON true
      WHERE s."n" > 0 AND s."ultimo" > ${desdeSeguimiento}
    )
    SELECT s."id" AS "conversationId", s."n" AS "sinRespuesta", s."ultimo" AS "ultimoSeguimientoEn",
           EXISTS (
             SELECT 1 FROM "Follow" f
             WHERE f."workspaceId" = ${workspaceId} AND f."contactId" = s."contactId" AND f."status" = 'PENDING'
           ) AS "programado",
           s."ultimoIn" AS "ultimoClienteEn", s."texto" AS "ultimoTexto", s."tipo" AS "ultimoTipo", s."etapa",
           NULLIF(btrim(s."nombre"), '') AS "nombre", right(s."telefono", 4) AS "telefono4",
           w."name" AS "linea", u."name" AS "asesora",
           COALESCE(s."activeProductContext"->>'productName', el."productoActual", el."productoInteres") AS "producto"
    FROM seg s
    JOIN "WhatsAppChannel" w ON w."id" = s."channelId"
    LEFT JOIN "User" u ON u."id" = s."assignedToUserId"
    LEFT JOIN "EmbudoLead" el ON el."conversationId" = s."id"
  `);
  return filas.map((fila) => ({
    conversationId: fila.conversationId,
    sinRespuesta: Number(fila.sinRespuesta),
    ultimoSeguimientoEn: new Date(fila.ultimoSeguimientoEn),
    programado: Boolean(fila.programado),
    ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null,
    ficha: {
      nombre: fila.nombre,
      telefono4: fila.telefono4,
      linea: fila.linea,
      asesora: fila.asesora ? fila.asesora.trim().split(/\s+/)[0] || fila.asesora : null,
      producto: fila.producto,
      etapa: fila.etapa,
      ultimoTexto: fila.ultimoTexto || (fila.ultimoTipo && fila.ultimoTipo !== "TEXT" ? `[${fila.ultimoTipo.toLowerCase()}]` : null),
    },
  }));
}
