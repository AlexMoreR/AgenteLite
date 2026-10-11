import { prisma } from "@/lib/prisma";

import type { EstadoDeAccion, EstadoGuardado } from "../dominio/acciones-de-hoy";

/**
 * Lo que necesita "Acciones de hoy" ademas del informe: el id de cada chat (para abrirlo exacto en
 * la bandeja) y el estado que marco una persona en cada tarjeta.
 *
 * El estado va en AppSetting, sin migracion: una fila por negocio + dia del informe + asesora,
 * `coach:accion:<workspaceId>:<dia>:<userId>` = {"estado":"en_progreso","por":"<userId>","en":"<iso>"}.
 */

export const ESTADOS_DE_ACCION: EstadoDeAccion[] = ["pendiente", "en_progreso", "cumplido"];

export const claveDeEstado = (workspaceId: string, dia: string, userId: string) => `coach:accion:${workspaceId}:${dia}:${userId}`;

/** numero corto -> Conversation.id, solo de este negocio. */
export async function conversacionesPorNumero(workspaceId: string, numeros: number[]): Promise<Record<number, string>> {
  const unicos = [...new Set(numeros.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!unicos.length) return {};
  const filas = await prisma.conversation.findMany({
    where: { workspaceId, numero: { in: unicos } },
    select: { id: true, numero: true },
  });
  const salida: Record<number, string> = {};
  for (const fila of filas) if (typeof fila.numero === "number") salida[fila.numero] = fila.id;
  return salida;
}

export async function leerEstadosDeAcciones(
  workspaceId: string,
  dia: string,
  userIds: string[],
): Promise<Record<string, EstadoGuardado>> {
  if (!userIds.length) return {};
  const filas = await prisma.appSetting.findMany({
    where: { key: { in: userIds.map((u) => claveDeEstado(workspaceId, dia, u)) } },
  });
  const salida: Record<string, EstadoGuardado> = {};
  for (const fila of filas) {
    const userId = fila.key.split(":").pop() ?? "";
    try {
      const valor = JSON.parse(fila.value) as EstadoGuardado;
      if (ESTADOS_DE_ACCION.includes(valor.estado)) salida[userId] = valor;
    } catch {
      // Fila rota: se ignora y la tarjeta queda "pendiente".
    }
  }
  return salida;
}

export async function guardarEstadoDeAccion(input: {
  workspaceId: string;
  dia: string;
  userId: string;
  estado: EstadoDeAccion;
  por: string;
}) {
  const key = claveDeEstado(input.workspaceId, input.dia, input.userId);
  const value = JSON.stringify({ estado: input.estado, por: input.por, en: new Date().toISOString() } satisfies EstadoGuardado);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
