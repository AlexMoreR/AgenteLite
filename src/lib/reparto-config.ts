import { prisma } from "@/lib/prisma";

import { CONFIG_REPARTO_DE_SIEMPRE, claveConfigReparto, leerConfigRepartoDeTexto, type ConfigReparto } from "./turno-con-contenido";

/**
 * El interruptor del reparto por turno (`reparto:config:<workspaceId>`), con un minuto de memoria
 * por proceso. Sin fila o con la base caída: como antes del 12-10-2026 (no exige precio o fotos).
 */

const MEMORIA_MS = 60_000;
const configs = new Map<string, { valor: ConfigReparto; vence: number }>();

export async function leerConfigReparto(workspaceId: string): Promise<ConfigReparto> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigReparto;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigReparto(workspaceId) } });
    valor = leerConfigRepartoDeTexto(fila?.value);
  } catch {
    valor = CONFIG_REPARTO_DE_SIEMPRE;
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}
