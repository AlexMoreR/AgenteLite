import { prisma } from "@/lib/prisma";

import {
  PREFIJO_CONFIG_REASIGNACION,
  claveConfigReasignacion,
  leerConfigReasignacionDeTexto,
  type ConfigReasignacion,
} from "../dominio/reglas";

/**
 * Los ajustes del vigilante de reasignación: AppSetting `supervisor:reasignacion:<workspaceId>`
 * (sin migración). Sin fila, o con la base caída, los dos interruptores quedan APAGADOS.
 */

export async function leerConfigReasignacion(workspaceId: string): Promise<ConfigReasignacion> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigReasignacion(workspaceId) } }).catch(() => null);
  return leerConfigReasignacionDeTexto(fila?.value);
}

export async function guardarConfigReasignacion(workspaceId: string, config: ConfigReasignacion): Promise<void> {
  const key = claveConfigReasignacion(workspaceId);
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Los negocios con al menos un interruptor prendido. Una sola consulta por clave. */
export async function negociosConVigilante(): Promise<Array<{ workspaceId: string; config: ConfigReasignacion }>> {
  try {
    const filas = await prisma.appSetting.findMany({
      where: { key: { startsWith: PREFIJO_CONFIG_REASIGNACION } },
      select: { key: true, value: true },
    });
    return filas
      .map((fila) => ({ workspaceId: fila.key.slice(PREFIJO_CONFIG_REASIGNACION.length), config: leerConfigReasignacionDeTexto(fila.value) }))
      .filter((n) => n.workspaceId && !n.workspaceId.includes(":") && (n.config.avisosActivo || n.config.reasignacionActiva));
  } catch {
    return [];
  }
}
