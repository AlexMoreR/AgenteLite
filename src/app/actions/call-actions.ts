"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  CALL_RESULTS,
  CALL_RESULT_LOST,
  CALL_RESULT_STAGE_EFFECT,
  getCallResultLabel,
  type CallResult,
} from "@/features/crm/domain/crm-config";
import { updateCrmStageAction } from "@/app/actions/crm-actions";

const CALL_RESULT_VALUES = CALL_RESULTS.map((result) => result.value) as [string, ...string[]];

const registerCallSchema = z.object({
  contactId: z.string().trim().min(1),
  result: z.enum(CALL_RESULT_VALUES),
  summary: z.string().trim().max(280).optional(),
  // ISO date del PRÓXIMO contacto (solo la fecha importa, se guarda a medianoche del día).
  nextContactAt: z.string().trim().min(1).optional(),
  // Obligatorio solo cuando result === "perdido".
  lostReason: z.string().trim().min(1).max(60).optional(),
  // Fecha REAL de la llamada (para registro retroactivo del Google Sheet). Si no viene, es ahora.
  calledAt: z.string().trim().min(1).optional(),
});

export type RegisterCallInput = z.infer<typeof registerCallSchema>;

function parseOptionalDate(value: string | undefined): Date | null | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Registra UN intento de llamada a un lead y aplica la regla de etapa del Playbook.
 *
 * No envía WhatsApp (eso es Fase 2): si el resultado cambia la etapa (lo piensa → Tibio,
 * Ganado, Perdido) se delega en updateCrmStageAction, que ya dispara los seguimientos por
 * CRM_STAGE y registra la actividad — exactamente igual que mover la tarjeta en el kanban.
 */
export async function registerCallAttemptAction(input: RegisterCallInput) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("llamadas");

  const parsed = registerCallSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos inválidos" };
  }

  const isLost = parsed.data.result === CALL_RESULT_LOST;
  const lostReason = isLost ? parsed.data.lostReason?.trim() || "" : null;
  // "Perdido" SIEMPRE requiere motivo — no se puede guardar sin él (regla del Playbook).
  if (isLost && !lostReason) {
    return { error: "Para cerrar como Perdido tenés que elegir un motivo." };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }
  const workspaceId = membership.workspace.id;

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, workspaceId },
    select: { id: true },
  });
  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  const nextContactAt = parseOptionalDate(parsed.data.nextContactAt) ?? null;
  const calledAt = parseOptionalDate(parsed.data.calledAt) ?? new Date();

  // intento_numero = cuántas llamadas ya tiene este lead + 1.
  const previousAttempts = await prisma.callAttempt.count({
    where: { workspaceId, contactId: contact.id },
  });

  await prisma.callAttempt.create({
    data: {
      workspaceId,
      contactId: contact.id,
      calledByUserId: session.user.id,
      attemptNumber: previousAttempts + 1,
      result: parsed.data.result,
      summary: parsed.data.summary?.trim() || null,
      nextContactAt,
      lostReason,
      calledAt,
    },
  });

  // Regla de etapa del Playbook (si aplica). Se reutiliza updateCrmStageAction para heredar el
  // disparo de seguimientos por CRM_STAGE y el registro de actividad, igual que el kanban.
  const stageEffect = CALL_RESULT_STAGE_EFFECT[parsed.data.result as CallResult];
  if (stageEffect) {
    await updateCrmStageAction({
      contactId: contact.id,
      status: stageEffect,
      lostReason: isLost ? lostReason ?? undefined : undefined,
      // Playbook: "Ganado el día del pago, ligado al intento que lo cerró" → la fecha de venta
      // es la fecha de ESTA llamada (calledAt, editable para registro retroactivo).
      wonAt: stageEffect === "GANADO" ? calledAt.toISOString() : undefined,
    });
  }

  revalidatePath("/cliente/llamadas");
  revalidatePath("/cliente/crm/mi-dia");
  return { success: true as const };
}

export type CallContactSearchItem = {
  contactId: string;
  name: string;
  phoneNumber: string;
  avatarUrl: string | null;
  stage: string;
};

/**
 * Busca contactos por nombre o teléfono para registrar una llamada a un lead que NO está en los
 * buckets de hoy (p.ej. registrar RETROACTIVAMENTE las llamadas que Ingrid ya hizo esta semana,
 * migrando el Google Sheet).
 */
export async function searchContactsForCallAction(query: string): Promise<{ items: CallContactSearchItem[] }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { items: [] };
  }
  await requireClientWorkspaceAccess("llamadas");

  const term = query.trim();
  if (term.length < 2) {
    return { items: [] };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { items: [] };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: membership.workspace.id,
      excludedFromCrm: false,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { phoneNumber: { contains: term } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true },
  });

  return {
    items: contacts.map((contact) => ({
      contactId: contact.id,
      name: contact.name?.trim() || contact.phoneNumber,
      phoneNumber: contact.phoneNumber,
      avatarUrl: contact.avatarUrl,
      stage: contact.crmStage,
    })),
  };
}

export type CallHistoryItem = {
  id: string;
  attemptNumber: number;
  resultLabel: string;
  summary: string | null;
  calledAt: string;
  nextContactAt: string | null;
  calledByName: string | null;
};

/**
 * Historial de intentos de llamada de un contacto, para el modal del lead en el Kanban
 * ("qué pasó la última vez"). Se gatea con "crm" porque lo consume el Kanban del CRM.
 */
export async function getContactCallHistoryAction(contactId: string): Promise<{ items: CallHistoryItem[] }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { items: [] };
  }
  await requireClientWorkspaceAccess("crm");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { items: [] };
  }

  const attempts = await prisma.callAttempt.findMany({
    where: { workspaceId: membership.workspace.id, contactId },
    orderBy: { calledAt: "desc" },
    take: 20,
    select: {
      id: true,
      attemptNumber: true,
      result: true,
      summary: true,
      calledAt: true,
      nextContactAt: true,
      calledBy: { select: { name: true, email: true } },
    },
  });

  return {
    items: attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      resultLabel: getCallResultLabel(attempt.result) ?? attempt.result,
      summary: attempt.summary,
      calledAt: attempt.calledAt.toISOString(),
      nextContactAt: attempt.nextContactAt?.toISOString() ?? null,
      calledByName: attempt.calledBy?.name?.trim() || attempt.calledBy?.email || null,
    })),
  };
}
