"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * El numero corto de un chat (el de app.aizenbot.com/c/1234), para mostrarlo en la cabecera.
 *
 * Va por su lado y no dentro del detalle del chat a proposito: ese detalle es el que mueve el
 * realtime (loader, /live, comparadores), y un dato que nunca cambia no tiene por que tocarlo.
 */
export async function numeroDelChatAction(input: {
  conversationId: string;
  source: "agent" | "official";
}): Promise<number | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return null;

  if (input.source === "official") {
    const chat = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: membership.workspace.id } },
      select: { numero: true },
    });
    return chat?.numero ?? null;
  }

  const chat = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: membership.workspace.id },
    select: { numero: true },
  });
  return chat?.numero ?? null;
}
