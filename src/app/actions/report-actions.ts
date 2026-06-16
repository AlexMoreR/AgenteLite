"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { generateDailyReportForWorkspace, parseBogotaDate } from "@/features/reportes/services/daily-report";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const MAX_RECIPIENTS = 10;

function normalizePhone(value: string): string {
  // Mantiene solo dígitos (Evolution acepta el número en formato simple).
  return value.replace(/[^\d]/g, "");
}

async function resolveWorkspace() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" as const };
  }
  await requireClientWorkspaceAccess("connection");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" as const };
  }
  return { workspaceId: membership.workspace.id };
}

export async function updateReportConfigAction(input: {
  recipients: string[];
  enabled: boolean;
}): Promise<{ error?: string }> {
  const ws = await resolveWorkspace();
  if ("error" in ws) {
    return { error: ws.error };
  }

  const recipients = Array.from(
    new Set((Array.isArray(input.recipients) ? input.recipients : []).map(normalizePhone).filter((n) => n.length >= 7)),
  ).slice(0, MAX_RECIPIENTS);

  await prisma.workspace.update({
    where: { id: ws.workspaceId },
    data: {
      dailyReportEnabled: Boolean(input.enabled),
      dailyReportRecipients: recipients,
    },
  });

  revalidatePath("/cliente/conexion");
  return {};
}

export async function generateDailyReportNowAction(input?: {
  date?: string;
}): Promise<{ error?: string; shareToken?: string; delivered?: number }> {
  const ws = await resolveWorkspace();
  if ("error" in ws) {
    return { error: ws.error };
  }

  // Fecha opcional (YYYY-MM-DD) en zona Bogota. No permitimos días futuros.
  let date: Date | undefined;
  if (input?.date) {
    const parsed = parseBogotaDate(input.date);
    if (!parsed) {
      return { error: "Fecha inválida" };
    }
    if (parsed.getTime() > Date.now()) {
      return { error: "No puedes generar un reporte de un día futuro" };
    }
    date = parsed;
  }

  try {
    const result = await generateDailyReportForWorkspace(ws.workspaceId, { force: true, date });
    revalidatePath("/cliente/conexion");
    return { shareToken: result.shareToken, delivered: result.delivered.length };
  } catch (error) {
    console.error("[REPORT_ACTION] generate_now_failed", error);
    return { error: "No pudimos generar el reporte. Intenta de nuevo." };
  }
}

export async function deleteDailyReportAction(input: { reportId: string }): Promise<{ error?: string }> {
  const ws = await resolveWorkspace();
  if ("error" in ws) {
    return { error: ws.error };
  }

  const reportId = input.reportId?.trim();
  if (!reportId) {
    return { error: "Datos inválidos" };
  }

  // Solo se borra si pertenece al workspace del usuario.
  const result = await prisma.dailyReport.deleteMany({
    where: { id: reportId, workspaceId: ws.workspaceId },
  });
  if (result.count === 0) {
    return { error: "Reporte no encontrado" };
  }

  revalidatePath("/cliente/conexion");
  return {};
}
