/*
  Tope de 1 hora para la cola de archivos en envio (fotos-en-envio.ts).

  El servidor reconoce un reintento por su numero unico (clientMessageId) mirando SOLO los mensajes
  de la ultima hora (agent-actions.ts, enviarArchivoDelChat, desde el 11-nov-2026: antes leia el
  crudo de todo el chat y tardaba segundos). Pasada esa hora, la misma clave ya no protege: si el
  primer intento si habia salido, un reintento lo manda otra vez al cliente.

  Por eso un envio con mas de una hora:
  - no se reintenta solo ni se retoma al volver a abrir la pagina: queda en rojo con Reintentar;
  - al tocar Reintentar sale con una clave NUEVA y se le avisa a la asesora, con texto claro, que
    revise el chat por si ya habia llegado.

  La hora se cuenta desde el ultimo intento de envio al servidor y, si nunca se intento, desde que
  se toco Enviar. Sin imports a proposito: lo prueba scripts/check-plazo-de-envio.mjs con Node solo.
*/

/** La misma ventana que mira el servidor para no duplicar (60 * 60_000 en agent-actions.ts). */
export const PLAZO_ANTI_DUPLICADO_MS = 60 * 60_000;

/** El motivo de la burbuja roja de un envio que paso la hora sin salir. */
export const MOTIVO_PASO_LA_HORA =
  "Pasó más de una hora sin enviarse. Revisa el chat antes de reintentar: si ya llegó, no lo vuelvas a mandar.";

/** El aviso al tocar Reintentar en uno vencido: sale como envio nuevo. */
export const AVISO_REINTENTO_VENCIDO =
  "Pasó más de una hora: se envía como un mensaje nuevo. Si ya le había llegado al cliente, lo va a recibir dos veces.";

export type ConPlazo = {
  /** Cuando se toco Enviar (ms). */
  creadaEn: number;
  /** Cuando salio el ultimo pedido de envio al servidor (ms), o null si nunca se intento. */
  intentoDeEnvioEn: number | null;
};

/** Desde cuando cuenta la hora: el ultimo intento de envio, o la creacion si nunca se intento. */
export function inicioDelPlazo(envio: ConPlazo): number {
  return envio.intentoDeEnvioEn ?? envio.creadaEn;
}

/** Paso la hora: el servidor ya no reconoce esta clave como repetida. */
export function plazoVencido(envio: ConPlazo, ahora: number): boolean {
  return ahora - inicioDelPlazo(envio) > PLAZO_ANTI_DUPLICADO_MS;
}

/*
  Si un envio guardado se retoma solo al volver a abrir la pagina: tiene que estar pendiente, ser
  reciente (`hastaMs` desde que se toco Enviar, hoy 30 min) y no haber pasado la hora del servidor.
*/
export function puedeRetomarseSolo(
  envio: ConPlazo & { estado: "pendiente" | "fallida" },
  ahora: number,
  hastaMs: number,
): boolean {
  return envio.estado === "pendiente" && ahora - envio.creadaEn <= hastaMs && !plazoVencido(envio, ahora);
}

/*
  Lo que hace Reintentar con la clave: la misma si el servidor todavia la reconoce (no duplica), una
  nueva si paso la hora (con la vieja tampoco lo reconoceria) y entonces se avisa.
*/
export function claveParaReintentar(
  envio: ConPlazo & { clave: string },
  ahora: number,
  nuevaClave: () => string,
): { clave: string; nueva: boolean } {
  if (!plazoVencido(envio, ahora)) {
    return { clave: envio.clave, nueva: false };
  }
  return { clave: nuevaClave(), nueva: true };
}
