"use client";

import { useEffect, useRef } from "react";

import { getStoredNotificationSound, playNotificationSound } from "./chat-notification-sound";

type IncomingMessageDetail = {
  phoneNumber?: string | null;
  senderName?: string | null;
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

    const handleIncoming = (event: Event) => {
      const detail = (event as CustomEvent<IncomingMessageDetail>).detail ?? {};

      const soundId = getStoredNotificationSound();
      const ctx = audioContextRef.current;
      // Si el contexto quedó suspendido (p. ej. al pasar a segundo plano), intentamos
      // reanudarlo para los tonos generados. Los sonidos de ARCHIVO no dependen del ctx.
      if (ctx?.state === "suspended") {
        void ctx.resume();
      }
      // playNotificationSound decide archivo vs tono y devuelve si se reprodujo algo.
      const playedWebAudio = playNotificationSound(soundId, ctx ?? null);

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        try {
          const title = detail.senderName?.trim() || detail.phoneNumber?.trim() || "Nuevo mensaje";
          const body = detail.text?.trim() || previewFromType(detail.type);
          // Si ya sonó el Web Audio, la notificación va silenciada para no duplicar.
          // Si NO pudo sonar (contexto bloqueado, sin clic previo), dejamos que el
          // sistema reproduzca su propio sonido como respaldo. Si el usuario eligió
          // "Silenciar", la notificación también va sin sonido.
          const silent = playedWebAudio || soundId === "silence";
          const notification = new Notification(title, {
            body,
            tag: detail.chatKey || detail.phoneNumber || "chat",
            // renotify: vuelve a alertar (sonido/popup) en cada mensaje aunque
            // reemplace una notificación previa del mismo contacto (mismo tag).
            renotify: true,
            icon: "/magilus-logo.svg",
            silent,
          } as NotificationOptions);
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
