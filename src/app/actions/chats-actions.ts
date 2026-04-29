"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { sendOfficialApiReplyAction } from "@/app/actions/official-api-actions";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";
import { sendEvolutionTextMessage } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const updateContactSchema = z.object({
  contactId: z.string().trim().min(1),
  name: z.string().trim().max(120),
});

type UpdateContactActionState =
  | { error: string; success?: false }
  | { success: true; contactId: string; name: string };

export async function updateContactAction(
  _prevState: UpdateContactActionState | { error?: string; success?: boolean },
  formData: FormData,
): Promise<UpdateContactActionState> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }

  const parsed = updateContactSchema.safeParse({
    contactId: formData.get("contactId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, workspaceId: membership.workspace.id },
    select: { id: true },
  });

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { name: parsed.data.name || null },
  });

  return {
    success: true,
    contactId: contact.id,
    name: parsed.data.name.trim(),
  };
}

const sendUnifiedChatReplySchema = z.object({
  source: z.enum(["agent", "official"]),
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  agentId: z.string().trim().optional(),
  returnTo: z.string().trim().min(1).max(500).optional(),
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
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/chats?error=No+se+pudo+enviar+el+mensaje");
  }

  if (parsed.data.source === "official") {
    const nextData = new FormData();
    nextData.set("conversationId", parsed.data.conversationId);
    nextData.set("message", parsed.data.message);
    if (parsed.data.returnTo) {
      nextData.set("returnTo", parsed.data.returnTo);
    }
    return sendOfficialApiReplyAction(nextData);
  }

  if (!parsed.data.agentId) {
    redirect("/cliente/chats?error=No+se+encontro+el+agente");
  }

  const nextData = new FormData();
  nextData.set("agentId", parsed.data.agentId);
  nextData.set("conversationId", parsed.data.conversationId);
  nextData.set("message", parsed.data.message);
  nextData.set("returnTo", parsed.data.returnTo || `/cliente/chats?chatKey=agent:${parsed.data.conversationId}`);
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

      await syncLeadLifecycleForContact({
        workspaceId: membership.workspace.id,
        contactId: conversation.contact.id,
        hasHistory: true,
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

const clearConversationSchema = z.object({
  conversationId: z.string().trim().min(1),
  returnTo: z.string().trim().min(1).max(500),
});

export async function clearConversationMessagesAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = clearConversationSchema.safeParse({
    conversationId: formData.get("conversationId"),
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/chats?error=Datos+invalidos");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/chats?error=Workspace+no+encontrado");
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: parsed.data.conversationId, workspaceId: membership.workspace.id },
    select: { id: true },
  });

  if (!conversation) {
    redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=Conversacion+no+encontrada`);
  }

  await prisma.message.deleteMany({
    where: { conversationId: conversation.id, workspaceId: membership.workspace.id },
  });

  revalidatePath("/cliente/chats");
  redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}ok=Chat+limpiado`);
}

export type EtiquetaItem = { id: string; name: string; color: string };

export async function getEtiquetasAction(): Promise<{ items?: EtiquetaItem[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const tags = await prisma.tag.findMany({
    where: { workspaceId: membership.workspace.id },
    select: { id: true, name: true, color: true },
    orderBy: { createdAt: "asc" },
  });

  return { items: tags };
}

const createEtiquetaSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().min(1).max(30),
});

export async function createEtiquetaAction(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }

  const parsed = createEtiquetaSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
  });

  if (!parsed.success) return { error: "Datos invalidos" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const slug = parsed.data.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await prisma.tag.findUnique({
    where: { workspaceId_slug: { workspaceId: membership.workspace.id, slug } },
    select: { id: true },
  });
  if (existing) return { error: "Ya existe una etiqueta con ese nombre" };

  await prisma.tag.create({
    data: {
      id: crypto.randomUUID(),
      workspaceId: membership.workspace.id,
      name: parsed.data.name,
      slug,
      color: parsed.data.color,
      updatedAt: new Date(),
    },
  });

  return { success: true };
}

export async function getContactTagIdsAction(contactId: string): Promise<{ tagIds?: string[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const rows = await prisma.contactTag.findMany({
    where: { contactId, workspaceId: membership.workspace.id },
    select: { tagId: true },
  });

  return { tagIds: rows.map((r) => r.tagId) };
}

export async function toggleContactTagAction(
  contactId: string,
  tagId: string,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: membership.workspace.id },
    select: { id: true },
  });
  if (!contact) return { error: "Contacto no encontrado" };

  const tag = await prisma.tag.findFirst({
    where: { id: tagId, workspaceId: membership.workspace.id },
    select: { id: true },
  });
  if (!tag) return { error: "Etiqueta no encontrada" };

  const existing = await prisma.contactTag.findUnique({
    where: { contactId_tagId: { contactId, tagId } },
    select: { contactId: true },
  });

  if (existing) {
    await prisma.contactTag.delete({ where: { contactId_tagId: { contactId, tagId } } });
  } else {
    await prisma.contactTag.create({
      data: { contactId, tagId, workspaceId: membership.workspace.id },
    });
  }

  return {};
}
