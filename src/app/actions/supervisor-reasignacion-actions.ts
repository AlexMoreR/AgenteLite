"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { leerConfigReasignacionDeTexto } from "@/features/supervisor-reasignacion/dominio/reglas";
import { guardarConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

/**
 * Guarda los ajustes del Supervisor de reasignación (tarjeta de la pantalla del Supervisor). Solo el
 * dueño o los administradores. Escribe únicamente `supervisor:reasignacion:<negocio>`; el mismo
 * lector que usa el vigilante limpia y acota cada valor.
 */
export async function guardarAjustesDeReasignacionAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !esJefeDelNegocio(access)) return;
  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();
  const dias = formData.getAll("dias").map((d) => Number(d));
  const config = leerConfigReasignacionDeTexto(
    JSON.stringify({
      avisosActivo: formData.has("avisosActivo"),
      reasignacionActiva: formData.has("reasignacionActiva"),
      minutosAviso: texto("minutosAviso"),
      minutosReasignacion: texto("minutosReasignacion"),
      horasCaliente: texto("horasCaliente"),
      horario: { desde: texto("desde"), hasta: texto("hasta"), dias },
      canalId: texto("canalId"),
    }),
  );
  await guardarConfigReasignacion(access.workspaceId, config);
  revalidatePath("/cliente/direccion/supervisor");
}
