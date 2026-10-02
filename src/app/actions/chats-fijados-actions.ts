"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { MAXIMO_DE_FIJADOS, guardarChatsFijados, leerChatsFijados } from "@/lib/chats-fijados";
import { prisma } from "@/lib/prisma";

/**
 * Fijar o desfijar un chat en la bandeja de quien lo pide (ver lib/chats-fijados).
 *
 * Devuelve la lista completa como quedo, para que la pantalla se ponga al dia sin volver a pedir
 * la bandeja entera.
 */
export async function fijarChatAction(input: {
  chatKey: string;
  fijar: boolean;
}): Promise<{ fijados: string[] } | { error: string }> {
  const access = await requireClientWorkspaceAccess("chats");

  const chatKey = typeof input.chatKey === "string" ? input.chatKey.trim() : "";
  const partes = /^(agent|official):(.+)$/.exec(chatKey);
  if (!partes) {
    return { error: "Chat no valido" };
  }

  const actuales = await leerChatsFijados(access.userId);

  if (!input.fijar) {
    const sin = actuales.filter((clave) => clave !== chatKey);
    await guardarChatsFijados(access.userId, sin);
    return { fijados: sin };
  }

  if (actuales.includes(chatKey)) {
    return { fijados: actuales };
  }
  if (actuales.length >= MAXIMO_DE_FIJADOS) {
    return { error: `Solo puedes fijar ${MAXIMO_DE_FIJADOS} chats. Desfija uno primero.` };
  }

  // El chat tiene que ser de ESTE negocio: un id de otro no puede quedar fijado en esta bandeja.
  const [origen, id] = [partes[1], partes[2]];
  const existe =
    origen === "agent"
      ? await prisma.conversation.count({ where: { id, workspaceId: access.workspaceId } })
      : await prisma.officialApiConversation.count({ where: { id, config: { workspaceId: access.workspaceId } } });
  if (existe === 0) {
    return { error: "Conversacion no encontrada" };
  }

  const con = [...actuales, chatKey];
  await guardarChatsFijados(access.userId, con);
  return { fijados: con };
}
