"use client";

import { useEffect } from "react";

import {
  isPushSupported,
  requestPermissionAndSubscribe,
  subscribeToPush,
} from "./push-subscription-client";

/**
 * Registra este dispositivo para recibir notificaciones Web Push (VAPID), de modo que
 * la PWA suene y muestre el mensaje "tipo WhatsApp" aunque esté cerrada o en segundo
 * plano. Complementa a ChatIncomingNotifier (que solo actúa con la app abierta).
 *
 * En móviles los navegadores exigen que la suscripción ocurra tras un gesto del usuario
 * y, en iPhone, que la app esté instalada en la pantalla de inicio (iOS 16.4+). El
 * interruptor visible de Ajustes (NotificationPermissionToggle) permite activarlo a mano.
 */
export function PushSubscriptionManager({ enabled = true }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled || !isPushSupported()) {
      return;
    }

    // Intento inicial: si el permiso ya está concedido, re-registra la suscripción
    // (el endpoint puede haber cambiado o no estar aún guardado en el servidor).
    void subscribeToPush();

    // Tras un gesto: pide permiso (obligatorio en móviles) y suscribe al concederse.
    const handleGesture = () => {
      if (Notification.permission === "denied") {
        return;
      }
      void requestPermissionAndSubscribe();
    };

    window.addEventListener("pointerdown", handleGesture);
    window.addEventListener("keydown", handleGesture);

    return () => {
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("keydown", handleGesture);
    };
  }, [enabled]);

  return null;
}
