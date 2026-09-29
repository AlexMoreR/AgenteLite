"use server";

import { revalidatePath } from "next/cache";

import { guardarBanderaDeDescarte } from "@/features/crm/services/descarte-automatico";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/**
 * El interruptor del descarte automático.
 *
 * Esto CIERRA leads solos, asi que vive donde se puede apagar en el acto -la pantalla- y no en una
 * variable de entorno que obligue a reiniciar el servidor. Viene apagado: prenderlo es un acto
 * deliberado, y apagarlo tiene que ser igual de rapido.
 */
export async function cambiarBanderaDeDescarteAction(formData: FormData) {
  const access = await requireClientWorkspaceAccess();
  if (!(await puedeSupervisar(access))) {
    return;
  }

  // El switch manda el valor que TENIA: la accion lo invierte.
  const estaba = formData.get("encendido") === "true";
  await guardarBanderaDeDescarte(access.workspaceId, !estaba);
  revalidatePath("/cliente/automatizaciones");
}
