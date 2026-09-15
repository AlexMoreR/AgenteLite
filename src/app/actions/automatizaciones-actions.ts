"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  contarLeads,
  ejecutarAsignacion,
  guardarAutomatizaciones,
  leerAutomatizaciones,
} from "@/features/automatizaciones/servicio";
import {
  limpiarAutomatizacion,
  type AutomatizacionDeAsignacion,
  type BorradorDeAutomatizacion,
} from "@/features/automatizaciones/tipos";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

const RUTA = "/cliente/automatizaciones";

/**
 * Solo el dueno o un administrador del negocio. Mover leads de una asesora a otra en cantidad es
 * una decision de jefe; las asesoras siguen pudiendo pasar SUS chats uno por uno desde Chats.
 */
async function accesoDeJefe() {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
  return esJefe ? access : null;
}

async function validarReferencias(workspaceId: string, borrador: { asignarA: string; canalId: string | null; dueno: string }) {
  const [destino, canal, duenoActual] = await Promise.all([
    prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: borrador.asignarA, isActive: true },
      select: { user: { select: { name: true, email: true } } },
    }),
    borrador.canalId
      ? prisma.whatsAppChannel.findFirst({ where: { id: borrador.canalId, workspaceId }, select: { id: true } })
      : Promise.resolve({ id: "" }),
    borrador.dueno.startsWith("de:")
      ? prisma.workspaceMember.findFirst({
          where: { workspaceId, userId: borrador.dueno.slice(3) },
          select: { userId: true },
        })
      : Promise.resolve({ userId: "" }),
  ]);
  if (!destino) return { error: "La persona a quien asignar no es del equipo" };
  if (!canal) return { error: "Ese canal no es de este negocio" };
  if (!duenoActual) return { error: "La persona de \"dueño actual\" no es del equipo" };
  return { destinoNombre: destino.user?.name?.trim() || destino.user?.email || "un colaborador" };
}

export async function contarAutomatizacionAction(borrador: BorradorDeAutomatizacion) {
  const access = await accesoDeJefe();
  if (!access) return { error: "Solo el dueño o un administrador" };
  const limpia = limpiarAutomatizacion(borrador);
  if (!limpia) return { total: 0, tomaria: 0, noLoVeria: 0 };
  return contarLeads(access.workspaceId, limpia);
}

export async function guardarAutomatizacionAction(borrador: BorradorDeAutomatizacion) {
  const access = await accesoDeJefe();
  if (!access) return { error: "Solo el dueño o un administrador" };

  const limpia = limpiarAutomatizacion(borrador);
  if (!limpia) return { error: "Falta el nombre o a quién asignar" };
  const referencias = await validarReferencias(access.workspaceId, limpia);
  if ("error" in referencias) return { error: referencias.error };

  const lista = await leerAutomatizaciones(access.workspaceId);
  const existente = borrador.id ? lista.find((item) => item.id === borrador.id) : undefined;
  const guardada: AutomatizacionDeAsignacion = {
    ...limpia,
    id: existente?.id ?? randomUUID(),
    ultimaEjecucion: existente?.ultimaEjecucion ?? null,
  };
  const siguiente = existente
    ? lista.map((item) => (item.id === guardada.id ? guardada : item))
    : [...lista, guardada];

  await guardarAutomatizaciones(access.workspaceId, siguiente);
  revalidatePath(RUTA);
  return { ok: true as const };
}

export async function borrarAutomatizacionAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) return { error: "Solo el dueño o un administrador" };
  const lista = await leerAutomatizaciones(access.workspaceId);
  await guardarAutomatizaciones(
    access.workspaceId,
    lista.filter((item) => item.id !== id),
  );
  revalidatePath(RUTA);
  return { ok: true as const };
}

export async function ejecutarAutomatizacionAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) return { error: "Solo el dueño o un administrador" };

  const lista = await leerAutomatizaciones(access.workspaceId);
  const automatizacion = lista.find((item) => item.id === id);
  if (!automatizacion) return { error: "Esa automatización ya no existe" };

  // Se revalida al ejecutar, no solo al guardar: la persona pudo irse del equipo desde entonces.
  const referencias = await validarReferencias(access.workspaceId, automatizacion);
  if ("error" in referencias) return { error: referencias.error };

  const session = await auth();
  const quien = session?.user?.name?.trim() || "Un administrador";

  const asignados = await ejecutarAsignacion({
    workspaceId: access.workspaceId,
    criterios: automatizacion,
    textoDeLaNota: `${quien} asignó a ${referencias.destinoNombre} (automatización «${automatizacion.nombre}»)`,
  });

  await guardarAutomatizaciones(
    access.workspaceId,
    lista.map((item) =>
      item.id === id
        ? { ...item, ultimaEjecucion: { fecha: new Date().toISOString(), asignados, por: quien } }
        : item,
    ),
  );

  revalidatePath(RUTA);
  revalidatePath("/cliente/chats");
  return { ok: true as const, asignados, destinoNombre: referencias.destinoNombre };
}
