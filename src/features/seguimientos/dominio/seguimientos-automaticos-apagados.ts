/*
  Freno general de los seguimientos automáticos (decisión del dueño, 9-11-2026).

  El bot se queda solo con los seguimientos de 15 min y 1 h del libro V3, con texto fijo; todo lo
  posterior a 1 hora lo hace el equipo a mano. Lo posterior a 1 hora son filas de Follow de clase
  "automatico" (embudo "Etapa …", reglas, "Sin responder…", "Inteligente: …", "Tras asesora: …").
  Con la fila `seguimientos-automaticos:apagado` = "si" en AppSetting, esos se cancelan al llegar su
  hora. El reloj del V3 no usa Follow, así que este freno no lo alcanza.

  Se decide por la clase y no por el plazo, porque los "Tras asesora" se guardan con timeValue 0.
  Código puro, sin base: la lectura de la fila la hace el motor de seguimientos (follows.ts).
*/
import type { ClaseDeFollow } from "@/lib/anti-bloqueo/reglas";

export const CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS = "seguimientos-automaticos:apagado";

/**
 * true = el Follow se cancela. Solo los de clase "automatico" y solo con la fila en "si" (con trim y
 * en minúsculas). Los de una persona, campaña, automatización o reactivación nunca. Sin fila o con
 * "no", nada se cancela.
 */
export function seCancelaPorSeguimientosAutomaticosApagados(
  clase: ClaseDeFollow,
  valorDeLaFila: string | null | undefined,
): boolean {
  if (clase !== "automatico") return false;
  return (valorDeLaFila ?? "").trim().toLowerCase() === "si";
}
