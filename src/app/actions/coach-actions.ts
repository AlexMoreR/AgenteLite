"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { diaEnBogota, esDiaValido } from "@/features/coach/reglas";
import { generarCoachDelDia, guardarCoachNocturno } from "@/features/coach/servicios/generar-coach";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

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

  revalidatePath("/cliente/equipo/coach");
  redirect(`/cliente/equipo/coach?dia=${dia}&generando=1`);
}

/** Prende o apaga la corrida de cada noche (23:30). Solo el dueño o un administrador. */
export async function guardarCoachNocturnoAction(formData: FormData): Promise<void> {
  const access = await requireClientWorkspaceAccess("crm", { ownerOnly: true });
  const activo = String(formData.get("activo") ?? "") === "1";
  await guardarCoachNocturno(access.workspaceId, activo);
  const pedido = String(formData.get("dia") ?? "").trim();
  revalidatePath("/cliente/equipo/coach");
  redirect(`/cliente/equipo/coach${esDiaValido(pedido) ? `?dia=${pedido}` : ""}`);
}
