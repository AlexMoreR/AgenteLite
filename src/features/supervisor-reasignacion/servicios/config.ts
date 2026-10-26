import { prisma } from "@/lib/prisma";

import { claveConfigReasignacion, leerConfigDeTexto, type ConfigReasignacion } from "../dominio/reglas";

/**
 * Los ajustes del Supervisor de avisos y reasignación. Viven en AppSetting
 * `supervisor:reasignacion:<workspaceId>` (JSON): sin fila, los dos interruptores están apagados y
 * no pasa nada. Se lee con una caché de un minuto: el vigilante corre cada minuto.
 */

const cache = new Map<string, { config: ConfigReasignacion; vence: number }>();

export async function leerConfigReasignacion(workspaceId: string): Promise<ConfigReasignacion> {
  const guardado = cache.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.config;
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigReasignacion(workspaceId) } }).catch(() => null);
  const config = leerConfigDeTexto(fila?.value);
  cache.set(workspaceId, { config, vence: Date.now() + 60_000 });
  return config;
}

export async function guardarConfigReasignacion(workspaceId: string, config: ConfigReasignacion): Promise<void> {
  const key = claveConfigReasignacion(workspaceId);
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.delete(workspaceId);
}

/** Los negocios que tienen alguno de los dos interruptores prendidos. */
export async function negociosConReasignacion(): Promise<string[]> {
  const filas = await prisma.appSetting.findMany({ where: { key: { startsWith: "supervisor:reasignacion:" } }, select: { key: true, value: true } });
  return filas
    .filter((fila) => {
      const config = leerConfigDeTexto(fila.value);
      return config.avisosActivo || config.reasignacionActiva;
    })
    .map((fila) => fila.key.slice("supervisor:reasignacion:".length));
}
