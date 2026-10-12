import { prisma } from "@/lib/prisma";

import { CONFIG_TURNO_APAGADO, claveConfigTurno, leerConfigTurnoDeTexto, type ConfigTurno } from "./turno-de-la-conversacion";

/**
 * El interruptor del turno de la conversación (`turno:config:<workspaceId>`), con un minuto de
 * memoria por proceso. Sin fila o con la base caída: APAGADO (todo como antes).
 */

const MEMORIA_MS = 60_000;
const configs = new Map<string, { valor: ConfigTurno; vence: number }>();

export async function leerConfigTurno(workspaceId: string): Promise<ConfigTurno> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigTurno;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigTurno(workspaceId) } });
    valor = leerConfigTurnoDeTexto(fila?.value);
  } catch {
    valor = CONFIG_TURNO_APAGADO;
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}

export function olvidarConfigTurno(workspaceId?: string) {
  if (workspaceId) configs.delete(workspaceId);
  else configs.clear();
}
