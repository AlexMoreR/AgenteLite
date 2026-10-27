"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { marcarAlerta } from "@/features/alertas/servicios/alertas";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

/**
 * MARCAR UNA ALERTA como vista o resuelta. Solo lo hace quien ve la página (dueño o administrador del negocio) y
 * solo sobre alertas de SU negocio: el servicio filtra por workspaceId.
 */

type Resultado = { ok: true } | { ok: false; error: string };

export async function marcarAlertaAction(id: string, nuevo: "VISTA" | "RESUELTA"): Promise<Resultado> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sin permiso." };
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !esJefeDelNegocio(access)) return { ok: false, error: "Sin permiso." };
  if (typeof id !== "string" || !id || (nuevo !== "VISTA" && nuevo !== "RESUELTA")) return { ok: false, error: "Pedido inválido." };
  try {
    const existe = await marcarAlerta(access.workspaceId, id, nuevo);
    if (!existe) return { ok: false, error: "No se encontró la alerta." };
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
  revalidatePath("/cliente/alertas");
  return { ok: true };
}
