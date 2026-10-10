"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  lanzarRelleno,
  leerEstadoDelRelleno,
  type EstadoDelRelleno,
  type ModoDelRelleno,
} from "@/features/embudo/servicios/relleno";

/**
 * Relleno histórico del embudo desde /cliente/crm/embudo (sección "Historia").
 * Solo el dueño del negocio (o un admin de la plataforma): el mismo criterio que `ownerOnly`
 * de requireClientWorkspaceAccess. Se verifica aquí, en el servidor, en cada llamada.
 */
async function accesoDelDueno() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!access.isOwner && access.role !== "ADMIN") {
    return null;
  }
  return access;
}

export async function lanzarRellenoAction(input: {
  modo: ModoDelRelleno;
  lineaId: string;
  desde: string;
  hasta: string;
}): Promise<{ ok: boolean; error?: string; estado?: EstadoDelRelleno | null }> {
  const access = await accesoDelDueno();
  if (!access) {
    return { ok: false, error: "Solo el dueño del negocio puede reconstruir la historia del embudo." };
  }
  const resultado = await lanzarRelleno({
    workspaceId: access.workspaceId,
    userId: access.userId,
    lineaId: String(input?.lineaId ?? ""),
    desde: String(input?.desde ?? ""),
    hasta: String(input?.hasta ?? ""),
    modo: input?.modo === "guardar" ? "guardar" : "simular",
  });
  const estado = await leerEstadoDelRelleno(access.workspaceId);
  return resultado.ok ? { ok: true, estado } : { ok: false, error: resultado.error, estado };
}

export async function estadoDelRellenoAction(): Promise<{ ok: boolean; error?: string; estado?: EstadoDelRelleno | null }> {
  const access = await accesoDelDueno();
  if (!access) {
    return { ok: false, error: "Solo el dueño del negocio puede ver esto." };
  }
  return { ok: true, estado: await leerEstadoDelRelleno(access.workspaceId) };
}
