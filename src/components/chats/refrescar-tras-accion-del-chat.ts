"use client";

import { getPendingConversationSelection, getSelectionClosed } from "./chat-selection-store";
import {
  normalizeLiveConversationListSnapshot,
  normalizeLiveConversationSnapshot,
} from "./chat-inbox-conversation-utils";

/**
 * Despues de asignar, cambiar la etapa o anotar DESDE EL CHAT ABIERTO: traer solo ese chat y su fila.
 *
 * Antes cada una de esas acciones hacia dos renderizaciones completas de la pantalla de Chats: la que
 * venia dentro de la respuesta (revalidatePath) y la del `router.refresh()` del control, de 0,5 a 2 s
 * cada una y con la CPU del servidor arriba. Ahora la accion no revalida (`desdeElChat`) y aca se
 * piden `/live` (el chat abierto: los mensajes, la nota nueva, quien lo tiene, la etapa) y `/summary`
 * (la fila), los mismos dos pedidos que usa el tiempo real, y se publican por los mismos eventos
 * (`chat-live-update` y `chat-list-update`) que ya escucha la bandeja.
 *
 * Si algo no sale -sin red, el servidor responde con error, el chat ya no es de quien lo pidio (paso
 * el chat a una compañera y /summary ya no se lo da), la asesora cambio de chat mientras tanto- se
 * cae al `router.refresh()` de siempre: la pantalla nunca queda con datos viejos por esto.
 *
 * Solo para chats de WhatsApp normal ("agent:"): la API oficial no tiene /summary y sigue con el
 * refresco de siempre.
 */
export async function refrescarTrasAccionDelChat(input: {
  conversationId: string;
  /** El refresco de siempre (router.refresh), para cuando lo de aca no alcanza. */
  refrescarTodo: () => void;
}): Promise<void> {
  const conversationId = input.conversationId.trim().replace(/^agent:/, "");
  const chatKey = `agent:${conversationId}`;

  if (!conversationId || !esElChatAbierto(chatKey)) {
    input.refrescarTodo();
    return;
  }

  try {
    const query = `chatKey=${encodeURIComponent(chatKey)}`;
    const [liveResponse, summaryResponse] = await Promise.all([
      fetch(`/api/cliente/chats/live?${query}`, { credentials: "same-origin", cache: "no-store" }),
      fetch(`/api/cliente/chats/summary?${query}`, { credentials: "same-origin", cache: "no-store" }),
    ]);
    const [livePayload, summaryPayload] = await Promise.all([leerJson(liveResponse), leerJson(summaryResponse)]);
    const chat = livePayload?.ok ? normalizeLiveConversationSnapshot(livePayload.conversation) : null;
    const fila = summaryPayload?.ok ? normalizeLiveConversationListSnapshot(summaryPayload.conversation) : null;

    // Se publica solo si llegaron los dos y la asesora sigue en el mismo chat: a medias, no.
    if (!chat || !fila || !esElChatAbierto(chatKey)) {
      input.refrescarTodo();
      return;
    }

    window.dispatchEvent(new CustomEvent("chat-live-update", { detail: { conversation: chat, chatKey } }));
    window.dispatchEvent(new CustomEvent("chat-list-update", { detail: { conversation: fila } }));
  } catch {
    input.refrescarTodo();
  }
}

async function leerJson(response: Response): Promise<{ ok?: boolean; conversation?: unknown } | null> {
  if (!response.ok) {
    return null;
  }
  return (await response.json().catch(() => null)) as { ok?: boolean; conversation?: unknown } | null;
}

/**
 * Si este chat sigue abierto. Manda la seleccion del cliente (como useOpenChatKey); sin seleccion,
 * el chat es el de la URL con el que cargo la pagina, que es donde esta el control.
 */
function esElChatAbierto(chatKey: string): boolean {
  if (getSelectionClosed()) {
    return false;
  }
  const seleccion = getPendingConversationSelection()?.chatKey?.trim();
  return !seleccion || seleccion === chatKey;
}
