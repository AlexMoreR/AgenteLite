"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { publicarAgenteV2 } from "@/app/actions/agent-v2-actions";
import { crearClaveMcp, revocarClaveMcp } from "@/lib/mcp/claves";
import { deshacerCambioMcp } from "@/lib/mcp/cambios";

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

/**
 * Deshacer un cambio que hizo Claude, desde la app.
 *
 * El mismo boton existe en el chat (`deshacer_cambio`), pero la vuelta atras no puede depender de
 * tener Claude abierto: si algo quedo mal y el agente esta contestando raro, hay que poder
 * arreglarlo desde el celular (Alex, 18-sep-2026).
 */
export async function deshacerCambioMcpAction(cambioId: string) {
  const access = await accesoDeJefe();
  if (!access) {
    return { error: "Solo el dueño o un administrador" };
  }
  const resultado = await deshacerCambioMcp(access.workspaceId, typeof cambioId === "string" ? cambioId : "");
  if (!resultado.ok) {
    return { error: resultado.error };
  }
  // Si lo que se deshizo era del agente, hay que volver a publicarlo o sigue contestando con lo otro.
  if (resultado.agenteId) {
    await publicarAgenteV2({ agentId: resultado.agenteId, workspaceId: access.workspaceId });
  }
  revalidatePath(RUTA);
  return { ok: true as const, titulo: resultado.titulo };
}
