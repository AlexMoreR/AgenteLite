"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
  enabled?: boolean;
  realtimeEnabled?: boolean;
  // Active conversation key (for example: "agent:xxx" or "official:xxx").
  // For Evolution chats we use /live instead of router.refresh().
  selectedConversationKey?: string | null;
};

function hydrateConversationSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { id?: unknown; messages?: Array<{ createdAt?: string } & Record<string, unknown>> };
  if (typeof snapshot.id !== "string" || !Array.isArray(snapshot.messages)) return null;
  return {
    ...(value as Record<string, unknown>),
    id: snapshot.id,
    messages: snapshot.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt || Date.now()),
    })),
  };
}

function hydrateConversationListSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { id?: unknown; lastMessageAt?: string | Date | null };
  if (typeof snapshot.id !== "string") return null;
  return {
    ...(value as Record<string, unknown>),
    id: snapshot.id,
    lastMessageAt: snapshot.lastMessageAt ? new Date(snapshot.lastMessageAt) : null,
  };
}

export function ChatsAutoRefresh({
  intervalMs = 5000,
  enabled = true,
  realtimeEnabled = true,
  selectedConversationKey = null,
}: ChatsAutoRefreshProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isVisible, setIsVisible] = useState(
    () => (typeof document === "undefined" ? true : document.visibilityState === "visible"),
  );

  // Avoid concurrent fetches if the interval fires before the previous request ends.
  const inFlightRef = useRef(false);
  // If a live update already refreshed the active chat recently, skip one poll tick.
  const lastLiveUpdateAtRef = useRef(0);
  const lastLiveUpdateKeyRef = useRef<string | null>(null);
  // Ultima vez que el realtime actualizo la LISTA. Si el websocket esta vivo y trayendo
  // cambios, el refresco de la lista sobra: la lista ya se actualiza sola, fila por fila.
  const lastListUpdateAtRef = useRef(0);
  // Stable ref so the interval always reads the latest active conversation.
  const selectedConversationKeyRef = useRef(selectedConversationKey);
  selectedConversationKeyRef.current = selectedConversationKey;

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ chatKey?: string | null }>;
      const chatKey = customEvent.detail?.chatKey?.trim() || "";

      if (!chatKey || chatKey !== selectedConversationKeyRef.current?.trim()) {
        return;
      }

      lastLiveUpdateAtRef.current = Date.now();
      lastLiveUpdateKeyRef.current = chatKey;
    }

    // Cualquier actualizacion de la lista significa que el realtime esta vivo.
    function handleListUpdate() {
      lastListUpdateAtRef.current = Date.now();
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => {
      window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
      window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !isVisible) {
      return;
    }

    const timer = window.setInterval(async () => {
      const chatKey = selectedConversationKeyRef.current?.trim() ?? "";

      if (chatKey.startsWith("agent:")) {
        const wasRecentlyUpdated =
          lastLiveUpdateKeyRef.current === chatKey &&
          Date.now() - lastLiveUpdateAtRef.current < intervalMs;

        // Aunque exista realtime, mantenemos un fallback de polling.
        // Si el websocket falla o no emite el evento esperado, esto evita
        // que la conversación quede congelada sin refrescarse.
        if (realtimeEnabled && wasRecentlyUpdated) {
          return;
        }

        // Targeted fetch, no router.refresh() / RSC re-render.
        if (inFlightRef.current) return;

        inFlightRef.current = true;
        try {
          const [liveResponse, summaryResponse] = await Promise.all([
            fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
              credentials: "same-origin",
              cache: "no-store",
            }),
            fetch(`/api/cliente/chats/summary?chatKey=${encodeURIComponent(chatKey)}`, {
              credentials: "same-origin",
              cache: "no-store",
            }),
          ]);

          if (liveResponse.ok) {
            const livePayload = (await liveResponse.json().catch(() => null)) as
              | { ok?: boolean; conversation?: unknown }
              | null;

            if (livePayload?.ok && livePayload.conversation) {
              const conversation = hydrateConversationSnapshot(livePayload.conversation);

              if (conversation) {
                window.dispatchEvent(
                  new CustomEvent("chat-live-update", { detail: { conversation, chatKey } }),
                );
              }
            }
          }

          if (summaryResponse.ok) {
            const summaryPayload = (await summaryResponse.json().catch(() => null)) as
              | { ok?: boolean; conversation?: unknown }
              | null;

            if (summaryPayload?.ok && summaryPayload.conversation) {
              const summaryConversation = hydrateConversationListSnapshot(summaryPayload.conversation);
              if (summaryConversation) {
                window.dispatchEvent(
                  new CustomEvent("chat-list-update", { detail: { conversation: summaryConversation } }),
                );
              }
            }
          }
        } catch {
          // Network error: the next tick will retry.
        } finally {
          inFlightRef.current = false;
        }

        return;
      }

      // Sin chat abierto (o chat de API oficial) el unico refresco posible es router.refresh().
      // Pero si el realtime acaba de actualizar la lista, el websocket esta vivo y ya la
      // mantiene fila por fila: refrescar seria repintar la pagina para nada. Solo entra
      // cuando el realtime lleva un intervalo entero sin dar señales (o no hay realtime,
      // como en API oficial), que es justo cuando hace falta la red de seguridad.
      const listWasRecentlyUpdated = Date.now() - lastListUpdateAtRef.current < intervalMs;
      if (realtimeEnabled && listWasRecentlyUpdated) {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
    // The interval should not reset when the active chat changes.
  }, [enabled, isVisible, intervalMs, realtimeEnabled, router, startTransition]);

  return null;
}
