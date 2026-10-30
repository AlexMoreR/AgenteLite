"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { elegirResponsableDeSistemas, leerResponsableDeSistemas, marcarAlerta } from "@/features/alertas/servicios/alertas";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

/**
 * MARCAR UNA ALERTA como vista o resuelta. Lo hace quien ve la alerta: el dueño o administrador (las del negocio y las
 * suyas) o la persona del equipo (solo las suyas). El servicio filtra por negocio y por destinatario.
 */

type Resultado = { ok: true } | { ok: false; error: string };

export async function marcarAlertaAction(id: string, nuevo: "VISTA" | "RESUELTA", verTodas = false): Promise<Resultado> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sin permiso." };
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) return { ok: false, error: "Sin permiso." };
  if (typeof id !== "string" || !id || (nuevo !== "VISTA" && nuevo !== "RESUELTA")) return { ok: false, error: "Pedido inválido." };
  try {
    const responsableSistemasId = await leerResponsableDeSistemas(access.workspaceId);
    // Misma regla que la página: solo se marca lo que esa persona ve (con "ver todas" solo cuenta si es jefe).
    const existe = await marcarAlerta(access.workspaceId, id, nuevo, new Date(), { userId: session.user.id, esJefe: esJefeDelNegocio(access), responsableSistemasId, verTodas: verTodas === true });
    if (!existe) return { ok: false, error: "No se encontró la alerta." };
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
  revalidatePath("/cliente/alertas");
  return { ok: true };
}

/** ELEGIR al responsable de Sistemas (solo jefes; la persona tiene que ser del equipo). Con null se quita. */
export async function elegirResponsableDeSistemasAction(userId: string | null): Promise<Resultado> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sin permiso." };
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) return { ok: false, error: "Sin permiso." };
  try {
    const resultado = await elegirResponsableDeSistemas(access.workspaceId, esJefeDelNegocio(access), userId);
    if (!resultado.ok) return resultado;
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
  revalidatePath("/cliente/alertas");
  return { ok: true };
}
