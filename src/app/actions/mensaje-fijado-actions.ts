"use server";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { idDeConversacionValido, puedeAbrirChatPorClave } from "@/lib/chats-acceso-por-enlace";
import { AVISO_MODO_MONITOREO, canalesQueMonitorea, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/*
  Fijar (o desfijar) un mensaje del chat. Es SOLO del CRM: se guarda en la conversacion y no se llama
  a WhatsApp, Evolution, WAHA ni Meta; la clienta no ve nada. Uno por chat: fijar otro reemplaza al
  anterior. messageId null = desfijar.

  Se puede fijar en cualquier chat que la persona puede abrir (la misma regla que /live). El id llega
  sin decir de que canal es: se busca primero en Conversation y despues en la API oficial, siempre
  dentro del negocio.
*/
export async function fijarMensajeAction(input: {
  conversationId: string;
  messageId: string | null;
}): Promise<{ ok: boolean; error?: string; mensajeFijadoId?: string | null }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }
  const access = await requireClientWorkspaceAccess("chats");
  const workspaceId = access.workspaceId;
  const userId = session.user.id;

  if (await estaEnModoMonitoreo({ workspaceId, userId })) {
    return { ok: false, error: AVISO_MODO_MONITOREO };
  }

  const conversationId = typeof input.conversationId === "string" ? input.conversationId.trim() : "";
  if (!idDeConversacionValido(conversationId)) {
    return { ok: false, error: "Chat invalido" };
  }
  const rawMessageId = input.messageId;
  if (rawMessageId !== null && typeof rawMessageId !== "string") {
    return { ok: false, error: "Mensaje invalido" };
  }
  const messageId = rawMessageId === null ? null : rawMessageId.trim();
  if (messageId !== null && !idDeConversacionValido(messageId)) {
    return { ok: false, error: "Mensaje invalido" };
  }

  // De que canal es el chat (siempre dentro de este negocio).
  const [chatViejo, chatOficial] = await Promise.all([
    prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } }),
    prisma.officialApiConversation.findFirst({
      where: { id: conversationId, config: { workspaceId } },
      select: { id: true, configId: true },
    }),
  ]);
  const fuente = chatViejo ? "agent" : chatOficial ? "official" : null;
  if (!fuente) {
    return { ok: false, error: "Conversacion no encontrada" };
  }

  // La misma regla que /live para abrir el chat. Si no puede, se contesta como si no existiera.
  const [canalesMonitoreados, esJefe, canalesVisibles] = await Promise.all([
    canalesQueMonitorea({ workspaceId, userId }),
    esJefeDelNegocio(access) ? Promise.resolve(true) : esSupervisora(workspaceId, userId),
    getVisibleChannelIds({ workspaceId, userId, esJefe: access.isOwner || access.role === "ADMIN" }),
  ]);
  const permitido = await puedeAbrirChatPorClave({
    workspaceId,
    userId,
    fuente,
    conversationId,
    esJefe,
    canalesVisibles,
    canalesMonitoreados,
  });
  if (!permitido) {
    return { ok: false, error: "Conversacion no encontrada" };
  }

  if (fuente === "agent") {
    if (messageId) {
      // El mensaje tiene que ser de ESTE chat y de este negocio, y no estar eliminado.
      const mensaje = await prisma.message.findFirst({
        where: { id: messageId, conversationId, workspaceId },
        select: { id: true, deletedAt: true },
      });
      if (!mensaje) {
        return { ok: false, error: "Mensaje no encontrado" };
      }
      if (mensaje.deletedAt) {
        return { ok: false, error: "Ese mensaje se eliminó" };
      }
    }
    await prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId },
      data: { mensajeFijadoId: messageId },
    });
    return { ok: true, mensajeFijadoId: messageId };
  }

  const configId = chatOficial!.configId;
  if (messageId) {
    const mensaje = await prisma.officialApiMessage.findFirst({
      where: { id: messageId, conversationId, configId },
      select: { id: true },
    });
    if (!mensaje) {
      return { ok: false, error: "Mensaje no encontrado" };
    }
  }
  await prisma.officialApiConversation.updateMany({
    where: { id: conversationId, configId },
    data: { mensajeFijadoId: messageId },
  });
  return { ok: true, mensajeFijadoId: messageId };
}
