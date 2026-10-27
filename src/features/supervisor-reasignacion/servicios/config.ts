import { prisma } from "@/lib/prisma";

import {
  claveConfigReasignacion,
  leerConfigReasignacionDeTexto,
  prefijoConfigReasignacion,
  type ConfigReasignacion,
} from "../dominio/reglas";

/**
 * Los ajustes del Supervisor de reasignación: AppSetting `supervisor:reasignacion:<negocio>` (JSON).
 * Sin fila, todo apagado. Va aparte del vigilante para que otros módulos (el Supervisor accionable)
 * puedan saber si los avisos nuevos están prendidos sin traer todo lo demás.
 */

const cache = new Map<string, { config: ConfigReasignacion; vence: number }>();

export async function leerConfigReasignacion(workspaceId: string): Promise<ConfigReasignacion> {
  const guardado = cache.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.config;
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigReasignacion(workspaceId) } }).catch(() => null);
  const config = leerConfigReasignacionDeTexto(fila?.value);
  cache.set(workspaceId, { config, vence: Date.now() + 30_000 });
  return config;
}

export function olvidarConfigReasignacion(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

export async function guardarConfigReasignacion(workspaceId: string, config: ConfigReasignacion): Promise<void> {
  const key = claveConfigReasignacion(workspaceId);
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  olvidarConfigReasignacion(workspaceId);
}

/** Los negocios con algún interruptor prendido. Una sola consulta por clave. */
export async function negociosConReasignacion(): Promise<Array<{ workspaceId: string; config: ConfigReasignacion }>> {
  try {
    const filas = await prisma.appSetting.findMany({
      where: { key: { startsWith: prefijoConfigReasignacion } },
      select: { key: true, value: true },
    });
    return filas
      .map((fila) => ({ workspaceId: fila.key.slice(prefijoConfigReasignacion.length), config: leerConfigReasignacionDeTexto(fila.value) }))
      .filter((n) => n.workspaceId && (n.config.avisosActivo || n.config.reasignacionActiva));
  } catch {
    return [];
  }
}
