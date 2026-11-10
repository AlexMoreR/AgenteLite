import { prisma } from "@/lib/prisma";

import {
  claveDePreferenciaDePastillas,
  limpiarPreferencia,
  type PreferenciaDePastillas,
} from "../domain/orden-de-las-pastillas";

/**
 * Lo que cada persona guarda de su bandeja en AppSetting, con su userId en la clave:
 * - `chats:filtros:<userId>`: sus listas guardadas (las escribe /api/cliente/chats/filtros-guardados).
 * - `chats:pastillas:<userId>`: el orden y las ocultas de su fila de pastillas (/api/cliente/chats/pastillas).
 *
 * Sin tabla propia ni migracion: son unos pocos renglones por persona.
 */

export type ListaGuardada = { id: string; nombre: string; query: string };

export function claveDeListasGuardadas(userId: string): string {
  return `chats:filtros:${userId}`;
}

/** Las listas de esta persona. Un valor ilegible da ninguna: la bandeja abre igual. */
export async function leerListasGuardadas(userId: string): Promise<ListaGuardada[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeListasGuardadas(userId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const datos = JSON.parse(fila.value);
    if (!Array.isArray(datos)) {
      return [];
    }
    return datos.filter(
      (item): item is ListaGuardada =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.nombre === "string" &&
        typeof item.query === "string",
    );
  } catch {
    return [];
  }
}

/** El orden y las ocultas de esta persona, ya limpios contra sus listas de hoy. */
export async function leerPreferenciaDePastillas(
  userId: string,
  idsDeListas: readonly string[],
): Promise<PreferenciaDePastillas> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDePreferenciaDePastillas(userId) } });
  return limpiarPreferencia(fila?.value ?? null, idsDeListas);
}

export async function guardarPreferenciaDePastillas(userId: string, preferencia: PreferenciaDePastillas): Promise<void> {
  const key = claveDePreferenciaDePastillas(userId);
  const value = JSON.stringify({ orden: preferencia.orden, ocultas: preferencia.ocultas });
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
