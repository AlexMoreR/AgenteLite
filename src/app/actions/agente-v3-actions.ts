"use server";

import { revalidatePath } from "next/cache";

import { guardarBanderaDeRescate } from "@/features/agente-v3/servicios/rescate-de-mensajes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

/**
 * El interruptor del rescate de mensajes.
 *
 * Alex lo pidió al aprobar el rescate (28-09-2026): que exista una bandera que él pueda apagar.
 * Va acá y no en una variable de entorno a propósito — una variable se cambia en Portainer y
 * obliga a reiniciar el servidor; esto se apaga desde la pantalla, en el acto, que es lo que hace
 * falta cuando algo se está portando mal con clientes de verdad delante.
 *
 * Solo el dueño o un administrador: es el permiso de la pantalla donde vive.
 */
export async function cambiarBanderaDeRescateAction(formData: FormData) {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
  if (!esJefe) {
    return;
  }

  // El switch manda el valor que TENÍA: la acción lo invierte.
  const estaba = formData.get("encendido") === "true";
  await guardarBanderaDeRescate(access.workspaceId, !estaba);
  revalidatePath("/cliente/agente-v3");
}
