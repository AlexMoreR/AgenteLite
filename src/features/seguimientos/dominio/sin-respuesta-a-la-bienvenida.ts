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
