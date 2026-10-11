"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { marcarAtendida } from "@/features/supervisor-accionable/servicios/accionable";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/**
 * "Marcar resuelto/atendido" de una tarjeta de Prioridades de Alexander (pantalla del Supervisor).
 * Solo quien puede supervisar. Escribe únicamente `supervisor:accionable:atendidas:<ws>`: no toca
 * chats, reparto, etapas ni el bot. La próxima vuelta del Supervisor pasa la acción a
 * ATENDIDA_POR_ALEXANDER; la pantalla la esconde de inmediato.
 */
export async function marcarPrioridadAtendidaAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(await puedeSupervisar(access))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id || id.length > 300) return;
  await marcarAtendida(access.workspaceId, id, session.user.id);
  revalidatePath("/cliente/crm/supervisor");
}
