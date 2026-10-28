import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";

import { decidirApagado, type MensajeDelChat, type MotivoDeApagado, type TipoDeSeguimiento } from "../dominio/apagado";

/**
 * Lectura y nota de los seguimientos automáticos que se apagan solos (regla en dominio/apagado.ts).
 *
 * Aquí NO se cancela nada: quien cancela es el motor de seguimientos (cancelarAutomaticosPendientesDelContacto
 * en services/follows.ts), que ya sabe qué es automático y qué no. Este archivo solo mira el chat y deja la
 * nota interna.
 */

const MENSAJES_A_MIRAR = 40;
export const PREFIJO_NOTA_APAGADOS = "Seguimientos apagados: ";

export type RevisionDeApagado = { motivo: MotivoDeApagado; conversationId: string; channelId: string | null } | null;

/** Mira el chat del contacto y dice si sus seguimientos automáticos deben apagarse. Nunca lanza. */
export async function revisarApagadoDelChat(input: {
  workspaceId: string;
  contactId: string;
  channelId?: string | null;
  conversationId?: string | null;
  tipo: TipoDeSeguimiento;
  ahora?: Date;
}): Promise<RevisionDeApagado> {
  try {
    const ahora = input.ahora ?? new Date();
    const charla = await prisma.conversation.findFirst({
      where: input.conversationId
        ? { id: input.conversationId, workspaceId: input.workspaceId }
        : { workspaceId: input.workspaceId, contactId: input.contactId, ...(input.channelId ? { channelId: input.channelId } : {}) },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      select: {
        id: true,
        channelId: true,
        startedAt: true,
        seguimientosApagados: true,
        contact: { select: { crmStage: true } },
      },
    });
    if (!charla) return null;

    const filas = await prisma.message.findMany({
      where: { conversationId: charla.id, type: { not: "SYSTEM" }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_A_MIRAR,
      select: { direction: true, type: true, content: true, transcripcion: true, createdAt: true, rawPayload: true },
    });
    const mensajes: MensajeDelChat[] = filas.reverse().map((m) => ({
      direccion: m.direction === "INBOUND" ? "IN" : "OUT",
      tipo: m.type,
      texto: m.direction === "INBOUND" ? m.transcripcion?.trim() || m.content : m.content,
      en: m.createdAt,
      origen: ((m.rawPayload as { source?: unknown } | null)?.source as string | undefined) ?? null,
    }));

    const motivo = decidirApagado({
      tipo: input.tipo,
      etapaCrm: charla.contact?.crmStage ?? null,
      interruptorApagado: charla.seguimientosApagados,
      mensajes,
      inicioDeLaCharla: charla.startedAt,
      ahora,
    });
    return motivo ? { motivo, conversationId: charla.id, channelId: charla.channelId } : null;
  } catch (error) {
    // Si no se puede leer, se sigue como antes: no se apaga a nadie por un error.
    console.error("[seguimientos] no se pudo revisar el apagado del chat", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * La nota INTERNA en el chat ("Seguimientos apagados: <motivo>"). Es un mensaje SYSTEM que no se le envía al
 * cliente. La misma nota no se repite en 24 h (un mismo motivo apaga varios pendientes en varias vueltas).
 */
export async function anotarSeguimientosApagados(input: {
  workspaceId: string;
  conversationId: string;
  channelId: string | null;
  contactId: string;
  motivo: string;
  actorUserId?: string | null;
}): Promise<boolean> {
  try {
    const texto = `${PREFIJO_NOTA_APAGADOS}${input.motivo}`;
    const repetida = await prisma.message.count({
      where: {
        conversationId: input.conversationId,
        type: "SYSTEM",
        content: texto,
        createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) },
      },
    });
    if (repetida > 0) return false;
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      contactId: input.contactId,
      kind: "note",
      actorUserId: input.actorUserId ?? null,
      text: texto,
    });
    return true;
  } catch (error) {
    console.error("[seguimientos] no se pudo dejar la nota de seguimientos apagados", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
