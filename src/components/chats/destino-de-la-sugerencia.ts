/*
  A donde va la respuesta sugerida (✨) cuando llega del servidor.

  La sugerencia tarda unos segundos. Si mientras tanto la asesora abrio otro chat, la caja que esta
  a la vista ya es la del chat nuevo (el panel no se vuelve a montar, solo cambia el borrador): si
  se escribiera ahi, el texto del cliente A le llegaria al cliente B y ademas borraria lo que B
  tenia escrito. Por eso:
  - "caja": sigue abierto el mismo chat → se escribe en la caja, como siempre;
  - "borrador": es otro chat y el chat de la sugerencia no tenia nada escrito → queda como su
    borrador y aparece al volver;
  - "descartar": es otro chat y el de la sugerencia ya tenia texto → no se pisa lo que escribio
    la asesora; la sugerencia no se usa.
*/
export type DestinoDeLaSugerencia = "caja" | "borrador" | "descartar";

export function dondeVaLaSugerencia({
  chatPedido,
  chatAbierto,
  borradorDelChatPedido,
}: {
  /** El chat donde se toco ✨. */
  chatPedido: string;
  /** El chat abierto en el momento en que llega la sugerencia. */
  chatAbierto: string;
  /** Lo que tenia guardado como borrador el chat donde se toco ✨. */
  borradorDelChatPedido: string;
}): DestinoDeLaSugerencia {
  if (chatPedido === chatAbierto) {
    return "caja";
  }
  return borradorDelChatPedido.trim() ? "descartar" : "borrador";
}
