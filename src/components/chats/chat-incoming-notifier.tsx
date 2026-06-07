"use client";

import { useEffect, useRef } from "react";

import { getStoredNotificationSound, playNotificationSound } from "./chat-notification-sound";

type IncomingMessageDetail = {
  phoneNumber?: string | null;
  text?: string | null;
  type?: string | null;
  chatKey?: string | null;
  isActiveConversation?: boolean;
};

function previewFromType(type?: string | null) {
  switch (type) {
    case "AUDIO":
      return "🎤 Audio";
    case "IMAGE":
      return "📷 Foto";
    case "VIDEO":
      return "🎥 Video";
    case "STICKER":
      return "Sticker";
    case "DOCUMENT":
      return "📄 Documento";
    case "LOCATION":
      return "📍 Ubicación";
    default:
      return "Nuevo mensaje";
  }
}

/**
 * Reproduce un sonido y muestra una notificación del sistema cuando llega un
 * mensaje entrante (evento `chat-incoming-message` emitido por ChatsRealtimeSync).
 * El sonido se genera con Web Audio (sin assets). La notificación del sistema solo
 * aparece cuando la pestaña no está activa, para no duplicar feedback mientras se usa.
 */
export function ChatIncomingNotifier({ enabled = true }: { enabled?: boolean }) {
  const audioContextRef = useRef<AudioContext | null>(null);

  // Prepara el AudioContext y pide permiso de notificaciones tras un gesto del usuario
  // (los navegadores bloquean el audio y, a veces, el permiso sin interacción previa).
  useEffect(() => {
    if (!enabled) return;

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const ensureReady = () => {
      if (!audioContextRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          audioContextRef.current = new Ctx();
        }
      }
      if (audioContextRef.current?.state === "suspended") {
        void audioContextRef.current.resume();
      }
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    };

    window.addEventListener("pointerdown", ensureReady);
    window.addEventListener("keydown", ensureReady);
    return () => {
      window.removeEventListener("pointerdown", ensureReady);
      window.removeEventListener("keydown", ensureReady);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const playSound = () => {
      const soundId = getStoredNotificationSound();
      if (soundId === "silence") {
        return;
      }
      const ctx = audioContextRef.current;
      if (!ctx) return;
      playNotificationSound(soundId, ctx);
    };

    const handleIncoming = (event: Event) => {
      const detail = (event as CustomEvent<IncomingMessageDetail>).detail ?? {};

      playSound();

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        try {
          const body = detail.text?.trim() || previewFromType(detail.type);
          const notification = new Notification("Nuevo mensaje", {
            body,
            tag: detail.chatKey || detail.phoneNumber || "chat",
            icon: "/magilus-logo.svg",
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          // Ignorar errores de la API de Notification.
        }
      }
    };

    window.addEventListener("chat-incoming-message", handleIncoming as EventListener);
    return () => window.removeEventListener("chat-incoming-message", handleIncoming as EventListener);
  }, [enabled]);

  return null;
}
