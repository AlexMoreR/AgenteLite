"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { esArea } from "@/features/agentes-de-area/dominio/reglas";
import { guardarInterruptor } from "@/features/agentes-de-area/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/**
 * EL INTERRUPTOR DEL AGENTE DE ÁREA. Solo lo mueve quien puede supervisar (dueño, administradores y
 * supervisora), igual que la pantalla del Supervisor. Prenderlo NO manda nada por sí solo: el agente
 * sigue corriendo en aizen1 y los mensajes salen cuando él los pide.
 */

type Resultado = { ok: true; activo: boolean } | { ok: false; error: string };

export async function cambiarInterruptorDelAgenteAction(area: string, activo: boolean): Promise<Resultado> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sin permiso." };
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(await puedeSupervisar(access))) return { ok: false, error: "Sin permiso." };
  if (!esArea(area)) return { ok: false, error: "Área desconocida." };
  try {
    await guardarInterruptor(area, access.workspaceId, Boolean(activo));
  } catch {
    return { ok: false, error: "No se pudo guardar el interruptor." };
  }
  revalidatePath("/cliente/crm/agente-de-ventas");
  return { ok: true, activo: Boolean(activo) };
}
