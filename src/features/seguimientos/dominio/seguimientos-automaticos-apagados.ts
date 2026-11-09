/*
  FRENO GENERAL DE LOS SEGUIMIENTOS AUTOMÁTICOS (decisión del dueño, 9-11-2026).

  El bot se queda solo con los seguimientos de 15 min y 1 h del libro V3 (reloj del V3, que no usa
  Follow). Todo lo posterior a 1 hora lo hace el equipo a mano. Lo posterior a 1 hora son filas de
  Follow de clase "automatico": embudo ("Etapa …"), reglas (followRuleId), "Sin responder …",
  "Inteligente: …" y "Tras asesora: …".

  Se decide por la CLASE del Follow y no por su plazo, porque los "Tras asesora" se guardan con
  timeValue 0. Las asesoras ("humano"), las campañas, las automatizaciones y la reactivación no se
  tocan: esas las decide una persona.

  Código puro, sin base: el motor de Follows lee la fila de AppSetting y llama a esta función.
*/
import type { ClaseDeFollow } from "@/lib/anti-bloqueo/reglas";

/** Fila de AppSetting que prende el freno. Con "si" no salen los Follow automáticos. */
export const CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS = "seguimientos-automaticos:apagado";

/** true = este Follow no sale (se cancela con el motivo "seguimiento_apagado"). */
export function seCancelaPorSeguimientosAutomaticosApagados(
  clase: ClaseDeFollow,
  valorDeLaFila: string | null | undefined,
): boolean {
  if (clase !== "automatico") return false;
  return (valorDeLaFila ?? "").trim().toLowerCase() === "si";
}
