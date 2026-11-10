"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  correrAutomatizacion,
  detenerEnvios,
  guardarAutomatizaciones,
  leerAutomatizaciones,
  validarReferencias,
  vistaPrevia,
  type Conteo,
  type LeadDeLaVistaPrevia,
} from "@/features/automatizaciones/servicio";
import {
  criteriosDelBorrador,
  limpiarAutomatizacion,
  problemaDelBorrador,
  type Automatizacion,
  type BorradorDeAutomatizacion,
} from "@/features/automatizaciones/tipos";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

const RUTA = "/cliente/automatizaciones";

/**
 * Solo el dueño, administradores y supervisoras. Mover o escribirle a leads en cantidad es una
 * decisión de jefe; las asesoras siguen haciendo lo suyo chat por chat desde Chats.
 */
async function accesoDeJefe() {
  const access = await requireClientWorkspaceAccess();
  return (await puedeSupervisar(access)) ? access : null;
}

const SIN_PERMISO = { error: "Solo el dueño o un administrador" } as const;

export type RespuestaDeVistaPrevia = { error: string } | { conteo: Conteo; leads: LeadDeLaVistaPrevia[] };

/** Cuántos y cuáles leads tomaría (la guardada por id, o el borrador del editor). */
export async function vistaPreviaAction(entrada: { id?: string; borrador?: BorradorDeAutomatizacion }): Promise<RespuestaDeVistaPrevia> {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;
  if (entrada.id) {
    const guardada = (await leerAutomatizaciones(access.workspaceId)).find((a) => a.id === entrada.id);
    if (!guardada) return { error: "Esa automatización ya no existe" };
    return vistaPrevia(access.workspaceId, guardada);
  }
  // Borrador: se cuenta con lo que tenga (sin nombre o sin acciones también).
  if (!entrada.borrador) return { error: "Nada para contar" };
  return vistaPrevia(access.workspaceId, { ...criteriosDelBorrador(entrada.borrador), id: entrada.borrador.id }, 20);
}

export async function guardarAutomatizacionAction(borrador: BorradorDeAutomatizacion) {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;

  const problema = problemaDelBorrador(borrador);
  if (problema) return { error: problema };
  const limpia = limpiarAutomatizacion(borrador);
  if (!limpia) return { error: "Falta el nombre o una acción" };
  const referencias = await validarReferencias(access.workspaceId, limpia);
  if ("error" in referencias) return { error: referencias.error };

  const lista = await leerAutomatizaciones(access.workspaceId);
  const existente = borrador.id ? lista.find((item) => item.id === borrador.id) : undefined;
  const guardada: Automatizacion = {
    ...limpia,
    id: existente?.id ?? randomUUID(),
    historial: existente?.historial ?? [],
    ultimaAutomaticaEn: existente?.ultimaAutomaticaEn ?? null,
  };
  const siguiente = existente ? lista.map((item) => (item.id === guardada.id ? guardada : item)) : [...lista, guardada];

  await guardarAutomatizaciones(access.workspaceId, siguiente);
  revalidatePath(RUTA);
  return { ok: true as const };
}

/** Prende / apaga "Automática" sin abrir el editor. */
export async function cambiarAutomaticaAction(id: string, automatica: boolean) {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;
  const lista = await leerAutomatizaciones(access.workspaceId);
  if (!lista.some((a) => a.id === id)) return { error: "Esa automatización ya no existe" };
  await guardarAutomatizaciones(
    access.workspaceId,
    lista.map((a) => (a.id === id ? { ...a, automatica } : a)),
  );
  revalidatePath(RUTA);
  return { ok: true as const };
}

export async function borrarAutomatizacionAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;
  const lista = await leerAutomatizaciones(access.workspaceId);
  await guardarAutomatizaciones(
    access.workspaceId,
    lista.filter((item) => item.id !== id),
  );
  // Lo que dejó agendado no sale sin su automatización.
  await detenerEnvios(access.workspaceId, id);
  revalidatePath(RUTA);
  return { ok: true as const };
}

export async function detenerEnviosAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;
  const detenidos = await detenerEnvios(access.workspaceId, id);
  revalidatePath(RUTA);
  return { ok: true as const, detenidos };
}

export async function ejecutarAutomatizacionAction(id: string) {
  const access = await accesoDeJefe();
  if (!access) return SIN_PERMISO;

  const automatizacion = (await leerAutomatizaciones(access.workspaceId)).find((item) => item.id === id);
  if (!automatizacion) return { error: "Esa automatización ya no existe" };

  const session = await auth();
  const quien = { id: session?.user?.id ?? null, nombre: session?.user?.name?.trim() || "Un administrador" };
  const respuesta = await correrAutomatizacion({ workspaceId: access.workspaceId, automatizacion, quien, origen: "manual" });

  revalidatePath(RUTA);
  revalidatePath("/cliente/chats");
  if ("error" in respuesta) return { error: respuesta.error };
  return {
    ok: true as const,
    leads: respuesta.resultado.leads,
    envios: respuesta.resultado.envios,
    errores: respuesta.resultado.errores.length,
    ultimaTandaEn: respuesta.resultado.ultimaTandaEn?.toISOString() ?? null,
  };
}
