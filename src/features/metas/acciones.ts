"use server";

import { revalidatePath } from "next/cache";

import { metasDesdeFormulario } from "@/features/metas/dominio/metas-guardadas";
import { guardarMetasDelMes, miembrosDelNegocio } from "@/features/metas/servicios/metas-del-mes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export type ResultadoDeGuardarMetas = { ok: true; mes: string } | { ok: false; error: string };

/**
 * Guarda las metas del mes desde /cliente/metas. Solo el dueño y los administradores del negocio: las metas
 * mueven comisiones (dinero), una asesora no las puede cambiar aunque arme el pedido a mano.
 */
export async function guardarMetas(formData: FormData): Promise<ResultadoDeGuardarMetas> {
  const access = await requireClientWorkspaceAccess(undefined, { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) return { ok: false, error: "Solo el dueño puede cambiar las metas." };

  const campo = (nombre: string) => {
    const valor = formData.get(nombre);
    return typeof valor === "string" ? valor : null;
  };
  const resultado = metasDesdeFormulario(campo);
  if (!resultado.ok) return resultado;

  // Cada asesora con userId tiene que ser de este negocio: un id de otra empresa no se guarda.
  const miembros = await miembrosDelNegocio(access.workspaceId);
  if (!miembros) return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  const delNegocio = new Set(miembros.map((miembro) => miembro.userId));
  if (resultado.metas.asesoras.some((asesora) => asesora.userId && !delNegocio.has(asesora.userId))) {
    return { ok: false, error: "Una de las asesoras ya no está en el equipo. Recarga la página." };
  }

  const guardadas = await guardarMetasDelMes(access.workspaceId, resultado.mes, resultado.metas);
  if (!guardadas) return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };

  revalidatePath("/cliente/metas");
  revalidatePath("/cliente/crm/mi-dia");
  revalidatePath("/cliente/mi-tablero");
  return { ok: true, mes: resultado.mes };
}
