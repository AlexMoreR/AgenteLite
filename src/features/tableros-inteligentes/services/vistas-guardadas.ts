import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  PREFERENCIAS_INICIALES,
  agregarVista,
  claveDeVistas,
  esVista,
  limpiarPreferencias,
  type PreferenciasDeVistas,
  type Vista,
} from "./vistas-de-tabla";

/*
  Las vistas del Tablero IA de CADA persona (2-nov-2026): su última vista (Tabla, Tablero, Calendario o
  Mapa) y sus vistas guardadas con nombre. Viven en AppSetting con la persona en la clave
  ("tablero-ia:vistas:<userId>"), el mismo patrón de los filtros guardados de chats: son pocos renglones
  por persona y no justifican una tabla nueva ni una migración. Son de cada quien: la forma de mirar de
  una persona no le aparece a las demás. El userId sale SIEMPRE de la sesión (lo pasa la acción).
*/

export async function leerPreferenciasDeVistas(userId: string): Promise<PreferenciasDeVistas> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeVistas(userId) }, select: { value: true } });
  return fila?.value ? limpiarPreferencias(fila.value) : { ...PREFERENCIAS_INICIALES, guardadas: [] };
}

async function guardarPreferencias(userId: string, preferencias: PreferenciasDeVistas) {
  const key = claveDeVistas(userId);
  const value = JSON.stringify(limpiarPreferencias(preferencias));
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Recordar la última vista de la persona. */
export async function guardarUltimaVista(userId: string, vista: unknown): Promise<void> {
  if (!esVista(vista)) throw new Error("Esa vista no existe.");
  const actuales = await leerPreferenciasDeVistas(userId);
  if (actuales.ultimaVista === vista) return;
  await guardarPreferencias(userId, { ...actuales, ultimaVista: vista as Vista });
}

/** Guardar una vista con nombre (si ya hay una con ese nombre, se reemplaza). Devuelve las vistas que quedan. */
export async function guardarVistaConNombre(userId: string, nombre: unknown, config: unknown) {
  const actuales = await leerPreferenciasDeVistas(userId);
  const nuevas = agregarVista(actuales, nombre, config, randomUUID());
  await guardarPreferencias(userId, nuevas);
  return nuevas.guardadas;
}

/** Borrar una vista guardada de la persona (las de fábrica no se borran). Devuelve las que quedan. */
export async function borrarVistaGuardada(userId: string, vistaId: unknown) {
  const actuales = await leerPreferenciasDeVistas(userId);
  const id = typeof vistaId === "string" ? vistaId : "";
  const guardadas = actuales.guardadas.filter((vista) => vista.id !== id);
  if (guardadas.length !== actuales.guardadas.length) await guardarPreferencias(userId, { ...actuales, guardadas });
  return guardadas;
}
