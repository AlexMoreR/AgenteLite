"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { leerConfigDeTexto } from "@/features/supervisor-reasignacion/dominio/reglas";
import { guardarConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";

/**
 * Guarda los ajustes de avisos y reasignación del Supervisor (tarjeta de la pantalla del Supervisor).
 * Solo el dueño o un administrador. Escribe únicamente `supervisor:reasignacion:<ws>`: no toca chats,
 * reparto, etapas ni el bot. Los valores pasan por el mismo lector de la config (límites y valores
 * por defecto), así que un número fuera de rango se corrige en vez de guardarse.
 */
export async function guardarAjustesReasignacionAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN")) return;

  const dias = formData.getAll("dias").map((d) => Number(d));
  const crudo: Record<string, unknown> = {
    avisosActivo: formData.get("avisosActivo") === "si",
    reasignacionActiva: formData.get("reasignacionActiva") === "si",
    minutosAviso: formData.get("minutosAviso"),
    minutosReasignacion: formData.get("minutosReasignacion"),
    horasCaliente: formData.get("horasCaliente"),
    horario: { desde: formData.get("desde"), hasta: formData.get("hasta"), dias },
    canalId: String(formData.get("canalId") ?? "").trim(),
  };
  await guardarConfigReasignacion(access.workspaceId, leerConfigDeTexto(JSON.stringify(crudo)));
  revalidatePath("/cliente/crm/supervisor");
}
