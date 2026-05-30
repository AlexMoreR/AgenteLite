"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  cancelPendingFollowsByContact,
  createFollow,
  createFollowRule,
  deleteFollowRule,
} from "@/features/seguimientos/services/follows";

const createFollowRuleSchema = z.object({
  name: z.string().trim().min(2, "Agrega un nombre").max(120),
  sourceType: z.enum(["FLOW", "PRODUCT", "TAG", "CRM_STAGE", "MANUAL"]),
  sourceId: z.string().trim().max(120).optional().default(""),
  channelId: z.string().trim().max(120).optional().default(""),
  timeType: z.enum(["MINUTES", "HOURS", "DAYS"]),
  timeValue: z.coerce.number().int().min(1, "El tiempo debe ser mayor a 0").max(9999),
  messageType: z.enum(["TEXT", "AUDIO", "IMAGE", "VIDEO", "DOC"]),
  content: z.string().trim().max(5000).optional().default(""),
  mediaUrl: z.string().trim().max(2048).optional().default(""),
  cancelOnActivity: z.coerce.boolean().optional().default(true),
  isActive: z.coerce.boolean().optional().default(true),
});

const createFollowSchema = z.object({
  contactId: z.string().trim().min(1, "Contacto invalido"),
  followRuleId: z.string().trim().optional().default(""),
  channelId: z.string().trim().optional().default(""),
  timeType: z.enum(["MINUTES", "HOURS", "DAYS"]),
  timeValue: z.coerce.number().int().min(1, "El tiempo debe ser mayor a 0").max(9999),
  messageType: z.enum(["TEXT", "AUDIO", "IMAGE", "VIDEO", "DOC"]),
  content: z.string().trim().max(5000).optional().default(""),
  mediaUrl: z.string().trim().max(2048).optional().default(""),
  executeAt: z.string().trim().optional().default(""),
  cancelOnActivity: z.coerce.boolean().optional().default(true),
});

const cancelFollowSchema = z.object({
  contactId: z.string().trim().min(1, "Contacto invalido"),
  reason: z.string().trim().max(500).optional().default(""),
});

function isAllowedRole(role?: string | null) {
  return role === "ADMIN" || role === "CLIENTE";
}

export type CreateFollowRuleActionState =
  | { success: true; ruleId: string; name: string }
  | { error: string; success?: false };

export type DeleteFollowRuleActionState =
  | { success: true; ruleId: string; name: string }
  | { error: string; success?: false };

export async function createFollowRuleAction(
  _prevState: CreateFollowRuleActionState,
  formData: FormData,
): Promise<CreateFollowRuleActionState> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return { error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const parsed = createFollowRuleSchema.safeParse({
    name: formData.get("name"),
    sourceType: formData.get("sourceType"),
    sourceId: formData.get("sourceId"),
    channelId: formData.get("channelId"),
    timeType: formData.get("timeType"),
    timeValue: formData.get("timeValue"),
    messageType: formData.get("messageType"),
    content: formData.get("content"),
    mediaUrl: formData.get("mediaUrl"),
    cancelOnActivity: formData.get("cancelOnActivity") === "on" || formData.get("cancelOnActivity") === "true",
    isActive: formData.has("isActive")
      ? formData.get("isActive") === "on" || formData.get("isActive") === "true"
      : undefined,
  });

  if (!parsed.success) {
    return { error: "Revisa los datos de la regla" };
  }

  const rule = await createFollowRule({
    workspaceId: membership.workspace.id,
    channelId: parsed.data.channelId || null,
    name: parsed.data.name,
    sourceType: parsed.data.sourceType,
    sourceId: parsed.data.sourceId || null,
    timeType: parsed.data.timeType,
    timeValue: parsed.data.timeValue,
    messageType: parsed.data.messageType,
    content: parsed.data.content || null,
    mediaUrl: parsed.data.mediaUrl || null,
    cancelOnActivity: parsed.data.cancelOnActivity,
    isActive: parsed.data.isActive,
  });

  if (!rule) {
    return { error: "No se pudo guardar la regla" };
  }

  revalidatePath("/cliente/seguimientos");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/flujos");

  return { success: true, ruleId: rule.id, name: rule.name };
}

export async function deleteFollowRuleAction(
  _prevState: DeleteFollowRuleActionState,
  formData: FormData,
): Promise<DeleteFollowRuleActionState> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return { error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const followRuleId = String(formData.get("followRuleId") || "").trim();
  const followRuleName = String(formData.get("followRuleName") || "").trim();
  if (!followRuleId) {
    return { error: "Regla invalida" };
  }

  const deletedId = await deleteFollowRule({
    workspaceId: membership.workspace.id,
    followRuleId,
  });

  if (!deletedId) {
    return { error: "No se pudo eliminar la regla" };
  }

  revalidatePath("/cliente/seguimientos");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/flujos");

  return { success: true, ruleId: deletedId, name: followRuleName || "Regla" };
}

export async function createFollowAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return;
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return;
  }

  const parsed = createFollowSchema.safeParse({
    contactId: formData.get("contactId"),
    followRuleId: formData.get("followRuleId"),
    channelId: formData.get("channelId"),
    timeType: formData.get("timeType"),
    timeValue: formData.get("timeValue"),
    messageType: formData.get("messageType"),
    content: formData.get("content"),
    mediaUrl: formData.get("mediaUrl"),
    executeAt: formData.get("executeAt"),
    cancelOnActivity: formData.get("cancelOnActivity") === "on" || formData.get("cancelOnActivity") === "true",
  });

  if (!parsed.success) {
    return;
  }

  const follow = await createFollow({
    workspaceId: membership.workspace.id,
    contactId: parsed.data.contactId,
    followRuleId: parsed.data.followRuleId || null,
    channelId: parsed.data.channelId || null,
    timeType: parsed.data.timeType,
    timeValue: parsed.data.timeValue,
    messageType: parsed.data.messageType,
    content: parsed.data.content || null,
    mediaUrl: parsed.data.mediaUrl || null,
    executeAt: parsed.data.executeAt ? new Date(parsed.data.executeAt) : null,
    cancelOnActivity: parsed.data.cancelOnActivity,
  });

  if (!follow) {
    return;
  }

  revalidatePath("/cliente/seguimientos");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/chats");
}

export async function cancelFollowsByContactAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return;
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return;
  }

  const parsed = cancelFollowSchema.safeParse({
    contactId: formData.get("contactId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return;
  }

  const result = await cancelPendingFollowsByContact({
    workspaceId: membership.workspace.id,
    contactId: parsed.data.contactId,
    reason: parsed.data.reason || "Cancelado por actividad",
  });

  revalidatePath("/cliente/seguimientos");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/chats");

  void result.cancelled;
}
