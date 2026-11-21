/*
  Si el chat que llego del servidor ya trae lo que se acaba de enviar (velocidad de Chats, 20-nov-2026).

  La bandeja programa un /live de respaldo 1,5 s despues de cada envio, por si se pierde el aviso en
  tiempo real. Casi siempre el eco de WhatsApp llega antes y baja el chat entero; el respaldo lo
  bajaba otra vez (16 kB). Con estas dos cuentas la bandeja cancela el respaldo cuando el eco ya
  trajo los mensajes. Solo se comparan horas que puso el servidor, nunca el reloj del celular.
*/

type MensajeParaContar = {
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date | string;
  type?: string | null;
};

function hora(mensaje: MensajeParaContar): number {
  const ms = new Date(mensaje.createdAt).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

// Las notas del sistema (asignaciones, cambios de etapa) se guardan como salientes y no son un envio.
const esSaliente = (mensaje: MensajeParaContar) => mensaje.direction === "OUTBOUND" && mensaje.type !== "SYSTEM";

/** La hora del ultimo saliente que ya estaba en pantalla; -Infinity si no habia ninguno. */
export function ultimoSalienteDelServidor(mensajes: readonly MensajeParaContar[]): number {
  let ultimo = Number.NEGATIVE_INFINITY;
  for (const mensaje of mensajes) {
    if (esSaliente(mensaje)) ultimo = Math.max(ultimo, hora(mensaje));
  }
  return ultimo;
}

/** Cuantos salientes del chat que llego son mas nuevos que `desde`. */
export function salientesDesde(mensajes: readonly MensajeParaContar[], desde: number): number {
  let cuantos = 0;
  for (const mensaje of mensajes) {
    if (esSaliente(mensaje) && hora(mensaje) > desde) cuantos += 1;
  }
  return cuantos;
}
