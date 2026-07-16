"use client";

import { useEffect } from "react";

type ChatsSseSyncProps = {
  enabled?: boolean;
};

// Cliente del realtime unificado por SSE. Abre un EventSource a /api/cliente/chats/stream
// y, en cada evento, dispara `chat-realtime-poke` (que ChatsAutoRefresh escucha para
// refrescar el chat activo + la lista al instante). Aditivo: convive con el WS de evogo y
// el poll de 60s; si el SSE falla, esos dos siguen cubriendo el realtime. EventSource
// reconecta solo.
export function ChatsSseSync({ enabled = true }: ChatsSseSyncProps) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let closedByCleanup = false;

    // Reenvia el chatKey del evento para que el refresco sea DIRIGIDO a ese chat
    // (actualizar su fila) en vez de recargar la pagina entera.
    const poke = (event: MessageEvent) => {
      let chatKey: string | null = null;
      try {
        const parsed = JSON.parse(event.data) as { chatKey?: string | null };
        chatKey = typeof parsed?.chatKey === "string" ? parsed.chatKey : null;
      } catch {
        chatKey = null;
      }

      window.dispatchEvent(new CustomEvent("chat-realtime-poke", { detail: { chatKey } }));
    };

    const connect = () => {
      if (closedByCleanup) return;
      try {
        source = new EventSource("/api/cliente/chats/stream", { withCredentials: true });
      } catch {
        source = null;
        return;
      }

      // Evento nombrado "chat" que emite el endpoint.
      source.addEventListener("chat", poke as EventListener);
      // Por si algun proxy reescribe a evento por defecto.
      source.onmessage = poke;

      source.onerror = () => {
        // EventSource reintenta solo; si el navegador lo dejo cerrado, forzamos reconexion.
        if (source && source.readyState === EventSource.CLOSED && !closedByCleanup) {
          source.close();
          source = null;
          window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [enabled]);

  return null;
}
