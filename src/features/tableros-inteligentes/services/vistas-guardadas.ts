/*
  Lo que cada persona deja guardado del Tablero IA: la última vista que usó (Tabla, Tablero, Calendario
  o Mapa) y sus vistas de la tabla con nombre. Vive en AppSetting con la persona en la clave
  (`tablero-ia:vistas:<userId>`), el mismo patrón de los filtros guardados de chats: son unos pocos
  renglones por persona y no justifican una tabla ni una migración. Así se recuerda en cualquier
  navegador con la misma cuenta.
*/
import { prisma } from "@/lib/prisma";

import { VISTA_POR_DEFECTO, esVista, limpiarConfig, type ConfigDeTabla, type Vista, type VistaDeTabla } from "./vistas-de-tabla";

export const claveDeVistas = (userId: string) => `tablero-ia:vistas:${userId}`;

/** Cuántas vistas se le dejan guardar a cada persona y el largo del nombre. */
export const MAXIMO_DE_VISTAS = 20;
export const LARGO_DEL_NOMBRE_DE_VISTA = 40;

export type PreferenciasDeVistas = { ultima: Vista; guardadas: VistaDeTabla[] };

/** Lo guardado, leído y limpio. Un valor dañado no deja la pantalla sin abrir: se empieza de cero. */
export function leerPreferencias(valor: string | null | undefined): PreferenciasDeVistas {
  const vacio: PreferenciasDeVistas = { ultima: VISTA_POR_DEFECTO, guardadas: [] };
  if (!valor) return vacio;
  try {
    const dato: unknown = JSON.parse(valor);
    if (typeof dato !== "object" || dato === null) return vacio;
    const { ultima, guardadas } = dato as { ultima?: unknown; guardadas?: unknown };
    const lista = Array.isArray(guardadas)
      ? guardadas
          .filter(
            (item): item is { id: string; nombre: string; config: unknown } =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { id?: unknown }).id === "string" &&
              typeof (item as { nombre?: unknown }).nombre === "string",
          )
          .slice(0, MAXIMO_DE_VISTAS)
          .map((item) => ({
            id: item.id.slice(0, 40),
            nombre: item.nombre.slice(0, LARGO_DEL_NOMBRE_DE_VISTA),
            config: limpiarConfig(item.config),
          }))
      : [];
    return { ultima: esVista(ultima) ? ultima : VISTA_POR_DEFECTO, guardadas: lista };
  } catch {
    return vacio;
  }
}

/** El nombre de una vista nueva, o el porqué no sirve. */
export function problemaDelNombreDeVista(nombre: unknown, guardadas: readonly VistaDeTabla[]): { nombre: string } | { error: string } {
  const limpio = typeof nombre === "string" ? nombre.trim().replace(/\s+/g, " ") : "";
  if (!limpio) return { error: "Ponle un nombre a la vista." };
  if (limpio.length > LARGO_DEL_NOMBRE_DE_VISTA) return { error: `El nombre es muy largo (máximo ${LARGO_DEL_NOMBRE_DE_VISTA} letras).` };
  if (guardadas.some((vista) => vista.nombre.toLowerCase() === limpio.toLowerCase())) {
    return { error: "Ya tienes una vista con ese nombre." };
  }
  if (guardadas.length >= MAXIMO_DE_VISTAS) return { error: `Ya tienes ${MAXIMO_DE_VISTAS} vistas guardadas: borra una primero.` };
  return { nombre: limpio };
}

export async function preferenciasDe(userId: string): Promise<PreferenciasDeVistas> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeVistas(userId) }, select: { value: true } });
  return leerPreferencias(fila?.value);
}

async function guardar(userId: string, preferencias: PreferenciasDeVistas) {
  const key = claveDeVistas(userId);
  const value = JSON.stringify(preferencias);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function guardarUltimaVista(userId: string, vista: unknown) {
  if (!esVista(vista)) throw new Error("Esa vista no existe.");
  const actual = await preferenciasDe(userId);
  if (actual.ultima === vista) return;
  await guardar(userId, { ...actual, ultima: vista });
}

export async function guardarVistaDeTabla(userId: string, nombre: unknown, config: unknown): Promise<VistaDeTabla[]> {
  const actual = await preferenciasDe(userId);
  const revisado = problemaDelNombreDeVista(nombre, actual.guardadas);
  if ("error" in revisado) throw new Error(revisado.error);
  const nueva: VistaDeTabla = {
    id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nombre: revisado.nombre,
    config: limpiarConfig(config) satisfies ConfigDeTabla,
  };
  const guardadas = [...actual.guardadas, nueva];
  await guardar(userId, { ...actual, guardadas });
  return guardadas;
}

export async function borrarVistaDeTabla(userId: string, id: unknown): Promise<VistaDeTabla[]> {
  const actual = await preferenciasDe(userId);
  const guardadas = actual.guardadas.filter((vista) => vista.id !== id);
  if (guardadas.length !== actual.guardadas.length) await guardar(userId, { ...actual, guardadas });
  return guardadas;
}
