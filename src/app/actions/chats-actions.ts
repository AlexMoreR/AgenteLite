"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { sendOfficialApiReplyAction } from "@/app/actions/official-api-actions";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { sendEvolutionTextMessage } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const sendUnifiedChatReplySchema = z.object({
  source: z.enum(["agent", "official"]),
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  agentId: z.string().trim().optional(),
});

const toggleConversationAutomationSchema = z.object({
  conversationId: z.string().trim().min(1),
  returnTo: z.string().trim().min(1).max(500),
});

export async function sendUnifiedChatReplyAction(formData: FormData): Promise<void> {
  const parsed = sendUnifiedChatReplySchema.safeParse({
    source: formData.get("source"),
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
    agentId: formData.get("agentId"),
  });

  if (!parsed.success) {
    redirect("/cliente/chats?error=No+se+pudo+enviar+el+mensaje");
  }

  if (parsed.data.source === "official") {
    const nextData = new FormData();
    nextData.set("conversationId", parsed.data.conversationId);
    nextData.set("message", parsed.data.message);
    return sendOfficialApiReplyAction(nextData);
  }

  if (!parsed.data.agentId) {
    redirect("/cliente/chats?error=No+se+encontro+el+agente");
  }

  const nextData = new FormData();
  nextData.set("agentId", parsed.data.agentId);
  nextData.set("conversationId", parsed.data.conversationId);
  nextData.set("message", parsed.data.message);
  nextData.set("returnTo", `/cliente/chats?chatKey=agent:${parsed.data.conversationId}`);
  return sendManualAgentReplyAction(nextData);
}

export async function toggleConversationAutomationAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = toggleConversationAutomationSchema.safeParse({
    conversationId: formData.get("conversationId"),
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/chats?error=No+se+pudo+actualizar+la+IA");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/chats?error=Debes+configurar+tu+negocio+primero");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      agentId: true,
      contact: {
        select: {
          id: true,
          phoneNumber: true,
        },
      },
      channel: {
        select: {
          id: true,
          evolutionInstanceName: true,
        },
      },
      agent: {
        select: {
          trainingConfig: true,
        },
      },
    },
  });

  if (!conversation) {
    redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=Conversacion+no+encontrada`);
  }

  const currentPaused = await getConversationAutomationPaused({
    conversationId: conversation.id,
    workspaceId: membership.workspace.id,
  });
  const nextPaused = !currentPaused;

  await setConversationAutomationPaused({
    conversationId: conversation.id,
    paused: nextPaused,
  });

  const reactivationMessage =
    conversation.agent?.trainingConfig &&
    typeof conversation.agent.trainingConfig === "object" &&
    !Array.isArray(conversation.agent.trainingConfig) &&
    typeof (conversation.agent.trainingConfig as { reactivationMessage?: unknown }).reactivationMessage === "string"
      ? ((conversation.agent.trainingConfig as { reactivationMessage?: string }).reactivationMessage ?? "").trim()
      : "";

  if (!nextPaused && reactivationMessage && conversation.channel?.evolutionInstanceName && conversation.contact?.phoneNumber) {
    try {
      const outbound = await sendEvolutionTextMessage({
        instanceName: conversation.channel.evolutionInstanceName,
        phoneNumber: conversation.contact.phoneNumber,
        text: reactivationMessage,
      });

      await prisma.message.create({
        data: {
          workspaceId: membership.workspace.id,
          conversationId: conversation.id,
          channelId: conversation.channel.id,
          contactId: conversation.contact.id,
          agentId: conversation.agentId,
          externalId: outbound.externalId,
          direction: "OUTBOUND",
          type: "TEXT",
          status: "SENT",
          content: reactivationMessage,
          sentAt: new Date(),
          rawPayload: {
            source: "automation_reactivation",
            evolution: outbound.raw,
          } as never,
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
        },
      });
    } catch {
      // Si falla el envio del mensaje de reactivacion, la IA igual se reactiva.
    }
  }

  revalidatePath("/cliente/chats");
  if (conversation.agentId) {
    revalidatePath(`/cliente/agentes/${conversation.agentId}/chats`);
  }

  redirect(
    `${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}ok=${
      nextPaused ? "IA+pausada+en+este+chat" : "IA+reactivada+en+este+chat"
    }`,
  );
}

