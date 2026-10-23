"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  conMarcasDeActivacion,
  normalizarConfigReasignacion,
  type ConfigReasignacion,
} from "@/features/supervisor-reasignacion/dominio/reglas";
import { guardarConfigReasignacion, leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

/**
 * Guarda los ajustes de los avisos por WhatsApp y la reasignación automática del Supervisor
 * (AppSetting `supervisor:reasignacion:<ws>`). Solo el dueño (o un administrador). No toca chats:
 * la vuelta de cada minuto lee lo guardado.
 */
export async function guardarAjustesDeReasignacionAction(
  entrada: Partial<ConfigReasignacion>,
): Promise<{ ok: true; config: ConfigReasignacion } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Inicia sesión." };
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(access.isOwner || access.role === "ADMIN")) return { error: "Solo el dueño o un administrador pueden cambiar estos ajustes." };

  const anterior = await leerConfigReasignacion(access.workspaceId);
  const config = conMarcasDeActivacion(normalizarConfigReasignacion((entrada ?? {}) as Record<string, unknown>), anterior, new Date());
  if (!config.horario.dias.length) return { error: "Elige al menos un día de trabajo." };
  // Los avisos solo salen por una línea ADMINISTRATIVA del negocio. Apagar siempre se puede, aunque
  // la línea ya no exista.
  if (config.avisosActivos || config.reasignacionActiva) {
    const linea = await prisma.whatsAppChannel.findFirst({ where: { id: config.canalId, workspaceId: access.workspaceId }, select: { purpose: true } });
    if (!linea || linea.purpose !== "ADMIN") return { error: "La línea de avisos tiene que ser una línea administrativa del negocio." };
  }

  await guardarConfigReasignacion(access.workspaceId, config);
  revalidatePath("/cliente/crm/supervisor");
  return { ok: true, config };
}
