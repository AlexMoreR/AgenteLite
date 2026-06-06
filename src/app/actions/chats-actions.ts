"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { sendManualAgentReplyAction, type SendChatReplyResult } from "@/app/actions/agent-actions";
import { generateAgentReply } from "@/lib/agent-ai";
import { buildActiveProductContextNote, type ActiveProductContext } from "@/lib/agent-product-flow";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";
import { sendEvolutionTextMessage } from "@/lib/evolution";
import { normalizeInternalPath } from "@/lib/app-url";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { Prisma } from "@prisma/client";

const updateContactSchema = z.object({
  contactId: z.string().trim().min(1),
  name: z.string().trim().max(120),
  phoneNumber: z.string().trim().max(40).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(200).optional(),
  interested: z.string().trim().max(200).optional(),
  tagIds: z.array(z.string().trim().min(1)).default([]),
});

const deleteContactSchema = z.object({
  contactId: z.string().trim().min(1, "Contacto invalido"),
  returnTo: z.string().trim().max(500).optional(),
});

type UpdateContactActionState =
  | { error: string; success?: false }
  | {
      success: true;
      contactId: string;
      name: string;
      tags: Array<{
        label: string;
        color: string;
      }>;
    };

export type ContactDetails = {
  contactId: string;
  name: string;
  phoneNumber: string;
  city: string;
  address: string;
  interested: string;
  tagIds: string[];
  tags: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  availableTags: Array<{
    id: string;
    name: string;
    color: string;
  }>;
};

function readMetadataString(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export async function getContactDetailsAction(
  contactId: string,
): Promise<{ error: string } | { details: ContactDetails }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const [contact, availableTags] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, workspaceId: membership.workspace.id },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        metadata: true,
        ContactTag: {
          orderBy: { createdAt: "asc" },
          select: {
            tagId: true,
            Tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
    }),
    prisma.tag.findMany({
      where: { workspaceId: membership.workspace.id },
      select: { id: true, name: true, color: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  return {
    details: {
      contactId: contact.id,
      name: contact.name ?? "",
      phoneNumber: contact.phoneNumber,
      city: readMetadataString(contact.metadata, "city"),
      address: readMetadataString(contact.metadata, "address"),
      interested: readMetadataString(contact.metadata, "interested"),
      tagIds: contact.ContactTag.map((item) => item.tagId),
      tags: contact.ContactTag.map((item) => item.Tag),
      availableTags,
    },
  };
}

export async function updateContactAction(
  _prevState: UpdateContactActionState | { error?: string; success?: boolean },
  formData: FormData,
): Promise<UpdateContactActionState> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const hasInterestedField = formData.has("interested");
  const parsed = updateContactSchema.safeParse({
    contactId: formData.get("contactId"),
    name: formData.get("name"),
    phoneNumber: formData.get("phoneNumber") ?? undefined,
    city: formData.get("city") ?? undefined,
    address: formData.get("address") ?? undefined,
    interested: hasInterestedField ? formData.get("interested") ?? undefined : undefined,
    tagIds: formData.getAll("tagIds"),
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
    select: {
      id: true,
      phoneNumber: true,
      metadata: true,
      ContactTag: {
        select: { tagId: true },
      },
    },
  });

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  const nextPhoneNumber = parsed.data.phoneNumber?.trim();
  // El teléfono es único por workspace: evitamos colisiones con otro contacto.
  if (nextPhoneNumber && nextPhoneNumber !== contact.phoneNumber) {
    const existing = await prisma.contact.findFirst({
      where: {
        workspaceId: membership.workspace.id,
        phoneNumber: nextPhoneNumber,
        id: { not: contact.id },
      },
      select: { id: true },
    });
    if (existing) {
      return { error: "Ya existe un contacto con ese teléfono" };
    }
  }

  // ciudad y direccion se guardan en metadata; interested queda como legacy si el formulario lo envia.
  const selectedTagIds = Array.from(new Set(parsed.data.tagIds.map((tagId) => tagId.trim()).filter(Boolean)));
  const selectedTags = selectedTagIds.length
    ? await prisma.tag.findMany({
        where: {
          workspaceId: membership.workspace.id,
          id: { in: selectedTagIds },
        },
        select: { id: true, name: true, color: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  if (selectedTags.length !== selectedTagIds.length) {
    return { error: "Una o mas etiquetas no existen" };
  }

  const baseMetadata =
    contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
      ? (contact.metadata as Record<string, unknown>)
      : {};
  const nextMetadata: Record<string, unknown> = {
    ...baseMetadata,
    city: parsed.data.city?.trim() || null,
    address: parsed.data.address?.trim() || null,
    ...(hasInterestedField ? { interested: parsed.data.interested?.trim() || null } : {}),
  };

  const currentTagIds = new Set(contact.ContactTag.map((item) => item.tagId));
  const nextTagIds = new Set(selectedTagIds);
  const tagIdsToAdd = selectedTagIds.filter((tagId) => !currentTagIds.has(tagId));
  const tagIdsToRemove = Array.from(currentTagIds).filter((tagId) => !nextTagIds.has(tagId));

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: {
        name: parsed.data.name || null,
        ...(nextPhoneNumber ? { phoneNumber: nextPhoneNumber } : {}),
        metadata: nextMetadata as Prisma.InputJsonValue,
      },
    }),
    ...tagIdsToRemove.map((tagId) =>
      prisma.contactTag.delete({
        where: {
          contactId_tagId: {
            contactId: contact.id,
            tagId,
          },
        },
      }),
    ),
    ...tagIdsToAdd.map((tagId) =>
      prisma.contactTag.create({
        data: {
          contactId: contact.id,
          tagId,
          workspaceId: membership.workspace.id,
        },
      }),
    ),
  ]);

  if (tagIdsToAdd.length) {
    await Promise.allSettled(
      tagIdsToAdd.map((tagId) =>
        createFollowsFromRulesForSource({
          workspaceId: membership.workspace.id,
          contactId: contact.id,
          sourceType: "TAG",
          sourceId: tagId,
        }),
      ),
    );
  }

  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/contactos");

  return {
    success: true,
    contactId: contact.id,
    name: parsed.data.name.trim(),
    tags: selectedTags.map((tag) => ({
      label: tag.name,
      color: tag.color,
    })),
  };
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("chats");

  const parsed = deleteContactSchema.safeParse({
    contactId: formData.get("contactId"),
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/contactos?error=Contacto+invalido");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/contactos?error=Workspace+no+encontrado");
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: parsed.data.contactId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
    },
  });

  if (!contact) {
    redirect("/cliente/contactos?error=Contacto+no+encontrado");
  }

  await prisma.$transaction(async (tx) => {
    await tx.message.deleteMany({
      where: {
        workspaceId: membership.workspace.id,
        contactId: contact.id,
      },
    });

    await tx.contactTag.deleteMany({
      where: {
        workspaceId: membership.workspace.id,
        contactId: contact.id,
      },
    });

    await tx.contactMatch.deleteMany({
      where: {
        workspaceId: membership.workspace.id,
        contactId: contact.id,
      },
    });

    await tx.conversation.deleteMany({
      where: {
        workspaceId: membership.workspace.id,
        contactId: contact.id,
      },
    });

    await tx.contact.delete({
      where: {
        id: contact.id,
      },
    });
  });

  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/api-oficial/contactos");

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/contactos");
  redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}ok=Contacto+eliminado`);
}

const sendUnifiedChatReplySchema = z.object({
  source: z.literal("agent"),
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  agentId: z.string().trim().optional(),
  returnTo: z.string().trim().min(1).max(500).optional(),
  quotedMessageId: z.string().trim().optional(),
});

const toggleConversationAutomationSchema = z.object({
  conversationId: z.string().trim().min(1),
  returnTo: z.string().trim().min(1).max(500),
});

export async function sendUnifiedChatReplyAction(formData: FormData): Promise<SendChatReplyResult> {
  const parsed = sendUnifiedChatReplySchema.safeParse({
    source: formData.get("source"),
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
    agentId: formData.get("agentId"),
    returnTo: formData.get("returnTo"),
    quotedMessageId: formData.get("quotedMessageId"),
  });

  // Errores como resultado (sin redirect) para mostrarlos en la burbuja sin recarga.
  if (!parsed.success) {
    return { ok: false, error: "No se pudo enviar el mensaje" };
  }

  if (!parsed.data.agentId) {
    return { ok: false, error: "No se encontro el agente" };
  }

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "");
  const nextData = new FormData();
  nextData.set("agentId", parsed.data.agentId);
  nextData.set("conversationId", parsed.data.conversationId);
  nextData.set("message", parsed.data.message);
  nextData.set("returnTo", safeReturnTo || `/cliente/chats?chatKey=agent:${parsed.data.conversationId}`);
  if (parsed.data.quotedMessageId) {
    nextData.set("quotedMessageId", parsed.data.quotedMessageId);
  }
  return sendManualAgentReplyAction(nextData);
}

export async function toggleConversationAutomationAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("chats");

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
    const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/chats");
    redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}error=Conversacion+no+encontrada`);
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

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/chats");
  redirect(
    `${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}ok=${
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
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("chats");

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
    const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/chats");
    redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}error=Conversacion+no+encontrada`);
  }

  await prisma.message.deleteMany({
    where: { conversationId: conversation.id, workspaceId: membership.workspace.id },
  });

  revalidatePath("/cliente/chats");
  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/chats");
  redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}ok=Chat+limpiado`);
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

export async function generateSuggestedReplyAction(
  conversationId: string,
): Promise<{ suggestion?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const trimmedId = conversationId.trim();
  if (!trimmedId) return { error: "Conversación inválida" };

  const conversation = await prisma.conversation.findFirst({
    where: { id: trimmedId, workspaceId: membership.workspace.id },
    select: {
      id: true,
      activeProductContext: true,
      agent: {
        select: { systemPrompt: true, model: true, fallbackMessage: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { direction: true, content: true, type: true, mediaUrl: true },
      },
    },
  });

  if (!conversation) return { error: "Conversación no encontrada" };
  if (!conversation.agent) {
    return { error: "Esta conversación no tiene un agente asignado" };
  }

  // Los mensajes vienen del más reciente al más antiguo; el modelo los necesita en orden cronológico.
  const supportedTurnTypes = new Set([
    "TEXT",
    "IMAGE",
    "AUDIO",
    "VIDEO",
    "STICKER",
    "DOCUMENT",
    "TEMPLATE",
    "SYSTEM",
  ]);
  const orderedMessages = [...conversation.messages].reverse();
  const history = orderedMessages.map((message) => ({
    direction: message.direction,
    content: message.content,
    type: supportedTurnTypes.has(message.type)
      ? (message.type as "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "TEMPLATE" | "SYSTEM")
      : undefined,
    mediaUrl: message.mediaUrl,
  }));

  const latestInbound = [...orderedMessages]
    .reverse()
    .find((message) => message.direction === "INBOUND");

  const activeProductContext =
    (conversation.activeProductContext as ActiveProductContext | null | undefined) ?? null;
  const productNote = buildActiveProductContextNote(activeProductContext);

  const baseSystemPrompt = conversation.agent.systemPrompt?.trim() || "";
  const effectiveSystemPrompt = [
    baseSystemPrompt,
    productNote,
    "Genera una sola respuesta lista para enviar al cliente, sin saludos repetidos ni firmas.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const suggestion = await generateAgentReply({
      model: conversation.agent.model,
      systemPrompt: effectiveSystemPrompt,
      fallbackMessage: conversation.agent.fallbackMessage,
      history,
      latestUserMessage: latestInbound?.content ?? null,
    });

    const cleaned = suggestion?.trim();
    if (!cleaned) {
      return { error: "No se pudo generar una sugerencia" };
    }

    return { suggestion: cleaned };
  } catch (error) {
    console.error("[generateSuggestedReplyAction] error", error);
    return { error: "No se pudo generar la sugerencia. Inténtalo de nuevo." };
  }
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
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

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

export type AssignableMember = {
  id: string;
  name: string | null;
  email: string;
  role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
};

export async function getAssignableMembersAction(): Promise<{
  members?: AssignableMember[];
  currentUserId?: string;
  isManager?: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: membership.workspace.id, isActive: true },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    members: members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
    currentUserId: session.user.id,
    isManager: membership.role === "OWNER" || membership.role === "ADMIN",
  };
}

export async function assignChatAction(input: {
  conversationId: string;
  assignToUserId: string | null;
}): Promise<{
  ok?: boolean;
  error?: string;
  assignedTo?: { id: string; name: string | null } | null;
}> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const conversationId = typeof input?.conversationId === "string" ? input.conversationId.trim() : "";
  const targetUserId =
    typeof input?.assignToUserId === "string" && input.assignToUserId.trim() ? input.assignToUserId.trim() : null;
  if (!conversationId) return { error: "Datos invalidos" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: membership.workspace.id },
    select: { id: true, assignedToUserId: true },
  });
  if (!conversation) return { error: "Conversacion no encontrada" };

  // OWNER/ADMIN pueden asignar a cualquiera. AGENT/VIEWER solo pueden tomar
  // chats para si mismos o soltar los suyos.
  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  if (!isManager) {
    if (targetUserId && targetUserId !== session.user.id) {
      return { error: "Solo puedes asignarte chats a ti mismo" };
    }
    if (
      !targetUserId &&
      conversation.assignedToUserId &&
      conversation.assignedToUserId !== session.user.id
    ) {
      return { error: "No puedes liberar un chat asignado a otra persona" };
    }
  }

  let assignedTo: { id: string; name: string | null } | null = null;
  if (targetUserId) {
    const targetMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: membership.workspace.id, userId: targetUserId, isActive: true },
      select: { user: { select: { id: true, name: true } } },
    });
    if (!targetMember) return { error: "El usuario no pertenece al equipo" };
    assignedTo = targetMember.user;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { assignedToUserId: targetUserId },
  });

  revalidatePath("/cliente/chats");
  return { ok: true, assignedTo };
}

export async function toggleContactTagAction(
  contactId: string,
  tagId: string,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

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

    await createFollowsFromRulesForSource({
      workspaceId: membership.workspace.id,
      contactId,
      sourceType: "TAG",
      sourceId: tagId,
    });
  }

  return {};
}
