import { prisma } from "@/lib/prisma";

import { claveInterruptorDelAgente, interpretarInterruptor, numeroCanonico, type Area } from "../dominio/reglas";

/**
 * EL INTERRUPTOR DEL AGENTE DE ÁREA Y LA LISTA DEL EQUIPO. APAGADO POR DEFECTO.
 *
 * - `agente-area:<area>:<workspaceId>` en AppSetting. Sin fila, o con cualquier otro valor, está
 *   apagado: el agente genera el resumen pero el servidor no deja salir ningún WhatsApp.
 * - La lista del equipo es la de "Mi empresa → Equipo" (`agente-v3:avisos:<workspaceId>`): la misma
 *   que usan los avisos. Aquí solo se LEE; no se cambia.
 */

export async function agenteActivo(area: Area, workspaceId: string): Promise<boolean> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorDelAgente(area, workspaceId) } });
    return interpretarInterruptor(fila?.value);
  } catch {
    // Si no se puede leer, apagado: nunca decidir mandar sin saber.
    return false;
  }
}

export async function guardarInterruptor(area: Area, workspaceId: string, activo: boolean): Promise<void> {
  const key = claveInterruptorDelAgente(area, workspaceId);
  const value = JSON.stringify({ activo });
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export type PersonaDelEquipo = { numero: string; userId: string | null; soloDe: string | null };

type AvisosCrudos = { destinos?: Array<{ numero?: string; soloDe?: string | null; userId?: string }> };

/** Los números de la lista de avisos del negocio (Mi empresa → Equipo), en forma canónica. */
export async function leerEquipoDeAvisos(workspaceId: string): Promise<PersonaDelEquipo[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `agente-v3:avisos:${workspaceId}` } }).catch(() => null);
  let crudo: AvisosCrudos = {};
  try {
    crudo = fila?.value ? (JSON.parse(fila.value) as AvisosCrudos) : {};
  } catch {
    crudo = {};
  }
  const personas: PersonaDelEquipo[] = [];
  for (const destino of crudo.destinos ?? []) {
    const numero = numeroCanonico(destino.numero);
    if (numero.length < 10) continue;
    personas.push({ numero, userId: destino.userId ?? null, soloDe: destino.soloDe ?? null });
  }
  return personas;
}
