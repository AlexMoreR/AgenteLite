/*
  El orden de los botones del menu de un mensaje, igual que en WhatsApp (Chats, parte 2).

  La hoja del celular (MessageTouchActionsSheet) y el menu de la compu (MessageActionsMenu) arman sus
  botones recorriendo esta lista, asi los dos quedan siempre en el mismo orden:

    Responder, Reenviar, Copiar, Editar, Descargar audio, Fijar/Desfijar, Eliminar

  Copiar, Editar, Descargar audio y Fijar solo salen cuando aplican. "Destacar" no existe.
  Es una funcion pura: recibe datos simples y no el mensaje, para probarla sin React.
*/

export type AccionDelMensaje =
  | "responder"
  | "reenviar"
  | "copiar"
  | "editar"
  | "descargar-audio"
  | "fijar"
  | "desfijar"
  | "eliminar";

export function accionesDelMensaje({
  tieneTexto,
  puedeEditar,
  tieneAudio,
  puedeFijar,
  estaFijado,
}: {
  /** El mensaje tiene texto de verdad para copiar (`textoParaCopiar` no es null). */
  tieneTexto: boolean;
  /** Texto propio de menos de 15 min (`puedeEditarseMensaje`) y hay con que editarlo. */
  puedeEditar: boolean;
  /** Nota de voz con archivo para bajar. */
  tieneAudio: boolean;
  /** Hay con que fijar (parte 4). Si es falso, Fijar no aparece. */
  puedeFijar: boolean;
  /** Este mensaje es el fijado del chat: sale Desfijar en vez de Fijar. */
  estaFijado: boolean;
}): AccionDelMensaje[] {
  const acciones: AccionDelMensaje[] = ["responder", "reenviar"];
  if (tieneTexto) acciones.push("copiar");
  if (puedeEditar) acciones.push("editar");
  if (tieneAudio) acciones.push("descargar-audio");
  if (puedeFijar) acciones.push(estaFijado ? "desfijar" : "fijar");
  acciones.push("eliminar");
  return acciones;
}
