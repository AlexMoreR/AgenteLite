"use client";

import { clearConversationFromCache } from "../chat-history-cache";
import { quitarDeLaListaDelCelular } from "./lista-guardada";

/** Lo avisa quien recibe un 404 de /live: la bandeja quita la fila (ver shared-inbox.tsx). */
export const EVENTO_CHAT_SIN_ACCESO = "chat-sin-acceso";

/**
 * Un chat sin acceso se borra del guardado (P5, T5).
 *
 * /live contesta 404 "Conversacion no encontrada" cuando el chat se reasigno a otra asesora, se
 * borro o ya no hay permiso. Antes la copia guardada seguia ahi y el chat se podia volver a ver desde
 * el celular. Solo cuenta el 404 en JSON de la ruta: el 404 en HTML de Next (por ejemplo, en medio de
 * un despliegue) no dice nada del chat.
 *
 * Devuelve true si el chat quedo sin acceso. Nunca lanza.
 */
export function atenderChatSinAcceso(response: Response | null | undefined, chatKey: string): boolean {
  try {
    if (!response || response.status !== 404 || !chatKey.trim()) {
      return false;
    }
    const tipo = response.headers?.get("content-type") ?? "";
    if (!tipo.includes("json")) {
      return false;
    }
    clearConversationFromCache(chatKey.trim());
    quitarDeLaListaDelCelular(chatKey.trim());
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVENTO_CHAT_SIN_ACCESO, { detail: { chatKey: chatKey.trim() } }));
    }
    return true;
  } catch {
    return false;
  }
}
