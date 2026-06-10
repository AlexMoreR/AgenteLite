"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

const updateCrmStageSchema = z.object({
  contactId: z.string().trim().min(1),
  status: z.enum(["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]),
});

const updateCrmCollapsedSchema = z.object({
  contactId: z.string().trim().min(1),
  collapsed: z.boolean(),
});

export async function updateCrmStageAction(input: { contactId: string; status: CrmStage }) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("crm");

  const parsed = updateCrmStageSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
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
    return { error: "Contacto no encontrado" };
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "crmStage" = ${parsed.data.status},
        "updatedAt" = NOW()
    WHERE "id" = ${contact.id}
  `;

  await createFollowsFromRulesForSource({
    workspaceId: membership.workspace.id,
    contactId: contact.id,
    sourceType: "CRM_STAGE",
    sourceId: parsed.data.status,
  });

  // Registro de actividad en la conversación más reciente del contacto.
  const recentConversation = await prisma.conversation.findFirst({
    where: { workspaceId: membership.workspace.id, contactId: contact.id },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, channelId: true },
  });
  if (recentConversation) {
    const actorName = session.user.name?.trim() || "Alguien";
    const stageLabel = CRM_STAGE_META[parsed.data.status]?.label ?? parsed.data.status;
    await recordConversationActivity({
      workspaceId: membership.workspace.id,
      conversationId: recentConversation.id,
      channelId: recentConversation.channelId,
      contactId: contact.id,
      kind: "stage_changed",
      text: `${actorName} cambió la etapa a "${stageLabel}"`,
    });
  }

  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");

  return { success: true, contactId: contact.id, status: parsed.data.status };
}

export async function updateCrmCollapsedAction(input: { contactId: string; collapsed: boolean }) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("crm");

  const parsed = updateCrmCollapsedSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
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
    return { error: "Contacto no encontrado" };
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('crmKanbanCollapsed', CAST(${parsed.data.collapsed} AS boolean)),
        "updatedAt" = NOW()
    WHERE "id" = ${contact.id}
  `;

  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");

  return { success: true, contactId: contact.id, collapsed: parsed.data.collapsed };
}
