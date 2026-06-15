"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  cancelPendingFollowsByContact,
  createFollow,
  createFollowRule,
  deleteFollowRule,
  updateFollowRule,
  type FollowActionInput,
} from "@/features/seguimientos/services/follows";

const createFollowRuleSchema = z.object({
  name: z.string().trim().min(2, "Agrega un nombre").max(120),
  sourceType: z.enum(["FLOW", "PRODUCT", "TAG", "CRM_STAGE", "MANUAL", "AGENT_NODE"]),
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

const followActionSchema = z.object({
  order: z.coerce.number().int().min(1).optional(),
  messageType: z.enum(["TEXT", "AUDIO", "IMAGE", "VIDEO", "DOC"]),
  content: z.string().trim().max(5000).optional().default(""),
  mediaUrl: z.string().trim().max(2048).optional().default(""),
});

const createFollowSchema = z.object({
  contactId: z.string().trim().min(1, "Contacto invalido"),
  name: z.string().trim().min(2, "Agrega un nombre").max(120).optional().default(""),
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

function normalizeFollowActionsFromFormData(formData: FormData) {
  const rawValue = formData.get("actions");
  const rawActions = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!rawActions) {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawActions);
  } catch {
    return { error: "Revisa las acciones del seguimiento" } as const;
  }

  const parsed = z.array(followActionSchema).safeParse(parsedJson);
  if (!parsed.success) {
    return { error: "Revisa las acciones del seguimiento" } as const;
  }

  const actions: FollowActionInput[] = [];
  for (const [index, action] of parsed.data.entries()) {
    const content = action.content?.trim() ?? "";
    const mediaUrl = action.mediaUrl?.trim() ?? "";
    const normalized: FollowActionInput = {
      order: action.order ?? index + 1,
      messageType: action.messageType,
      content,
      mediaUrl,
    };

    if (normalized.messageType === "TEXT") {
      if (!content.trim()) {
        return { error: "Agrega contenido para el mensaje de texto" } as const;
      }
    } else if (!mediaUrl.trim()) {
      return { error: "Sube el archivo de cada acción multimedia" } as const;
    }

    actions.push(normalized);
  }

  if (!actions.length) {
    return { error: "Agrega al menos una acción" } as const;
  }

  return { actions } as const;
}

function buildFallbackActions(formData: FormData) {
  const messageType = String(formData.get("messageType") || "TEXT") as FollowActionInput["messageType"];
  return [
    {
      order: 1,
      messageType,
      content: String(formData.get("content") || "").trim(),
      mediaUrl: String(formData.get("mediaUrl") || "").trim(),
    },
  ] satisfies FollowActionInput[];
}

function isAllowedRole(role?: string | null) {
  return role === "ADMIN" || role === "CLIENTE" || role === "EMPLEADO";
}

export type CreateFollowRuleActionState =
  | { success: true; ruleId?: string; name: string; message: string }
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
  await requireClientWorkspaceAccess("seguimientos");

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

  const parsedActions = normalizeFollowActionsFromFormData(formData);
  const parsedActionsError = parsedActions?.error;
  if (parsedActionsError) {
    return { error: parsedActionsError };
  }

  const actions = parsedActions?.actions ?? buildFallbackActions(formData);
  const primaryAction = actions[0];
  const primaryContent = primaryAction.content?.trim() ?? "";
  const primaryMediaUrl = primaryAction.mediaUrl?.trim() ?? "";

  if (primaryAction.messageType === "TEXT" && !primaryContent.trim()) {
    return { error: "Agrega contenido para un mensaje de texto" };
  }

  if (primaryAction.messageType !== "TEXT" && !primaryMediaUrl.trim()) {
    return { error: "Sube el archivo de la acción multimedia" };
  }

  if (parsed.data.sourceType === "MANUAL") {
    if (!parsed.data.sourceId) {
      return { error: "Selecciona un contacto para el seguimiento manual" };
    }

    const follow = await createFollow({
      workspaceId: membership.workspace.id,
      contactId: parsed.data.sourceId,
      name: parsed.data.name,
      followRuleId: null,
      channelId: parsed.data.channelId || null,
      timeType: parsed.data.timeType,
      timeValue: parsed.data.timeValue,
      messageType: primaryAction.messageType,
      content: primaryAction.content || null,
      mediaUrl: primaryAction.mediaUrl || null,
      actions,
      cancelOnActivity: parsed.data.cancelOnActivity,
    });

    if (!follow) {
      return { error: "No se pudo programar el seguimiento" };
    }

    revalidatePath("/cliente/seguimientos");
    revalidatePath("/cliente/contactos");
    revalidatePath("/cliente/crm");
    revalidatePath("/cliente/flujos");

    return {
      success: true,
      name: parsed.data.name,
      message: "Seguimiento programado",
    };
  }

  const rule = await createFollowRule({
    workspaceId: membership.workspace.id,
    channelId: parsed.data.channelId || null,
    name: parsed.data.name,
    sourceType: parsed.data.sourceType,
    sourceId: parsed.data.sourceId || null,
    timeType: parsed.data.timeType,
    timeValue: parsed.data.timeValue,
    messageType: primaryAction.messageType,
    content: primaryAction.content || null,
    mediaUrl: primaryAction.mediaUrl || null,
    actions,
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

  return {
    success: true,
    ruleId: rule.id,
    name: rule.name,
    message: `Regla "${rule.name}" guardada`,
  };
}

export async function updateFollowRuleAction(
  _prevState: CreateFollowRuleActionState,
  formData: FormData,
): Promise<CreateFollowRuleActionState> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("seguimientos");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const followRuleId = String(formData.get("followRuleId") || "").trim();
  if (!followRuleId) {
    return { error: "Regla invalida" };
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

  if (parsed.data.sourceType === "MANUAL") {
    return { error: "Una regla no puede tener origen manual" };
  }

  const parsedActions = normalizeFollowActionsFromFormData(formData);
  const parsedActionsError = parsedActions?.error;
  if (parsedActionsError) {
    return { error: parsedActionsError };
  }

  const actions = parsedActions?.actions ?? buildFallbackActions(formData);
  const primaryAction = actions[0];
  const primaryContent = primaryAction.content?.trim() ?? "";
  const primaryMediaUrl = primaryAction.mediaUrl?.trim() ?? "";

  if (primaryAction.messageType === "TEXT" && !primaryContent.trim()) {
    return { error: "Agrega contenido para un mensaje de texto" };
  }

  if (primaryAction.messageType !== "TEXT" && !primaryMediaUrl.trim()) {
    return { error: "Sube el archivo de la acción multimedia" };
  }

  const rule = await updateFollowRule({
    workspaceId: membership.workspace.id,
    followRuleId,
    channelId: parsed.data.channelId || null,
    name: parsed.data.name,
    sourceType: parsed.data.sourceType,
    sourceId: parsed.data.sourceId || null,
    timeType: parsed.data.timeType,
    timeValue: parsed.data.timeValue,
    messageType: primaryAction.messageType,
    content: primaryAction.content || null,
    mediaUrl: primaryAction.mediaUrl || null,
    actions,
    cancelOnActivity: parsed.data.cancelOnActivity,
    isActive: parsed.data.isActive,
  });

  if (!rule) {
    return { error: "No se pudo actualizar la regla" };
  }

  revalidatePath("/cliente/seguimientos");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/flujos");

  return {
    success: true,
    ruleId: rule.id,
    name: rule.name,
    message: `Regla "${rule.name}" actualizada`,
  };
}

export async function deleteFollowRuleAction(
  _prevState: DeleteFollowRuleActionState,
  formData: FormData,
): Promise<DeleteFollowRuleActionState> {
  const session = await auth();
  if (!session?.user?.id || !isAllowedRole(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("seguimientos");

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
  await requireClientWorkspaceAccess("seguimientos");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return;
  }

  const parsed = createFollowSchema.safeParse({
    contactId: formData.get("contactId"),
    name: formData.get("name"),
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

  const parsedActions = normalizeFollowActionsFromFormData(formData);
  const parsedActionsError = parsedActions?.error;
  if (parsedActionsError) {
    return;
  }

  const actions = parsedActions?.actions ?? buildFallbackActions(formData);
  const primaryAction = actions[0];
  const primaryContent = primaryAction.content?.trim() ?? "";
  const primaryMediaUrl = primaryAction.mediaUrl?.trim() ?? "";

  if (primaryAction.messageType === "TEXT" && !primaryContent.trim()) {
    return;
  }

  if (primaryAction.messageType !== "TEXT" && !primaryMediaUrl.trim()) {
    return;
  }

  const follow = await createFollow({
    workspaceId: membership.workspace.id,
    contactId: parsed.data.contactId,
    name: parsed.data.name || null,
    followRuleId: parsed.data.followRuleId || null,
    channelId: parsed.data.channelId || null,
    timeType: parsed.data.timeType,
    timeValue: parsed.data.timeValue,
    messageType: primaryAction.messageType,
    content: primaryAction.content || null,
    mediaUrl: primaryAction.mediaUrl || null,
    actions,
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
  await requireClientWorkspaceAccess("seguimientos");

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
