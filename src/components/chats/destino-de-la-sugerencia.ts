/*
  Respuesta sugerida (✨) que llega tarde (tarjeta otxmycwu).

  La sugerencia tarda unos segundos. Si mientras tanto la asesora abre otro chat, el panel no se
  vuelve a montar: la caja que esta abierta ya es la del chat nuevo. Antes el texto del chat A se
  escribia en la caja del chat B y borraba lo que B tenia escrito.

  Regla: solo se escribe en la caja si el chat abierto AHORA es el mismo para el que se pidio.
  Si es otro, la caja no se toca:
  - si el chat de la sugerencia no tenia nada escrito, la sugerencia queda como su borrador
    (al volver a ese chat aparece en la caja);
  - si ya tenia algo escrito, no se pisa: la sugerencia se descarta.
*/

export type DestinoDeLaSugerencia = "caja" | "borrador" | "descartar";

export function dondeVaLaSugerencia(params: {
  /** El chat para el que se pidio la sugerencia (al tocar ✨). */
  chatPedido: string;
  /** El chat abierto en el momento en que llega la sugerencia. */
  chatAbierto: string;
  /** Lo que el chat pedido tiene guardado como borrador. */
  borradorDelChatPedido: string;
}): DestinoDeLaSugerencia {
  if (params.chatPedido === params.chatAbierto) {
    return "caja";
  }
  return params.borradorDelChatPedido.trim() ? "descartar" : "borrador";
}

export const AVISO_SUGERENCIA_EN_SU_CAJA = "La sugerencia era para otro chat: quedó en su caja";
export const AVISO_SUGERENCIA_NO_USADA = "La sugerencia era para otro chat y no se usó";
