import { prisma } from "@/lib/prisma";

import { type AjusteDePausaUso, ajusteDePausaUsoDeValor, umbralDePausaValido } from "./reglas-coordinador-en-vivo";

/*
  PAUSA POR USO DE CLAUDE (26-oct-2026, decisión del dueño): al llegar al umbral del plan de Claude (80 % por defecto)
  el Coordinador para todo y avisa. Acá vive el interruptor y el umbral, POR NEGOCIO, en AppSetting (sin migración):
  `tablero:pausa-uso-claude:<negocio>` = JSON { activa, umbral }. Sin fila: prendida al 80 %.
  El Coordinador (PC aizen1) los recibe en la respuesta de su latido (POST /api/trabajador/latido). Si el CRM no
  responde, usa lo de su config.local.json (pausaUso). El estado de la pausa vive en el PC del Coordinador, no acá.
*/

export const claveDeLaPausaPorUso = (workspaceId: string) => `tablero:pausa-uso-claude:${workspaceId}`;

/** El ajuste del negocio (el valor por defecto si no hay fila o está dañada). */
export async function leerPausaPorUso(workspaceId: string): Promise<AjusteDePausaUso> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeLaPausaPorUso(workspaceId) }, select: { value: true } });
  return ajusteDePausaUsoDeValor(fila?.value);
}

/** Cambia el interruptor y/o el umbral (50 a 95). Lo que no se manda queda como estaba. Devuelve el ajuste nuevo. */
export async function guardarPausaPorUso(workspaceId: string, cambios: { activa?: boolean; umbral?: number }): Promise<AjusteDePausaUso> {
  if (cambios.umbral !== undefined && umbralDePausaValido(cambios.umbral) === null) throw new Error("El umbral tiene que ser un porcentaje entre 50 y 95.");
  const actual = await leerPausaPorUso(workspaceId);
  const nuevo: AjusteDePausaUso = {
    activa: typeof cambios.activa === "boolean" ? cambios.activa : actual.activa,
    umbral: cambios.umbral === undefined ? actual.umbral : (umbralDePausaValido(cambios.umbral) as number),
  };
  const key = claveDeLaPausaPorUso(workspaceId);
  const value = JSON.stringify(nuevo);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return nuevo;
}
