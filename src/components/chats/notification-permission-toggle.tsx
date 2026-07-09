"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getIsSubscribed,
  isPushSupported,
  requestPermissionAndSubscribe,
  unsubscribeFromPush,
  type PushActionResult,
} from "./push-subscription-client";

type Status = "loading" | "unsupported" | "denied" | "off" | "on";

function isProbablyIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function messageForFailure(result: PushActionResult): string {
  switch (result.reason) {
    case "denied":
      return "Notificaciones bloqueadas. Actívalas en los ajustes del navegador para este sitio.";
    case "dismissed":
      return "No se concedió el permiso de notificaciones.";
    case "not-configured":
      return "Las notificaciones aún no están configuradas en el servidor.";
    case "unsupported":
      return "Este navegador no soporta notificaciones push.";
    default:
      return "No se pudo activar las notificaciones. Inténtalo de nuevo.";
  }
}

/**
 * Interruptor visible para que cada persona active las notificaciones push "tipo
 * WhatsApp" EN SU dispositivo, con un botón de prueba para confirmar el sonido.
 * Es por dispositivo/navegador (la suscripción vive en ese celular).
 */
export function NotificationPermissionToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refreshStatus = async () => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const subscribed = await getIsSubscribed();
    setStatus(subscribed && Notification.permission === "granted" ? "on" : "off");
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleActivate = async () => {
    setBusy(true);
    try {
      const result = await requestPermissionAndSubscribe();
      if (result.ok) {
        setStatus("on");
        toast.success("Notificaciones activadas en este dispositivo.");
      } else {
        if (result.reason === "denied") setStatus("denied");
        toast.error(messageForFailure(result));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setStatus("off");
      toast.success("Notificaciones desactivadas en este dispositivo.");
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; delivered?: number; error?: string }
        | null;
      if (data?.ok && (data.delivered ?? 0) > 0) {
        toast.success("Enviada. Debería sonar/aparecer en un momento.");
      } else if (data?.ok) {
        toast.message("No hay dispositivos suscritos para este usuario todavía.");
      } else {
        toast.error(data?.error || "No se pudo enviar la prueba.");
      }
    } catch {
      toast.error("No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  if (status === "loading") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Comprobando notificaciones…
      </p>
    );
  }

  if (status === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        Este navegador no soporta notificaciones push.
        {isProbablyIos() && !isStandalone()
          ? " En iPhone, primero instala la app: toca Compartir → “Agregar a inicio”, ábrela desde ahí y vuelve aquí."
          : ""}
      </p>
    );
  }

  if (status === "denied") {
    return (
      <div className="space-y-1">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <BellOff className="size-4 text-muted-foreground" />
          Notificaciones bloqueadas
        </p>
        <p className="text-sm text-muted-foreground">
          Las bloqueaste antes. Actívalas en los ajustes del navegador (candado junto a la
          dirección → Notificaciones → Permitir) y recarga.
        </p>
      </div>
    );
  }

  if (status === "on") {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <BellRing className="size-4" />
          Activadas en este dispositivo
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
            Probar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDeactivate}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BellOff className="size-4" />}
            Desactivar
          </Button>
        </div>
      </div>
    );
  }

  // status === "off"
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Recibe un aviso con sonido cuando entre un mensaje nuevo, aunque tengas la app
        cerrada o en segundo plano.
      </p>
      <Button type="button" size="sm" onClick={handleActivate} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
        Activar notificaciones en este dispositivo
      </Button>
    </div>
  );
}
