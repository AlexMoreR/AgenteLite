import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { prisma } from "@/lib/prisma";
import { leerConfigTurno } from "@/lib/turno-config";

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
  // "No leyó → no insistir" sigue el MISMO interruptor que el freno de automáticos (anti-bloqueo
  // `noLeido.activo`, apagado por defecto desde el 11-10-2026).
  const antiBloqueo = await leerConfigAntiBloqueo(workspaceId);
  valor = { ...valor, motor: { ...valor.motor, respetarNoLeido: antiBloqueo.noLeido.activo } };
  // El turno de la conversación tiene su propio interruptor (`turno:config:<ws>`), compartido con el Supervisor.
  const turno = await leerConfigTurno(workspaceId).catch(() => null);
  valor = { ...valor, turno: { activo: Boolean(turno?.activo), cadenciaSinTarea: turno?.cadenciaSinTarea ?? true } };
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
    if (!workspaceId) continue;
    const config = await leerConfigSeguimiento(workspaceId);
    // El "día siguiente" que se re-arma tiene su propio interruptor (no prende el motor).
    if (algoPrendido(config) || config.diaSiguiente.rearmar) salida.push(workspaceId);
  }
  return salida;
}
