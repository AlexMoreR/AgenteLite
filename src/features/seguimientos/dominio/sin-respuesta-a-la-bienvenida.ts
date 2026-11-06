/**
 * ¿El cliente ya respondió nuestra bienvenida? (código puro, sin dependencias).
 *
 * Si el cliente no ha escrito nada después de nuestro PRIMER mensaje, los seguimientos de 15 min y 1 h
 * del V3 salen con el texto de la regla del libro tal cual, sin pasar por la IA: no hay nada que
 * "escuchar" todavía. Si ya respondió, siguen pasando por la IA como antes.
 *
 * - El primer mensaje nuestro es el OUTBOUND más antiguo. Los de tipo SYSTEM no cuentan.
 * - Responder es un INBOUND de texto, audio o foto con fecha POSTERIOR a ese primer mensaje.
 * - Un chat sin ningún mensaje nuestro cuenta como no respondido.
 * - No depende del orden de la lista. Tampoco usa los 2 minutos de `soloMandoElAnuncio`: aunque el
 *   cliente escriba al minuto, ya respondió.
 */

import { esDiaSiguiente, minutosDe } from "@/features/seguimiento-inteligente/dominio/dia-siguiente";

export type MensajeParaLaBienvenida = {
  direction: string;
  type: string;
  createdAt: Date;
};

/** Lo que cuenta como respuesta del cliente. */
const TIPOS_DE_RESPUESTA = new Set(["TEXT", "AUDIO", "IMAGE"]);

export function clienteRespondioLaBienvenida(mensajes: readonly MensajeParaLaBienvenida[]): boolean {
  let primeroNuestro: number | null = null;
  for (const mensaje of mensajes) {
    if (mensaje.type === "SYSTEM" || mensaje.direction !== "OUTBOUND") continue;
    const en = mensaje.createdAt.getTime();
    if (primeroNuestro === null || en < primeroNuestro) primeroNuestro = en;
  }
  if (primeroNuestro === null) return false;

  const desde = primeroNuestro;
  return mensajes.some(
    (mensaje) =>
      mensaje.direction === "INBOUND" &&
      TIPOS_DE_RESPUESTA.has(mensaje.type) &&
      mensaje.createdAt.getTime() > desde,
  );
}

/* ------------------------------------------------------------------------------------------------
   Parte 2: los seguimientos automáticos del motor (Follow) cuando el cliente no respondió
------------------------------------------------------------------------------------------------ */

/** Solo el COMBO CAMILLA DIVAN (CMB005). No Tres Cuerpos ni Premium. */
export const PRODUCTO_COMBO_CAMILLAS_ID = "cmp7lojx700bj2hn6z2vrv0i9";

/** Lo que sale SIEMPRE en el día siguiente del Combo Camillas si el cliente no respondió. */
export const TEXTO_COMBO_DIA_SIGUIENTE =
  "¿Quieres el combo completo de camilla, escalera, silla y carrito o prefieres solo algunas piezas?";

/** "Etapa <paso> · N": el nombre de los seguimientos del paso (crm/services/stage-follow-up.ts). */
const NOMBRE_DE_ETAPA_NUMERADO = /^Etapa .+ · \d+$/;

/**
 * ¿Es el seguimiento del día siguiente? El que se re-arma ("Etapa … · día siguiente") o el de
 * siempre del paso ("Etapa … · N") cuando su plazo es justo de 1 día.
 */
export function esDelDiaSiguiente(follow: { name: string | null; timeType: string; timeValue: number }): boolean {
  if (esDiaSiguiente(follow.name)) return true;
  const nombre = (follow.name ?? "").trim();
  return NOMBRE_DE_ETAPA_NUMERADO.test(nombre) && minutosDe(follow.timeType, follow.timeValue) === 1440;
}

/**
 * El texto que sale sin IA cuando el cliente no respondió la bienvenida: el del combo en el día
 * siguiente del Combo Camillas (nunca en un flujo), y el agendado en todo lo demás.
 */
export function textoSinRespuesta(input: {
  productoId: string | null;
  delDiaSiguiente: boolean;
  esFlujo: boolean;
  textoFijo: string;
}): { texto: string; esElDelCombo: boolean } {
  if (!input.esFlujo && input.delDiaSiguiente && input.productoId === PRODUCTO_COMBO_CAMILLAS_ID) {
    return { texto: TEXTO_COMBO_DIA_SIGUIENTE, esElDelCombo: true };
  }
  return { texto: input.textoFijo, esElDelCombo: false };
}
