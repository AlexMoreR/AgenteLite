"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
  enabled?: boolean;
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

export function ChatsAutoRefresh({
  intervalMs = 5000,
  enabled = true,
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

        if (wasRecentlyUpdated) {
          return;
        }

        // Targeted fetch, no router.refresh() / RSC re-render.
        if (inFlightRef.current) return;

        inFlightRef.current = true;
        try {
          const response = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
            credentials: "same-origin",
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as
            | { ok?: boolean; conversation?: unknown }
            | null;

          if (!payload?.ok || !payload.conversation) {
            return;
          }

          const conversation = hydrateConversationSnapshot(payload.conversation);

          if (!conversation) {
            return;
          }

          window.dispatchEvent(
            new CustomEvent("chat-live-update", { detail: { conversation, chatKey } }),
          );
        } catch {
          // Network error: the next tick will retry.
        } finally {
          inFlightRef.current = false;
        }

        return;
      }

      // Official API chat or no selection: router.refresh() is still necessary.
      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
    // The interval should not reset when the active chat changes.
  }, [enabled, isVisible, intervalMs, router, startTransition]);

  return null;
}
