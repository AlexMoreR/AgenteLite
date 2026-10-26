import { prisma } from "@/lib/prisma";

import { claveDelInterruptor, leerInterruptor } from "../dominio/reglas";

/**
 * El interruptor de un agente de área. Vive en AppSetting (`agente-area:<area>:<workspaceId>`) y NO
 * necesita tabla. Sin fila, o con algo ilegible, está APAGADO: el agente puede generar el resumen,
 * pero el servidor no deja salir ningún mensaje.
 */
export async function agenteActivo(workspaceId: string, area: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelInterruptor(area, workspaceId) } }).catch(() => null);
  return leerInterruptor(fila?.value);
}

export async function fijarInterruptor(workspaceId: string, area: string, activo: boolean): Promise<void> {
  const key = claveDelInterruptor(area, workspaceId);
  const value = JSON.stringify({ activo, cambiadoEn: new Date().toISOString() });
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
