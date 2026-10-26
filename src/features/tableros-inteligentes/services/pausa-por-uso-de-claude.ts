import { prisma } from "@/lib/prisma";

import { UMBRAL_DE_PAUSA_MAXIMO, UMBRAL_DE_PAUSA_MINIMO, ajusteDePausaDeTexto, umbralDePausaValido, type AjusteDePausaPorUso } from "./reglas-coordinador-en-vivo";

/*
  PAUSA POR USO DE CLAUDE (26-oct-2026, decisión del dueño): todo el desarrollo se construye en la nube de Claude, así
  que si el plan se agota se cae TODO (desarrollo, voz y chat). El Coordinador mide el porcentaje de uso y, al llegar al
  umbral, se pausa (trabajador-tablero/lib/motores.mjs). Acá vive el INTERRUPTOR y el UMBRAL: son un ajuste por negocio
  (AppSetting `tablero:pausa-uso-claude:<negocio>`, JSON { prendida, umbral }), sin migración. Sin la fila: prendido al 80 %.
  El Coordinador lo recibe en la respuesta de cada latido (coordinador-en-vivo.ts: guardarLatido).
*/

export const clavePausaPorUsoDeClaude = (workspaceId: string) => `tablero:pausa-uso-claude:${workspaceId}`;

export async function leerPausaPorUsoDeClaude(workspaceId: string): Promise<AjusteDePausaPorUso> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clavePausaPorUsoDeClaude(workspaceId) }, select: { value: true } });
  return ajusteDePausaDeTexto(fila?.value);
}

/** Guarda el interruptor y/o el umbral (los que no se pasan quedan como estaban). Un umbral fuera de 50 a 95 es un error. */
export async function guardarPausaPorUsoDeClaude(workspaceId: string, cambio: { prendida?: boolean; umbral?: number }): Promise<AjusteDePausaPorUso> {
  const actual = await leerPausaPorUsoDeClaude(workspaceId);
  let umbral = actual.umbral;
  if (cambio.umbral !== undefined) {
    const valido = umbralDePausaValido(cambio.umbral);
    if (valido === null) throw new Error(`El umbral tiene que ser un número de ${UMBRAL_DE_PAUSA_MINIMO} a ${UMBRAL_DE_PAUSA_MAXIMO} %.`);
    umbral = valido;
  }
  const nuevo: AjusteDePausaPorUso = { prendida: cambio.prendida ?? actual.prendida, umbral };
  const key = clavePausaPorUsoDeClaude(workspaceId);
  const value = JSON.stringify(nuevo);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return nuevo;
}
