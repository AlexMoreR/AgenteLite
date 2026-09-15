"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { crearClaveMcp, revocarClaveMcp } from "@/lib/mcp/claves";

const RUTA = "/cliente/claude";

/** Conectar Claude al negocio es decision del dueño o de un administrador. */
async function accesoDeJefe() {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
  return esJefe ? access : null;
}

export async function crearClaveMcpAction(nombre: string) {
  const access = await accesoDeJefe();
  const session = await auth();
  if (!access || !session?.user?.id) {
    return { error: "Solo el dueño o un administrador" };
  }
  const clave = await crearClaveMcp({
    workspaceId: access.workspaceId,
    userId: session.user.id,
    nombre: typeof nombre === "string" ? nombre : "",
  });
  revalidatePath(RUTA);
  // Unica vez que la clave sale del servidor: despues solo queda su huella.
  return { ok: true as const, clave };
}

export async function revocarClaveMcpAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) {
    return { error: "Solo el dueño o un administrador" };
  }
  const revocada = await revocarClaveMcp(access.workspaceId, typeof id === "string" ? id : "");
  if (!revocada) {
    return { error: "Esa clave ya no existe" };
  }
  revalidatePath(RUTA);
  return { ok: true as const };
}
