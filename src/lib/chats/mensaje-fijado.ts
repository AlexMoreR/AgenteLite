/*
  Mensaje fijado del chat (Fijar del menu del mensaje). Es SOLO del CRM: se guarda en
  Conversation.mensajeFijadoId / OfficialApiConversation.mensajeFijadoId, no viaja a WhatsApp y la
  clienta no ve nada. Uno por chat.

  Esta funcion es pura (sin Prisma ni Next) para probarla con Node: arma lo que viaja a la pantalla
  con el id guardado y el mensaje que se encontro con ese id.
*/

export type MensajeFijado = {
  id: string;
  /** El texto o el pie de foto. Vacio si no tiene: la pantalla dice "Foto", "Documento"... por el tipo. */
  texto: string;
  /** El tipo del mensaje (TEXT, IMAGE, DOCUMENT...). */
  tipo: string;
};

export type MensajeParaFijar = {
  id: string;
  content: string | null;
  type: string | null;
  /** La marca que pone Eliminar. El canal oficial no la tiene. */
  deletedAt?: Date | string | null;
};

/**
 * null si no hay fijado, si el mensaje ya no existe (o no es el del id) o si se borro con Eliminar:
 * asi la franja de arriba se va sola.
 */
export function armarMensajeFijado(
  mensajeFijadoId: string | null | undefined,
  mensaje: MensajeParaFijar | null | undefined,
): MensajeFijado | null {
  const id = mensajeFijadoId?.trim();
  if (!id || !mensaje || mensaje.id !== id || mensaje.deletedAt) {
    return null;
  }
  return {
    id,
    texto: mensaje.content?.trim() ?? "",
    tipo: mensaje.type?.trim() || "TEXT",
  };
}
