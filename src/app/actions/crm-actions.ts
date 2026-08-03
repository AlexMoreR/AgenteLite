"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { claimConversationIfUnassigned } from "@/lib/conversation-claim";
import { buildSnoozeMetadata } from "@/lib/lead-snooze";
import { CRM_STAGE_META, getCrmLostReasonLabel } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

const updateCrmStageSchema = z.object({
  contactId: z.string().trim().min(1),
  status: z.enum(["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]),
  // Solo se guarda al cerrar como PERDIDO. Es el unico dato del CRM que la maquina NO puede
  // deducir: por que se cayo la venta lo sabe la vendedora y nadie mas.
  lostReason: z.string().trim().min(1).max(60).optional(),
  // Fecha real de la venta. Solo aplica a GANADO. Si no viene, se usa la fecha de hoy. Editable
  // para poder corregir ventas mal fechadas o cargar ventas viejas con su dia real.
  wonAt: z.string().trim().min(1).optional(),
});

function parseWonAt(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

const updateCrmCollapsedSchema = z.object({
  contactId: z.string().trim().min(1),
  collapsed: z.boolean(),
});

export async function updateCrmStageAction(input: {
  contactId: string;
  status: CrmStage;
  lostReason?: string;
  wonAt?: string;
}) {
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

  // La razon solo aplica a PERDIDO. Al mover el lead a cualquier otra etapa se limpia: si se
  // cerro por error y se reabre, no puede quedar arrastrando un motivo de perdida viejo que
  // despues ensucie el informe de razones.
  const lostReason = parsed.data.status === "PERDIDO" ? parsed.data.lostReason ?? null : null;

  // wonAt solo aplica a GANADO: la fecha real de la venta. Si no viene, hoy. Al mover el lead a
  // cualquier otra etapa se limpia (igual que lostReason) para que no ensucie el reporte.
  const wonAt = parsed.data.status === "GANADO" ? parseWonAt(parsed.data.wonAt) : null;

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "crmStage" = ${parsed.data.status},
        "lostReason" = ${lostReason},
        "wonAt" = ${wonAt},
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
    const reasonLabel = getCrmLostReasonLabel(lostReason);
    await recordConversationActivity({
      workspaceId: membership.workspace.id,
      conversationId: recentConversation.id,
      channelId: recentConversation.channelId,
      contactId: contact.id,
      kind: "stage_changed",
      text: reasonLabel
        ? `${actorName} cambió la etapa a "${stageLabel}" (motivo: ${reasonLabel})`
        : `${actorName} cambió la etapa a "${stageLabel}"`,
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

/**
 * Tomar el lead al abrirlo desde Mi dia.
 *
 * Pedido de Alex: si una asesora entra a un lead sin dueño, ese lead pasa a ser suyo y
 * DESAPARECE del dia de las demas. Sin esto, dos podian estar escribiendole al mismo cliente al
 * mismo tiempo — que es exactamente lo que "Mi dia" venia a evitar.
 *
 * Se toma al ABRIR y no al responder (que tambien lo hace, por su cuenta) porque el momento en
 * que se pisan es antes de escribir: las dos abren el mismo chat.
 *
 * Solo agarra lo que NO tiene dueño: entrar a un chat ajeno no se lo quita a nadie.
 */
export async function claimLeadOnOpenAction(conversationId: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !conversationId.trim()) {
    return { ok: false };
  }
  await requireClientWorkspaceAccess("crm");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false };
  }

  await claimConversationIfUnassigned({
    source: "agent",
    conversationId: conversationId.trim(),
    workspaceId: membership.workspace.id,
  });

  revalidatePath("/cliente/crm/mi-dia");
  return { ok: true };
}

/**
 * Posponer un lead: sacarlo de "Mi dia" hasta el momento que elija la asesora.
 *
 * La lista decide sola que es urgente, pero ella sabe cosas que el sistema no: que quedo de
 * llamar despues del almuerzo, que la clienta pidio el lunes, que ya lo trabajo. Sin esto el
 * mismo lead le queda arriba todo el dia y la lista deja de significar algo.
 */
export async function snoozeLeadAction(input: {
  contactId: string;
  hasta: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("crm");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  const hasta = input.hasta ? new Date(input.hasta) : null;
  if (input.hasta && (!hasta || !Number.isFinite(hasta.getTime()))) {
    return { ok: false, error: "Esa fecha no es válida" };
  }

  const contacto = await prisma.contact.findFirst({
    where: { id: input.contactId.trim(), workspaceId: membership.workspace.id },
    select: { id: true, metadata: true },
  });
  if (!contacto) {
    return { ok: false, error: "Contacto no encontrado" };
  }

  await prisma.contact.update({
    where: { id: contacto.id },
    data: { metadata: buildSnoozeMetadata(contacto.metadata, hasta) as Prisma.InputJsonValue },
  });

  revalidatePath("/cliente/crm/mi-dia");
  return { ok: true };
}
