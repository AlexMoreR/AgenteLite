"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { CONFIG_REASIGNACION_POR_DEFECTO, leerConfigReasignacionDeTexto } from "@/features/supervisor-reasignacion/dominio/reglas";
import { guardarConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";

/**
 * Guarda los ajustes del vigilante de reasignación (tarjeta de la pantalla del Supervisor).
 * SOLO el dueño del negocio. Escribe únicamente `supervisor:reasignacion:<ws>`: no toca chats ni reparto.
 * Los valores raros vuelven al valor por defecto (leerConfigReasignacionDeTexto los limpia).
 */
export async function guardarAjustesDeReasignacionAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access?.isOwner) return;
  const base = CONFIG_REASIGNACION_POR_DEFECTO;
  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();
  const dias = formData.getAll("dias").map((d) => Number(d)).filter((d) => Number.isInteger(d));
  const config = leerConfigReasignacionDeTexto(
    JSON.stringify({
      avisosActivo: texto("avisosActivo") === "on",
      reasignacionActiva: texto("reasignacionActiva") === "on",
      avisoMin: texto("avisoMin"),
      reasignarMin: texto("reasignarMin"),
      calienteHoras: texto("calienteHoras"),
      horario: { desde: texto("desde"), hasta: texto("hasta"), dias: dias.length ? dias : base.horario.dias },
      canalId: texto("canalId") || base.canalId,
    }),
  );
  await guardarConfigReasignacion(access.workspaceId, config);
  revalidatePath("/cliente/crm/supervisor");
}
