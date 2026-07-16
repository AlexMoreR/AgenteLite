"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, []);

  // Refresca el chat activo (fetch dirigido + dispatch de los window events) o hace
  // router.refresh() para chats oficiales / sin seleccion. Reutilizado por el poll y por
  // el "poke" del realtime SSE (disparo instantaneo para AMBOS gateways).
  const refreshNow = useCallback(async () => {
    const chatKey = selectedConversationKeyRef.current?.trim() ?? "";

    if (chatKey.startsWith("agent:")) {
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
        // Network error: the next tick / poke will retry.
      } finally {
        inFlightRef.current = false;
      }

      return;
    }

    // Official API chat or no selection: router.refresh() is still necessary.
    startTransition(() => {
      router.refresh();
    });
  }, [router, startTransition]);

  // Poll periodico (red de seguridad, funciona para cualquier gateway).
  useEffect(() => {
    if (!enabled || !isVisible) {
      return;
    }

    const timer = window.setInterval(() => {
      const chatKey = selectedConversationKeyRef.current?.trim() ?? "";

      if (chatKey.startsWith("agent:")) {
        const wasRecentlyUpdated =
          lastLiveUpdateKeyRef.current === chatKey &&
          Date.now() - lastLiveUpdateAtRef.current < intervalMs;

        // Aunque exista realtime, mantenemos un fallback de polling.
        // Si el websocket/SSE falla o no emite el evento esperado, esto evita
        // que la conversación quede congelada sin refrescarse.
        if (realtimeEnabled && wasRecentlyUpdated) {
          return;
        }
      }

      void refreshNow();
    }, intervalMs);

    return () => window.clearInterval(timer);
    // The interval should not reset when the active chat changes.
  }, [enabled, isVisible, intervalMs, realtimeEnabled, refreshNow]);

  // Disparo instantaneo desde el realtime SSE (webhook -> servidor empuja -> poke).
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handlePoke() {
      void refreshNow();
    }

    window.addEventListener("chat-realtime-poke", handlePoke as EventListener);
    return () => window.removeEventListener("chat-realtime-poke", handlePoke as EventListener);
  }, [enabled, refreshNow]);

  return null;
}
