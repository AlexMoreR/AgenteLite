"use server";

import { auth } from "@/auth";
import { ORIGEN_EN_ESPERA, ORIGEN_FIN_DE_ESPERA } from "@/features/supervisor/dominio/detectores-atencion";
import { leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * Botón "En espera" del chat: la asesora avisa que está averiguando algo (por ejemplo un precio) y el
 * Supervisor no le manda recordatorios ni avisa al Supervisor, ni le quita el chat, hasta que ella vuelva
 * a escribirle al cliente, lo quite o pasen las horas de espera (4 por defecto).
 *
 * Se guarda como una nota del sistema en el chat (no hace falta un campo nuevo en la base): la última
 * nota con `origen` "en-espera" (poner) o "en-espera-fin" (quitar) manda. No se le escribe al cliente.
 */

type EstadoDeEspera = { enEspera: boolean; hasta: string | null };

const hora = (fecha: Date) => fecha.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });

async function contexto(conversationId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) return null;
  await requireClientWorkspaceAccess("chats");
  const id = conversationId?.trim();
  if (!id) return null;
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return null;
  const workspaceId = membership.workspace.id;
  const conversation = await prisma.conversation.findFirst({
    where: { id, workspaceId },
    select: { id: true, channelId: true, contactId: true },
  });
  if (!conversation) return null;
  const { esperaHoras } = await leerConfigReasignacion(workspaceId);
  return { session, workspaceId, conversation, esperaHoras, nombre: session.user.name?.trim() || "Una asesora" };
}

/** La espera vigente del chat: la última nota es la de poner, no se venció y nadie le ha escrito al cliente desde entonces. */
async function esperaVigente(conversationId: string, esperaHoras: number, ahora = new Date()): Promise<{ desde: Date; hasta: Date } | null> {
  const nota = await prisma.message.findFirst({
    where: {
      conversationId,
      type: "SYSTEM",
      OR: [{ rawPayload: { path: ["origen"], equals: ORIGEN_EN_ESPERA } }, { rawPayload: { path: ["origen"], equals: ORIGEN_FIN_DE_ESPERA } }],
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, rawPayload: true },
  });
  if (!nota || (nota.rawPayload as { origen?: unknown } | null)?.origen !== ORIGEN_EN_ESPERA) return null;
  const hasta = new Date(nota.createdAt.getTime() + esperaHoras * 3_600_000);
  if (hasta.getTime() <= ahora.getTime()) return null;
  const escribio = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: nota.createdAt },
      OR: [{ rawPayload: { path: ["source"], equals: "manual" } }, { rawPayload: { path: ["source"], equals: "instance" } }],
    },
    select: { id: true },
  });
  return escribio ? null : { desde: nota.createdAt, hasta };
}

export async function leerChatEnEsperaAction(input: { conversationId: string }): Promise<EstadoDeEspera> {
  const ctx = await contexto(input.conversationId);
  if (!ctx) return { enEspera: false, hasta: null };
  const espera = await esperaVigente(ctx.conversation.id, ctx.esperaHoras);
  return { enEspera: Boolean(espera), hasta: espera ? espera.hasta.toISOString() : null };
}

export async function ponerChatEnEsperaAction(input: { conversationId: string }): Promise<{ error?: string } & Partial<EstadoDeEspera>> {
  const ctx = await contexto(input.conversationId);
  if (!ctx) return { error: "No autorizado" };
  const hasta = new Date(Date.now() + ctx.esperaHoras * 3_600_000);
  await recordConversationActivity({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversation.id,
    channelId: ctx.conversation.channelId,
    contactId: ctx.conversation.contactId,
    kind: "note",
    text: `${ctx.nombre} puso el chat En espera hasta las ${hora(hasta)}`,
    actorUserId: ctx.session.user.id,
    origen: ORIGEN_EN_ESPERA,
  });
  return { enEspera: true, hasta: hasta.toISOString() };
}

export async function quitarChatEnEsperaAction(input: { conversationId: string }): Promise<{ error?: string } & Partial<EstadoDeEspera>> {
  const ctx = await contexto(input.conversationId);
  if (!ctx) return { error: "No autorizado" };
  await recordConversationActivity({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversation.id,
    channelId: ctx.conversation.channelId,
    contactId: ctx.conversation.contactId,
    kind: "note",
    text: `${ctx.nombre} quitó el En espera del chat`,
    actorUserId: ctx.session.user.id,
    origen: ORIGEN_FIN_DE_ESPERA,
  });
  return { enEspera: false, hasta: null };
}
