import type { MessageDirection, MessageStatus, MessageType } from "@prisma/client";

import { leerEstado } from "@/features/agente-v3/motor/estado";
import { CLAVE_COMBO } from "@/features/embudo/dominio/combo";
import { estaResuelto } from "@/lib/chat-resuelto";
import { prisma } from "@/lib/prisma";
import { isSnoozed } from "@/lib/lead-snooze";
import { isMarkedAsLid, readDiscoveredPhone } from "@/lib/whatsapp-lid";

import { leerMarcaExterior, paisDelTelefono } from "../dominio/exterior";
import type { FichaDelLead, MensajeCrudo } from "../dominio/motor";
import { familiaDelTexto } from "../dominio/producto";

/**
 * La FICHA de un lead para el motor, leída de la base (solo lectura). Lo pesado es el historial:
 * los últimos 80 mensajes, sin notas del sistema, con el índice conversación+fecha.
 */

export type FichaConContexto = {
  ficha: FichaDelLead;
  workspaceId: string;
  channelId: string | null;
  contactId: string;
  lead: {
    temperatura: string | null;
    puntaje: number | null;
    productoInteres: string | null;
    accionDatos: Record<string, unknown> | null;
    mensajesUtiles: number;
    exterior: boolean;
  } | null;
};

const MENSAJES_A_MIRAR = 80;
const NOTAS_A_MIRAR = 30;

/** Las filas de los mensajes: las columnas de siempre más el origen del rawPayload, sin el JSON entero. */
type FilaDeNota = {
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  createdAt: Date;
  origen: string | null;
};
type FilaDeLaFicha = FilaDeNota & {
  transcripcion: string | null;
  readAt: Date | null;
  status: MessageStatus;
  mediaUrl: string | null;
};

async function familiaDelProductoDelBot(workspaceId: string, productoId: string | null, claveDelEmbudo: string | null): Promise<string | null> {
  if (claveDelEmbudo === CLAVE_COMBO) return CLAVE_COMBO;
  const id = productoId ?? claveDelEmbudo;
  if (!id) return null;
  const producto = await prisma.product.findFirst({ where: { id, workspaceId }, select: { name: true } }).catch(() => null);
  return producto ? familiaDelTexto(producto.name) : null;
}

export async function leerFicha(conversationId: string): Promise<FichaConContexto | null> {
  const charla = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      workspaceId: true,
      channelId: true,
      contactId: true,
      assignedToUserId: true,
      automationPaused: true,
      automationPausedAt: true,
      startedAt: true,
      status: true,
      contact: { select: { name: true, phoneNumber: true, metadata: true, crmStage: true } },
    },
  });
  if (!charla) return null;

  const [filas, estado, lead] = await Promise.all([
    // Del rawPayload solo se pide el origen (`source`): el JSON entero a veces trae fotos o audios en base64.
    prisma.$queryRaw<FilaDeLaFicha[]>`
      SELECT m."direction"::text AS "direction", m."type"::text AS "type", m."content", m."transcripcion",
             m."createdAt", m."readAt", m."status"::text AS "status", m."mediaUrl", m."rawPayload"->>'source' AS origen
        FROM "Message" m
       WHERE m."conversationId" = ${conversationId} AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
       ORDER BY m."createdAt" DESC
       LIMIT ${MENSAJES_A_MIRAR}`,
    leerEstado(conversationId).catch(() => null),
    prisma.embudoLead
      .findUnique({
        where: { conversationId },
        select: {
          productoEntrada: true,
          productoActual: true,
          cotizacionEn: true,
          cotizacionRef: true,
          temperatura: true,
          puntaje: true,
          productoInteres: true,
          accionDatos: true,
          mensajesUtiles: true,
          exterior: true,
          pasoMaximo: true,
          anticipoEn: true,
        },
      })
      .catch(() => null),
  ]);

  const mensajes: MensajeCrudo[] = filas.reverse().map((m) => ({
    direccion: m.direction === "INBOUND" ? "IN" : "OUT",
    tipo: m.type,
    texto: m.direction === "INBOUND" ? (m.transcripcion?.trim() || m.content) : m.content,
    en: m.createdAt,
    leidoEn: m.readAt,
    estado: m.status,
    origen: m.origen ?? null,
    media: m.mediaUrl,
  }));

  const metadata = charla.contact?.metadata ?? null;
  const pais = paisDelTelefono({
    telefono: charla.contact?.phoneNumber,
    esLid: isMarkedAsLid(metadata),
    telefonoDescubierto: readDiscoveredPhone(metadata),
  });
  const familiaDelBot = await familiaDelProductoDelBot(
    charla.workspaceId,
    estado?.productoActivo ?? null,
    lead?.productoActual ?? lead?.productoEntrada ?? null,
  );

  return {
    workspaceId: charla.workspaceId,
    channelId: charla.channelId,
    contactId: charla.contactId,
    lead: lead
      ? {
          temperatura: lead.temperatura,
          puntaje: lead.puntaje,
          productoInteres: lead.productoInteres,
          accionDatos: lead.accionDatos && typeof lead.accionDatos === "object" && !Array.isArray(lead.accionDatos) ? (lead.accionDatos as Record<string, unknown>) : null,
          mensajesUtiles: lead.mensajesUtiles,
          exterior: lead.exterior,
        }
      : null,
    ficha: {
      conversationId,
      nombre: charla.contact?.name ?? null,
      etapaCrm: charla.contact?.crmStage ?? null,
      pausado: Boolean(charla.automationPaused),
      resuelto: estaResuelto(charla.status),
      asignadaA: charla.assignedToUserId,
      pais: pais.pais,
      marcaExterior: Boolean(leerMarcaExterior(metadata)) || Boolean(lead?.exterior),
      inicioDeLaCharla: charla.startedAt,
      familiaDelBot,
      flujosEnviados: estado?.flujosEnviados ?? [],
      cotizacion: { en: lead?.cotizacionEn ?? null, ref: lead?.cotizacionRef ?? null, total: null },
      mensajesUtiles: lead?.mensajesUtiles ?? 0,
      mensajes,
      pausadoEn: charla.automationPausedAt ?? null,
      pasoMaximo: lead?.pasoMaximo ?? null,
      anticipoEn: lead?.anticipoEn ?? null,
      historialCompleto: filas.length < MENSAJES_A_MIRAR,
      pospuesto: isSnoozed(metadata),
    },
  };
}

/**
 * Las notas del sistema recientes de un chat (para el TURNO de la conversación: "El agente pide un
 * asesor…", llamadas). Solo se leen con el interruptor `turno:config` prendido.
 */
export async function leerNotasDelTurno(conversationId: string): Promise<MensajeCrudo[]> {
  const filas = await prisma.$queryRaw<FilaDeNota[]>`
    SELECT m."direction"::text AS "direction", m."type"::text AS "type", m."content", m."createdAt",
           m."rawPayload"->>'source' AS origen
      FROM "Message" m
     WHERE m."conversationId" = ${conversationId} AND m."type" = 'SYSTEM' AND m."deletedAt" IS NULL
     ORDER BY m."createdAt" DESC
     LIMIT ${NOTAS_A_MIRAR}`;
  return filas.reverse().map((m) => ({
    direccion: m.direction === "INBOUND" ? "IN" : "OUT",
    tipo: m.type,
    texto: m.content,
    en: m.createdAt,
    leidoEn: null,
    origen: m.origen ?? null,
  }));
}
