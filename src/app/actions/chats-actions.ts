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
import { recordConversationActivity } from "@/lib/conversation-activity";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";
import { backfillEvolutionMessagesByPhone } from "@/lib/evolution-chat-sync";
import { deleteEvolutionMessageForEveryone, fetchEvolutionProfilePictureUrl, sendEvolutionTextMessage } from "@/lib/evolution";
import { normalizeInternalPath } from "@/lib/app-url";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  getOfficialApiConfigByWorkspaceId,
  getOfficialApiConversationAutomationPaused,
  hasOfficialApiBaseCredentials,
  setOfficialApiConversationAutomationPaused,
  setOfficialApiConversationStatus,
} from "@/lib/official-api-config";
import { sendOfficialApiTextMessage } from "@/lib/official-api-messaging";
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

const resetContactSchema = z.object({
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

  let deleted = false;
  try {
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

      await tx.follow.deleteMany({
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
    deleted = true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(
        "[deleteContactAction] Falla de clave foranea: queda un registro hijo del contacto sin borrar",
        { contactId: contact.id, meta: error.meta },
      );
    } else {
      console.error("[deleteContactAction] No se pudo eliminar el contacto", error);
    }
  }

  if (!deleted) {
    redirect("/cliente/contactos?error=No+se+pudo+eliminar+el+contacto");
  }

  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/api-oficial/contactos");

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/contactos");
  redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}ok=Contacto+eliminado`);
}

// Trae la foto de perfil de UN contacto AL INSTANTE (acción manual del usuario desde
// el panel de contacto). Es 1 sola petición deliberada: no floodea, y sirve para el
// contacto que el usuario está mirando, mientras el refresco automático llena el resto
// de a poquitas. Usa el fetch con abort (6s), así que si WhatsApp está limitando, corta
// rápido y devuelve un error claro.
export async function refreshContactAvatarNowAction(
  contactId: string,
): Promise<{ ok: true; avatarUrl: string | null } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: membership.workspace.id },
    select: {
      id: true,
      phoneNumber: true,
      metadata: true,
      conversations: {
        where: { channel: { provider: "EVOLUTION", evolutionInstanceName: { not: null } } },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: { channel: { select: { evolutionInstanceName: true } } },
      },
    },
  });

  if (!contact) {
    return { ok: false, error: "Contacto no encontrado" };
  }

  const instanceName = contact.conversations[0]?.channel?.evolutionInstanceName?.trim();
  if (!instanceName || !contact.phoneNumber) {
    return { ok: false, error: "Este contacto no tiene una conexión de WhatsApp válida." };
  }

  const url = await fetchEvolutionProfilePictureUrl({ instanceName, phoneNumber: contact.phoneNumber });

  if (!url) {
    return {
      ok: false,
      error: "No se pudo obtener la foto (el contacto puede no tener foto o WhatsApp está limitando las consultas). Intenta más tarde.",
    };
  }

  const existingMetadata =
    contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
      ? (contact.metadata as Record<string, unknown>)
      : {};

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      avatarUrl: url,
      metadata: { ...existingMetadata, avatarFetchedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/contactos");
  return { ok: true, avatarUrl: url };
}

// Oculta (o vuelve a mostrar) un contacto del CRM sin borrarlo. Los contactos
// ocultos no aparecen en Registro, Kanban, stats ni Informe del CRM.
export async function toggleContactCrmHiddenAction(
  contactId: string,
  hidden: boolean,
): Promise<{ ok: true; excludedFromCrm: boolean } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("contacts");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: membership.workspace.id },
    select: { id: true },
  });

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { excludedFromCrm: hidden },
  });

  revalidatePath("/cliente/crm/registro");
  revalidatePath("/cliente/crm/kanban");
  revalidatePath("/cliente/crm/informe");
  revalidatePath("/cliente/contactos");

  return { ok: true, excludedFromCrm: hidden };
}

// Reinicia un contacto "desde cero" SIN eliminarlo de la lista: borra todo su
// historial (conversaciones, mensajes, seguimientos y coincidencias) junto con el
// estado del agente (producto activo, contexto comercial, automatizacion), pero
// conserva el contacto, su etapa CRM, notas y etiquetas. Al volver a escribir se
// crea una conversacion nueva y la bienvenida vuelve a dispararse.
export async function resetContactAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("chats");

  const parsed = resetContactSchema.safeParse({
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

  let reset = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({
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

      await tx.follow.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          contactId: contact.id,
        },
      });

      // Al borrar las conversaciones se limpia tambien el estado del agente
      // (activeProductContext, commercialContext, automationPaused, buffers).
      // No se toca el contacto, sus etiquetas, etapa CRM ni notas.
      await tx.conversation.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          contactId: contact.id,
        },
      });
    });
    reset = true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(
        "[resetContactAction] Falla de clave foranea: queda un registro hijo del contacto sin borrar",
        { contactId: contact.id, meta: error.meta },
      );
    } else {
      console.error("[resetContactAction] No se pudo reiniciar el contacto", error);
    }
  }

  if (!reset) {
    redirect("/cliente/contactos?error=No+se+pudo+reiniciar+el+contacto");
  }

  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/api-oficial/contactos");

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/contactos");
  redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}ok=Contacto+reiniciado`);
}

const sendUnifiedChatReplySchema = z.object({
  source: z.enum(["agent", "official"]),
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  agentId: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
    z.string().optional(),
  ),
  returnTo: z.string().trim().min(1).max(500).optional(),
  quotedMessageId: z.string().trim().nullish(),
  quotedContent: z.string().trim().max(4096).nullish(),
  quotedDirection: z.enum(["INBOUND", "OUTBOUND"]).nullish(),
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
    quotedContent: formData.get("quotedContent"),
    quotedDirection: formData.get("quotedDirection"),
  });

  // Errores como resultado (sin redirect) para mostrarlos en la burbuja sin recarga.
  if (!parsed.success) {
    return { ok: false, error: "No se pudo enviar el mensaje" };
  }

  const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "");

  if (parsed.data.source === "official") {
    const session = await auth();
    if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
      return { ok: false, error: "No autorizado" };
    }
    await requireClientWorkspaceAccess("chats");

    const membership = await getPrimaryWorkspaceForUser(session.user.id);
    if (!membership?.workspace.id) {
      return { ok: false, error: "Workspace no encontrado" };
    }

    const config = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
    if (!config || !hasOfficialApiBaseCredentials(config)) {
      return { ok: false, error: "La API oficial no esta activa" };
    }

    const conversationRows = await prisma.$queryRaw<Array<{
      id: string;
      contactId: string;
      contactWaId: string | null;
    }>>`
      SELECT
        c."id",
        ct."id" AS "contactId",
        ct."waId" AS "contactWaId"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiContact" ct
        ON ct."id" = c."contactId"
      WHERE c."id" = ${parsed.data.conversationId}
        AND c."configId" = ${config.id}
      LIMIT 1
    `;

    const conversation = conversationRows[0] ?? null;
    if (!conversation?.contactWaId) {
      return { ok: false, error: "No se encontro el contacto oficial" };
    }

    const result = await sendOfficialApiTextMessage({
      config,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      to: conversation.contactWaId,
      message: parsed.data.message,
      source: "manual",
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    // conversation.contactId es un OfficialApiContact.id y ContactTag apunta al
    // modelo Contact: la sincronizacion de tags falla con FK en el canal oficial.
    // Nunca debe convertir un envio exitoso en error.
    try {
      await syncLeadLifecycleForContact({
        workspaceId: membership.workspace.id,
        contactId: conversation.contactId,
        hasHistory: true,
      });
    } catch (error) {
      console.error("[sendUnifiedChatReplyAction] No se pudo sincronizar tags del contacto oficial", error);
    }

    revalidatePath("/cliente/chats");
    revalidatePath("/cliente/api-oficial");
    revalidatePath("/cliente/api-oficial/chats");
    if (safeReturnTo) {
      revalidatePath(safeReturnTo);
    }

    return { ok: true };
  }

  const nextData = new FormData();
  if (parsed.data.agentId) {
    nextData.set("agentId", parsed.data.agentId);
  }
  nextData.set("conversationId", parsed.data.conversationId);
  nextData.set("message", parsed.data.message);
  nextData.set("returnTo", safeReturnTo || `/cliente/chats?chatKey=agent:${parsed.data.conversationId}`);
  if (parsed.data.quotedMessageId) {
    nextData.set("quotedMessageId", parsed.data.quotedMessageId);
  }
  if (parsed.data.quotedContent) {
    nextData.set("quotedContent", parsed.data.quotedContent);
  }
  if (parsed.data.quotedDirection) {
    nextData.set("quotedDirection", parsed.data.quotedDirection);
  }
  return sendManualAgentReplyAction(nextData);
}

const deleteChatMessageSchema = z.object({
  messageId: z.string().trim().min(1),
});

export async function deleteChatMessageAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  const parsed = deleteChatMessageSchema.safeParse({ messageId: formData.get("messageId") });
  if (!parsed.success) {
    return { ok: false, error: "Datos invalidos" };
  }

  const message = await prisma.message.findFirst({
    where: { id: parsed.data.messageId, workspaceId: membership.workspace.id },
    select: {
      id: true,
      externalId: true,
      direction: true,
      rawPayload: true,
      channel: { select: { provider: true, evolutionInstanceName: true } },
      contact: { select: { phoneNumber: true } },
    },
  });

  if (!message) {
    return { ok: false, error: "Mensaje no encontrado" };
  }

  // Solo los mensajes propios (salientes) con id real de WhatsApp pueden borrarse
  // "para todos". Los entrantes se eliminan solo en nuestro inbox (para mí).
  const isRealWhatsAppId = Boolean(message.externalId) && !/^[a-f0-9]{64}$/.test(message.externalId ?? "");
  const canDeleteForEveryone =
    message.direction === "OUTBOUND" &&
    isRealWhatsAppId &&
    message.channel?.provider === "EVOLUTION" &&
    Boolean(message.channel.evolutionInstanceName) &&
    Boolean(message.contact?.phoneNumber);

  if (canDeleteForEveryone) {
    const raw = message.rawPayload;
    const evolution =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? ((raw as Record<string, unknown>).evolution as Record<string, unknown> | undefined)
        : undefined;
    const data = evolution?.data as Record<string, unknown> | undefined;
    const storedKey =
      ((data?.key as Record<string, unknown> | undefined) ??
        (evolution?.key as Record<string, unknown> | undefined)) ?? undefined;
    const remoteJid =
      (typeof storedKey?.remoteJid === "string" ? storedKey.remoteJid : null) ??
      `${message.contact!.phoneNumber}@s.whatsapp.net`;

    try {
      await deleteEvolutionMessageForEveryone({
        instanceName: message.channel!.evolutionInstanceName!,
        key: { id: message.externalId!, remoteJid, fromMe: true },
      });
    } catch {
      return { ok: false, error: "No se pudo eliminar en WhatsApp" };
    }
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  });

  return { ok: true };
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

// Verifica que una conversacion oficial pertenece al workspace (via su config).
async function findOfficialApiConversationInWorkspace(conversationId: string, workspaceId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c."id"
    FROM "OfficialApiConversation" c
    INNER JOIN "OfficialApiClientConfig" cfg ON cfg."id" = c."configId"
    WHERE c."id" = ${conversationId}
      AND cfg."workspaceId" = ${workspaceId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// Pausar/reanudar la IA en una conversacion de la API oficial (equivalente a
// toggleConversationAutomationAction pero sobre OfficialApiConversation).
export async function toggleOfficialApiConversationAutomationAction(formData: FormData): Promise<void> {
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

  const conversation = await findOfficialApiConversationInWorkspace(
    parsed.data.conversationId,
    membership.workspace.id,
  );

  if (!conversation) {
    const safeReturnTo = normalizeInternalPath(parsed.data.returnTo, "/cliente/chats");
    redirect(`${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}error=Conversacion+no+encontrada`);
  }

  const currentPaused = await getOfficialApiConversationAutomationPaused(conversation.id);
  const nextPaused = !currentPaused;
  await setOfficialApiConversationAutomationPaused({ conversationId: conversation.id, paused: nextPaused });

  revalidatePath("/cliente/chats");
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

// Elimina una etiqueta del workspace por completo (no solo del chat). Las asociaciones
// ContactTag se borran en cascada y las referencias en ContactMatch se ponen en null
// (definido en el esquema), así que basta borrar la fila Tag.
export async function deleteEtiquetaAction(tagId: string): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  // Eliminar una etiqueta es destructivo y afecta a TODO el workspace: solo administradores
  // (dueño/admin). Empleados y colaboradores solo pueden asignar/quitar etiquetas.
  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  if (!isManager) {
    return { error: "Solo un administrador puede eliminar etiquetas" };
  }

  const tag = await prisma.tag.findFirst({
    where: { id: tagId, workspaceId: membership.workspace.id },
    select: { id: true },
  });
  if (!tag) return { error: "Etiqueta no encontrada" };

  await prisma.tag.delete({ where: { id: tagId } });

  return { success: true };
}

// ---- Respuestas rápidas (plantillas de mensaje compartidas por todo el workspace) ----

export type QuickReplyItem = { id: string; title: string; content: string };

const quickReplySchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(80),
  content: z.string().trim().min(1, "El mensaje es obligatorio").max(2000),
});

export async function getQuickRepliesAction(): Promise<{ items?: QuickReplyItem[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const rows = await prisma.quickReply.findMany({
    where: { workspaceId: membership.workspace.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, content: true },
  });

  return { items: rows };
}

export async function createQuickReplyAction(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const parsed = quickReplySchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Datos invalidos" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  await prisma.quickReply.create({
    data: {
      workspaceId: membership.workspace.id,
      title: parsed.data.title,
      content: parsed.data.content,
    },
  });

  return { success: true };
}

export async function updateQuickReplyAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const parsed = quickReplySchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Datos invalidos" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const existing = await prisma.quickReply.findFirst({
    where: { id, workspaceId: membership.workspace.id },
    select: { id: true },
  });
  if (!existing) return { error: "Respuesta rápida no encontrada" };

  await prisma.quickReply.update({
    where: { id },
    data: { title: parsed.data.title, content: parsed.data.content },
  });

  return { success: true };
}

export async function deleteQuickReplyAction(id: string): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { error: "Workspace no encontrado" };

  const existing = await prisma.quickReply.findFirst({
    where: { id, workspaceId: membership.workspace.id },
    select: { id: true },
  });
  if (!existing) return { error: "Respuesta rápida no encontrada" };

  await prisma.quickReply.delete({ where: { id } });

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
    select: { id: true, assignedToUserId: true, channelId: true, contactId: true },
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

  // Registro de actividad de asignación.
  const actorName = session.user.name?.trim() || "Alguien";
  const activityText = !targetUserId
    ? `${actorName} quitó la asignación`
    : targetUserId === session.user.id
      ? `${actorName} se asignó la conversación`
      : `${actorName} asignó la conversación a ${assignedTo?.name?.trim() || "un colaborador"}`;
  await recordConversationActivity({
    workspaceId: membership.workspace.id,
    conversationId: conversation.id,
    channelId: conversation.channelId,
    contactId: conversation.contactId,
    kind: targetUserId ? "assigned" : "unassigned",
    text: activityText,
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
    select: { id: true, name: true },
  });
  if (!tag) return { error: "Etiqueta no encontrada" };

  const existing = await prisma.contactTag.findUnique({
    where: { contactId_tagId: { contactId, tagId } },
    select: { contactId: true },
  });

  const wasAdded = !existing;
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

  // Registro de actividad en la conversación más reciente del contacto.
  const recentConversation = await prisma.conversation.findFirst({
    where: { workspaceId: membership.workspace.id, contactId },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, channelId: true },
  });
  if (recentConversation) {
    const actorName = session.user.name?.trim() || "Alguien";
    await recordConversationActivity({
      workspaceId: membership.workspace.id,
      conversationId: recentConversation.id,
      channelId: recentConversation.channelId,
      contactId,
      kind: wasAdded ? "tag_added" : "tag_removed",
      text: wasAdded
        ? `${actorName} agregó la etiqueta "${tag.name}"`
        : `${actorName} quitó la etiqueta "${tag.name}"`,
    });
  }

  return {};
}

// Cambia el estado de la conversación (Abierto / Resuelto). "Resuelto" = CLOSED.
export async function updateConversationStatusAction(input: {
  conversationId: string;
  status: "OPEN" | "CLOSED";
  source?: "agent" | "official";
}): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const conversationId = input.conversationId?.trim();
  if (!conversationId || (input.status !== "OPEN" && input.status !== "CLOSED")) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  // Conversaciones de la API oficial viven en OfficialApiConversation, no en Conversation.
  if (input.source === "official") {
    const officialConversation = await findOfficialApiConversationInWorkspace(conversationId, membership.workspace.id);
    if (!officialConversation) {
      return { error: "Conversacion no encontrada" };
    }
    await setOfficialApiConversationStatus({ conversationId: officialConversation.id, status: input.status });
    revalidatePath("/cliente/chats");
    return {};
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: membership.workspace.id },
    select: { id: true, agentId: true, channelId: true, contactId: true },
  });

  if (!conversation) {
    return { error: "Conversacion no encontrada" };
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: input.status,
      closedAt: input.status === "CLOSED" ? new Date() : null,
    },
  });

  // Registro de actividad: resuelto / reabierto.
  const actorName = session.user.name?.trim() || "Alguien";
  await recordConversationActivity({
    workspaceId: membership.workspace.id,
    conversationId: conversation.id,
    channelId: conversation.channelId,
    contactId: conversation.contactId,
    kind: input.status === "CLOSED" ? "resolved" : "reopened",
    text: input.status === "CLOSED"
      ? `${actorName} resolvió la conversación`
      : `${actorName} reabrió la conversación`,
  });

  revalidatePath("/cliente/chats");
  if (conversation.agentId) {
    revalidatePath(`/cliente/agentes/${conversation.agentId}/chats`);
  }

  return {};
}

// Colaboradores (miembros del equipo) asignados a un canal. Se guardan en metadata.collaboratorIds.
export async function updateChannelCollaboratorsAction(input: {
  channelId: string;
  collaboratorIds: string[];
}): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("connection");

  const channelId = input.channelId?.trim();
  if (!channelId) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: channelId, workspaceId: membership.workspace.id },
    select: { id: true, metadata: true },
  });
  if (!channel) {
    return { error: "Canal no encontrado" };
  }

  // Solo aceptamos ids que sean miembros activos del workspace.
  const validMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: membership.workspace.id, isActive: true },
    select: { userId: true },
  });
  const validIds = new Set(validMembers.map((m) => m.userId));
  const collaboratorIds = Array.from(
    new Set((Array.isArray(input.collaboratorIds) ? input.collaboratorIds : []).filter((id) => validIds.has(id))),
  );

  const baseMetadata =
    channel.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};

  await prisma.whatsAppChannel.update({
    where: { id: channel.id },
    data: {
      metadata: { ...baseMetadata, collaboratorIds } as Prisma.InputJsonValue,
    },
  });

  revalidatePath(`/cliente/conexion/whatsapp-business/${channelId}`);
  return {};
}

const importConversationHistorySchema = z.object({
  conversationId: z.string().trim().min(1),
});

/**
 * Trae de WhatsApp los mensajes recientes de UN contacto y rellena lo que falte en su chat.
 *
 * Existe porque la importacion automatica se quito a proposito (revivia chats viejos y
 * suprimia la bienvenida, ver el webhook de Evolution). El hueco que eso deja se tapa aca:
 * cuando una asesora ve un historial cortado, lo pide ella misma, para ese contacto y en ese
 * momento. Por eso pide permiso de "chats" y no de "connection": el problema aparece en el
 * chat, y hacer que dependan de un administrador frena la venta.
 *
 * Alcance acotado a proposito: un solo contacto y solo los mensajes recientes. La importacion
 * masiva de un canal entero sigue viviendo en Conexion, para administradores.
 */
export async function importConversationHistoryAction(input: {
  conversationId: string;
}): Promise<{ ok: true; imported: number } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const parsed = importConversationHistorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Debes configurar tu negocio primero" };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      contact: { select: { phoneNumber: true } },
      channel: { select: { id: true, provider: true, evolutionInstanceName: true } },
    },
  });

  if (!conversation?.contact?.phoneNumber || !conversation.channel) {
    return { error: "No se encontro el chat" };
  }

  if (conversation.channel.provider !== "EVOLUTION" || !conversation.channel.evolutionInstanceName) {
    return { error: "Este canal no permite traer historial de WhatsApp" };
  }

  const result = await backfillEvolutionMessagesByPhone({
    workspaceId: membership.workspace.id,
    channelId: conversation.channel.id,
    phoneNumber: conversation.contact.phoneNumber,
  });

  if (!result.ok) {
    return { error: `No se pudo traer el historial: ${result.reason}` };
  }

  revalidatePath("/cliente/chats");

  return { ok: true, imported: result.imported };
}
