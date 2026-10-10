import { prisma } from "@/lib/prisma";

import { algoPrendido, leerConfigDeTexto, type ConfigSeguimientoInteligente } from "../dominio/config";

/**
 * La configuración del seguimiento inteligente, con un minuto de memoria por proceso (se consulta
 * en cada mensaje y en cada automático). Sin fila o con la base caída: TODO APAGADO.
 */

const MEMORIA_MS = 60_000;
export const PREFIJO_CONFIG = "seguimiento-inteligente:config:";
export const claveConfigSeguimiento = (workspaceId: string) => `${PREFIJO_CONFIG}${workspaceId}`;

const configs = new Map<string, { valor: ConfigSeguimientoInteligente; vence: number }>();

export async function leerConfigSeguimiento(workspaceId: string): Promise<ConfigSeguimientoInteligente> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigSeguimientoInteligente;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigSeguimiento(workspaceId) } });
    valor = leerConfigDeTexto(fila?.value);
  } catch {
    valor = leerConfigDeTexto(null);
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}

export function olvidarConfigSeguimiento(workspaceId?: string) {
  if (workspaceId) configs.delete(workspaceId);
  else configs.clear();
}

/** Los negocios con algo prendido (para el reloj). */
export async function negociosConSeguimiento(): Promise<string[]> {
  const filas = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIJO_CONFIG } }, select: { key: true } });
  const salida: string[] = [];
  for (const fila of filas) {
    const workspaceId = fila.key.slice(PREFIJO_CONFIG.length);
    if (workspaceId && algoPrendido(await leerConfigSeguimiento(workspaceId))) salida.push(workspaceId);
  }
  return salida;
}
