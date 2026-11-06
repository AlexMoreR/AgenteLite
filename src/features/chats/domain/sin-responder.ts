/**
 * La marca "Sin responder" de la bandeja: la regla unica, sin Prisma (corre en el navegador).
 *
 * Regla:
 * - Se ignoran los mensajes de tipo SYSTEM (notas internas, actividad y llamadas).
 * - La marca sale si lo ultimo (que no sea SYSTEM) es del cliente.
 * - La quita una saliente que no sea SYSTEM ni haya fallado (status FAILED): asesora, bot,
 *   seguimiento o envio automatico, todos cuentan como respuesta.
 * - Solo cuentan chats con un mensaje del cliente en los ultimos DIAS_DE_SIN_RESPONDER dias
 *   (eso lo resuelve el SQL de src/lib/ultimo-mensaje-de-chats.ts).
 * - El reloj cuenta desde el PRIMER mensaje del cliente posterior a la ultima respuesta valida.
 * - Un chat resuelto no lleva marca.
 *
 * Ojo: no es lo mismo que "Esperando respuesta" (espera-de-chats.ts), donde el bot no cuenta.
 */

/** Hasta este minuto (inclusive) la marca va en amarillo; desde el siguiente, en rojo. */
export const MINUTOS_EN_AMARILLO = 15;

export type ColorSinResponder = "amarillo" | "rojo";

export type MarcaSinResponder = {
  minutos: number;
  texto: string;
  color: ColorSinResponder;
};

const MINUTO_MS = 60_000;
const MINUTOS_POR_HORA = 60;
const MINUTOS_POR_DIA = 24 * MINUTOS_POR_HORA;

function aMilisegundos(fecha: Date | string | number): number {
  return fecha instanceof Date ? fecha.getTime() : typeof fecha === "number" ? fecha : new Date(fecha).getTime();
}

/** Minutos enteros que lleva esperando (nunca negativo). `null` si no hay desde o la fecha no sirve. */
export function minutosSinResponder(
  desde: Date | string | number | null | undefined,
  ahora: Date | string | number = Date.now(),
): number | null {
  if (desde === null || desde === undefined) return null;
  const inicio = aMilisegundos(desde);
  const fin = aMilisegundos(ahora);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  return Math.max(0, Math.floor((fin - inicio) / MINUTO_MS));
}

/** "Sin responder · 12 min"; desde 60 min en horas ("1 h") y desde 24 h en dias ("1 d"). */
export function textoSinResponder(minutos: number): string {
  if (minutos >= MINUTOS_POR_DIA) return `Sin responder · ${Math.floor(minutos / MINUTOS_POR_DIA)} d`;
  if (minutos >= MINUTOS_POR_HORA) return `Sin responder · ${Math.floor(minutos / MINUTOS_POR_HORA)} h`;
  return `Sin responder · ${minutos} min`;
}

/** Amarillo hasta 15 min inclusive; rojo desde 16. */
export function colorSinResponder(minutos: number): ColorSinResponder {
  return minutos <= MINUTOS_EN_AMARILLO ? "amarillo" : "rojo";
}

/** La marca a mostrar, o `null` si no va: sin desde (ya respondido) o chat resuelto. */
export function marcaSinResponder(input: {
  desde: Date | string | number | null | undefined;
  resuelto: boolean;
  ahora?: Date | string | number;
}): MarcaSinResponder | null {
  if (input.resuelto) return null;
  const minutos = minutosSinResponder(input.desde, input.ahora ?? Date.now());
  if (minutos === null) return null;
  return { minutos, texto: textoSinResponder(minutos), color: colorSinResponder(minutos) };
}

export type MensajeParaSinResponder<F> = {
  direccion: "INBOUND" | "OUTBOUND";
  tipo: string | null | undefined;
  status: string | null | undefined;
  fecha: F;
};

/**
 * El nuevo "sin responder desde" despues de un mensaje que llega en vivo (navegador):
 * - SYSTEM o FAILED: no cambia nada (`actual`).
 * - saliente valida: ya se respondio (`null`).
 * - entrante: si ya esperaba, sigue contando desde el primero (`actual ?? fecha`).
 */
export function siguienteSinResponderDesde<F>(actual: F | null, mensaje: MensajeParaSinResponder<F>): F | null {
  if (mensaje.tipo === "SYSTEM" || mensaje.status === "FAILED") return actual;
  if (mensaje.direccion === "OUTBOUND") return null;
  return actual ?? mensaje.fecha;
}
