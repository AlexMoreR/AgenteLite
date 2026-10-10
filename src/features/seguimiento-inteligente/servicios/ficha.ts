import { leerEstado } from "@/features/agente-v3/motor/estado";
import { CLAVE_COMBO } from "@/features/embudo/dominio/combo";
import { prisma } from "@/lib/prisma";
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
      startedAt: true,
      contact: { select: { name: true, phoneNumber: true, metadata: true, crmStage: true } },
    },
  });
  if (!charla) return null;

  const [filas, estado, lead] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, type: { not: "SYSTEM" }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_A_MIRAR,
      select: { direction: true, type: true, content: true, transcripcion: true, createdAt: true, readAt: true, status: true, rawPayload: true, mediaUrl: true },
    }),
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
    origen: ((m.rawPayload as { source?: unknown } | null)?.source as string | undefined) ?? null,
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
      asignadaA: charla.assignedToUserId,
      pais: pais.pais,
      marcaExterior: Boolean(leerMarcaExterior(metadata)) || Boolean(lead?.exterior),
      inicioDeLaCharla: charla.startedAt,
      familiaDelBot,
      flujosEnviados: estado?.flujosEnviados ?? [],
      cotizacion: { en: lead?.cotizacionEn ?? null, ref: lead?.cotizacionRef ?? null, total: null },
      mensajesUtiles: lead?.mensajesUtiles ?? 0,
      mensajes,
    },
  };
}
