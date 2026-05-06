"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
  enabled?: boolean;
  // Clave de la conversación activa (ej. "agent:xxx" u "official:xxx").
  // Con ella se evita router.refresh() para conversaciones Evolution: se hace un
  // fetch targetizado al endpoint /live y se despacha chat-live-update en su lugar.
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
  // Evita fetch concurrentes si el intervalo se dispara antes de que termine el anterior.
  const inFlightRef = useRef(false);
  // Ref sincronizada: el callback del intervalo siempre lee la conversación activa
  // sin necesitar recrear el setInterval cuando el usuario cambia de chat.
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
    if (!enabled || !isVisible) {
      return;
    }

    const timer = window.setInterval(async () => {
      const chatKey = selectedConversationKeyRef.current?.trim() ?? "";

      if (chatKey.startsWith("agent:")) {
        // Ruta rápida: fetch targetizado — cero re-render de Router/RSC.
        // Replica exactamente lo que hace ChatsRealtimeSync.runLiveUpdate().
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          const response = await fetch(
            `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`,
            { credentials: "same-origin", cache: "no-store" },
          );

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
          // Error de red — sin fallback: el próximo tick lo reintentará.
        } finally {
          inFlightRef.current = false;
        }
        return;
      }

      // Conversación Official API o sin selección: router.refresh() es necesario
      // porque no existe un endpoint equivalente para esas conversaciones.
      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
    // pathname y searchParams eliminados: el intervalo no debe reiniciarse cuando
    // el usuario cambia de conversación — eso causaba un refresh() extra en cada navegación.
  }, [enabled, isVisible, intervalMs, router, startTransition]);

  return null;
}
