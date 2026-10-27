"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { leerConfigSeguimiento } from "@/features/seguimiento-inteligente/servicios/config";
import { aprobadorDeRecuperacion, deshacerDescarte, resolverAprobacion } from "@/features/seguimiento-inteligente/servicios/recuperacion";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/**
 * RECUPERACIÓN 72 H: lo que decide una persona.
 *  - Aprobar / no aprobar el descarte de un lead con intención fuerte: la aprobadora configurada
 *    (por defecto la supervisora del Supervisor accionable) o quien puede supervisar.
 *  - Deshacer un descarte de la recuperación: quien puede supervisar.
 * No le escriben al cliente. Devuelven un error legible si no se pudo.
 */

type Resultado = { ok: true } | { ok: false; error: string };

async function quien(): Promise<{ workspaceId: string; id: string; nombre: string; supervisa: boolean } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) return null;
  const usuario = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } });
  return {
    workspaceId: access.workspaceId,
    id: session.user.id,
    nombre: usuario?.name?.trim() || usuario?.email || "Supervisora",
    supervisa: await puedeSupervisar(access),
  };
}

function idValido(valor: unknown): string | null {
  const id = typeof valor === "string" ? valor.trim() : "";
  return id && id.length <= 64 ? id : null;
}

export async function resolverAprobacionDeRecuperacionAction(conversationId: string, aprobar: boolean): Promise<Resultado> {
  const yo = await quien();
  const id = idValido(conversationId);
  if (!yo || !id) return { ok: false, error: "Sin permiso." };
  const config = await leerConfigSeguimiento(yo.workspaceId);
  const aprobadora = await aprobadorDeRecuperacion(yo.workspaceId, config);
  if (!yo.supervisa && aprobadora !== yo.id) return { ok: false, error: "Solo la supervisora aprueba estos descartes." };
  const resultado = await resolverAprobacion({ workspaceId: yo.workspaceId, conversationId: id, usuario: { id: yo.id, nombre: yo.nombre }, aprobar: Boolean(aprobar) });
  revalidatePath("/cliente/direccion/supervisor");
  revalidatePath("/cliente/crm/mi-dia");
  return resultado;
}

export async function deshacerDescarteDeRecuperacionAction(conversationId: string): Promise<Resultado> {
  const yo = await quien();
  const id = idValido(conversationId);
  if (!yo || !id || !yo.supervisa) return { ok: false, error: "Sin permiso." };
  const resultado = await deshacerDescarte({ workspaceId: yo.workspaceId, conversationId: id, usuario: { id: yo.id, nombre: yo.nombre } });
  revalidatePath("/cliente/direccion/supervisor");
  return resultado;
}
