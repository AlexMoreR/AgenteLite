"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  contarPublico,
  iniciarCampana,
  pausarCampana,
} from "@/features/campanas/services/campaigns";

/**
 * Campañas tiene su propio permiso: mandar un mensaje a cientos de clientes de una no es lo mismo
 * que programarle un seguimiento a uno, y quien puede hacer lo segundo no tiene por que poder
 * hacer lo primero. El dueño y los ADMIN lo ven solos; al resto hay que habilitarselo.
 */
async function getAccess() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("campanas");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

/** Cuantos leads caen en la condicion. Se llama al armar la campaña, antes de mandar nada. */
export async function contarPublicoAction(input: {
  crmStage?: string | null;
}): Promise<{ total?: number; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const total = await contarPublico({
    workspaceId,
    filtro: { crmStage: input.crmStage ?? null },
  });
  return { total };
}

export async function crearCampanaAction(input: {
  name: string;
  crmStage?: string | null;
  channelId?: string | null;
  content: string;
  batchSize: number;
  intervalMinutes: number;
}): Promise<{ ok?: true; campaignId?: string; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const name = input.name?.trim();
  const content = input.content?.trim();
  if (!name || !content) {
    return { error: "Falta el nombre o el mensaje" };
  }

  // El freno tiene topes duros y no solo un valor por defecto: una campaña de 500 de una sola vez
  // es la forma mas rapida de que bloqueen la linea, y el campo no deberia permitir escribirla.
  const batchSize = Number(input.batchSize);
  const intervalMinutes = Number(input.intervalMinutes);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    return { error: "La cantidad por tanda tiene que estar entre 1 y 50" };
  }
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
    return { error: "La frecuencia tiene que estar entre 5 minutos y 24 horas" };
  }

  const campana = await prisma.campaign.create({
    data: {
      workspaceId,
      name,
      crmStage: input.crmStage?.trim() || null,
      channelId: input.channelId?.trim() || null,
      messageType: "TEXT",
      content,
      batchSize,
      intervalMinutes,
      status: "DRAFT",
    },
    select: { id: true },
  });

  revalidatePath("/cliente/campanas");
  return { ok: true, campaignId: campana.id };
}

export async function iniciarCampanaAction(input: {
  campaignId: string;
}): Promise<{ ok?: true; total?: number; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const resultado = await iniciarCampana({ workspaceId, campaignId: input.campaignId });
  revalidatePath("/cliente/campanas");
  if (!resultado.ok) {
    return { error: resultado.error ?? "No se pudo iniciar" };
  }
  return { ok: true, total: resultado.total };
}

export async function pausarCampanaAction(input: {
  campaignId: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  await pausarCampana({ workspaceId, campaignId: input.campaignId });
  revalidatePath("/cliente/campanas");
  return { ok: true };
}

export async function borrarCampanaAction(input: {
  campaignId: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  // Solo lo que todavia no salio. Una campaña que ya mando mensajes es un registro de lo que
  // recibieron clientes reales: borrarla dejaria conversaciones sin explicacion.
  const borradas = await prisma.campaign.deleteMany({
    where: { id: input.campaignId, workspaceId, status: "DRAFT" },
  });

  revalidatePath("/cliente/campanas");
  if (borradas.count === 0) {
    return { error: "Solo se pueden borrar las campañas que todavía no empezaron" };
  }
  return { ok: true };
}
