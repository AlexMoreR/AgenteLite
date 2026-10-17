"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { diaEnBogota, esDiaValido } from "@/features/coach/reglas";
import type { EstadoDeAccion } from "@/features/coach/dominio/acciones-de-hoy";
import { ESTADOS_DE_ACCION, guardarEstadoDeAccion } from "@/features/coach/servicios/acciones-coach";
import { generarCoachDelDia, guardarCoachNocturno } from "@/features/coach/servicios/generar-coach";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/**
 * "Generar ahora": el dueño corre el coach para el dia que elija (por ejemplo el 8-oct, para
 * probarlo). Rehace el informe de ese dia si ya estaba. Corre DESPUES de responder (after), asi la
 * pantalla vuelve enseguida con "generando"; la corrida tarda uno o dos minutos.
 */
export async function generarCoachAhoraAction(formData: FormData): Promise<void> {
  const access = await requireClientWorkspaceAccess("crm", { ownerOnly: true });
  const pedido = String(formData.get("dia") ?? "").trim();
  const hoy = diaEnBogota(new Date());
  const dia = esDiaValido(pedido) && pedido <= hoy ? pedido : hoy;

  after(async () => {
    const resultado = await generarCoachDelDia(access.workspaceId, dia, { force: true, origen: "manual" });
    if (resultado.decision === "error") {
      console.error("[COACH] generar_ahora_fallo", access.workspaceId, dia, resultado.error);
    }
  });

  revalidatePath("/cliente/equipo/coach", "layout");
  redirect(`/cliente/equipo/coach/informe?dia=${dia}&generando=1`);
}

/**
 * "Acciones de hoy": marcar la tarjeta de una asesora como pendiente / en progreso / cumplido. La
 * marca quien supervisa o la misma asesora (la suya). No cambia el informe ni el analisis del Coach.
 */
export async function marcarAccionDelCoachAction(formData: FormData): Promise<void> {
  const access = await requireClientWorkspaceAccess("crm");
  const dia = String(formData.get("dia") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  const estado = String(formData.get("estado") ?? "").trim() as EstadoDeAccion;
  if (!esDiaValido(dia) || !userId || !ESTADOS_DE_ACCION.includes(estado)) return;
  const supervisa = await puedeSupervisar(access);
  if (!supervisa && userId !== access.userId) return;
  await guardarEstadoDeAccion({ workspaceId: access.workspaceId, dia, userId, estado, por: access.userId });
  revalidatePath("/cliente/equipo/coach", "layout");
}

/** Prende o apaga la corrida de cada noche (23:30). Solo el dueño o un administrador. */
export async function guardarCoachNocturnoAction(formData: FormData): Promise<void> {
  const access = await requireClientWorkspaceAccess("crm", { ownerOnly: true });
  const activo = String(formData.get("activo") ?? "") === "1";
  await guardarCoachNocturno(access.workspaceId, activo);
  const pedido = String(formData.get("dia") ?? "").trim();
  revalidatePath("/cliente/equipo/coach", "layout");
  redirect(`/cliente/equipo/coach/informe${esDiaValido(pedido) ? `?dia=${pedido}` : ""}`);
}
