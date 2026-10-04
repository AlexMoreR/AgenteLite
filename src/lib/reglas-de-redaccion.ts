/**
 * LAS REGLAS DE REDACCION DE MAGILUS, en un solo lugar (Alex, 03-10-2026).
 *
 * Las usan la estrella del cuadro de mensajes, los seguimientos del Agente V3 y la revision del
 * libro de reglas. Antes cada uno tenia lo suyo -o nada-: la estrella no decia "¿sigues
 * interesada?" y el seguimiento del V3 lo mandaba 83 veces por semana.
 *
 *  - Nunca "pero" (se usa "sin embargo").
 *  - Nunca "¿sigues interesada?" ni "cuando puedas me avisas".
 *  - Tutear: nunca "usted" (ni sus formas: "desea", "le puedo"...), y tampoco voseo.
 *  - Los seguimientos: cortos, una sola pregunta y al final.
 */

/** "Unas 35 palabras": con este margen se acepta. */
export const PALABRAS_MAXIMAS_DE_SEGUIMIENTO = 42;

/**
 * Termina con una pregunta. Despues del "?" puede venir un emoji o el cierre de una negrita de
 * WhatsApp ("¿te comparto *fotos*?*"): eso sigue siendo terminar con pregunta.
 */
export function terminaEnPregunta(texto: string) {
  return /\?[\s*_~\p{Extended_Pictographic}‍️]*$/u.test(texto.trim());
}

/**
 * Toda respuesta del agente termina con una pregunta que avance la venta (Alex, 03-10-2026):
 * "respondió bien lo del material, pero terminó sin pregunta". Junto con las frases prohibidas.
 */
export function problemasDeRespuesta(texto: string): string[] {
  const problemas = frasesProhibidas(texto);
  if (!terminaEnPregunta(texto)) problemas.push("no termina con una pregunta que avance la venta");
  return problemas;
}

/** Lo que nunca se le escribe a una clienta, con el motivo en palabras de negocio. */
export function frasesProhibidas(texto: string): string[] {
  const problemas: string[] = [];
  if (/\bpero\b/i.test(texto)) problemas.push('usa "pero" (va "sin embargo")');
  if (/sigues interesad[ao]/i.test(texto)) problemas.push('dice "¿sigues interesada?"');
  if (/cuando puedas me avisas/i.test(texto)) problemas.push('dice "cuando puedas me avisas"');
  if (/\busted(es)?\b|\bdesea\b|\ble (gustar[ií]a|interesa|puedo|podemos)\b|\bsu (pedido|combo|ciudad|compra|direcci[oó]n)\b/i.test(texto)) {
    problemas.push("trata de usted (hay que tutear)");
  }
  if (/\bvos\b|\bpod[eé]s\b|\bten[eé]s\b|\bquer[eé]s\b/i.test(texto)) problemas.push("usa voseo (hay que tutear)");
  return problemas;
}

/** Ademas de las frases: un seguimiento es corto, con una sola pregunta y al final. */
export function problemasDeSeguimiento(texto: string): string[] {
  const problemas = frasesProhibidas(texto);
  const palabras = texto.split(/\s+/).filter(Boolean).length;
  if (palabras > PALABRAS_MAXIMAS_DE_SEGUIMIENTO) problemas.push(`es largo (${palabras} palabras; unas 35 como máximo)`);
  const preguntas = (texto.match(/\?/g) ?? []).length;
  if (preguntas > 1) problemas.push("hace más de una pregunta");
  if (!terminaEnPregunta(texto)) problemas.push("no termina con una pregunta");
  return problemas;
}

/**
 * La ultima red: lo prohibido que se haya colado se arregla sin inventar nada.
 * "pero" -> "sin embargo", y fuera "¿sigues interesada?" y "cuando puedas me avisas".
 * El trato de usted no se puede arreglar a mano sin reescribir: eso lo avisa el libro.
 */
export function limpiarFrasesProhibidas(texto: string) {
  return texto
    .replace(/,\s*pero\s+/gi, "; sin embargo, ")
    .replace(/(^|[.!?¡¿]\s+)pero\s+/gi, (_, antes: string) => `${antes}Sin embargo, `)
    .replace(/\bpero\b/gi, "sin embargo")
    .replace(/¿?\s*sigues interesad[ao][^?\n]*\?\s*/gi, "")
    .replace(/cuando puedas me avisas[.!]?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
