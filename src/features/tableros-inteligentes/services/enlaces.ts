/*
  Links del Tablero IA que usan los avisos por WhatsApp (24-oct-2026). Archivo puro, sin base ni Next,
  para que lo carguen también el resumen diario y sus pruebas.
*/

export const URL_APP = "https://app.aizenbot.com";
export const RUTA_TABLEROS = "/cliente/tablero-ia";

/** Vistas del inicio que se pueden abrir por link (?vista=...). */
export type VistaPorLink = "hoy" | "coordinador";

/** Un solo link que abre el inicio del tablero ya en la vista pedida: "hoy" (lo de hoy y "te toca a ti") por defecto. */
export function linkDeVista(vista: VistaPorLink = "hoy") {
  return `${URL_APP}${RUTA_TABLEROS}?vista=${vista}`;
}
