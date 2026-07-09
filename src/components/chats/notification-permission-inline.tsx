"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getIsSubscribed,
  isPushSupported,
  requestPermissionAndSubscribe,
} from "./push-subscription-client";

type Status = "loading" | "hidden" | "off" | "on";

/**
 * Control COMPACTO para activar/probar las notificaciones push del dispositivo, pensado
 * para incrustarse dentro del menú de la campanita de chats. Reutiliza la misma lógica
 * que el interruptor completo de Ajustes (NotificationPermissionToggle). Si el navegador
 * no soporta push o el permiso está bloqueado, no muestra nada (se gestiona en Ajustes).
 */
export function NotificationPermissionInline() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!isPushSupported() || Notification.permission === "denied") {
        if (!cancelled) setStatus("hidden");
        return;
      }
      const subscribed = await getIsSubscribed();
      if (cancelled) return;
      setStatus(subscribed && Notification.permission === "granted" ? "on" : "off");
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleActivate = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    try {
      const result = await requestPermissionAndSubscribe();
      if (result.ok) {
        setStatus("on");
        toast.success("Notificaciones activadas en este dispositivo.");
      } else if (result.reason === "denied") {
        setStatus("hidden");
        toast.error("Notificaciones bloqueadas. Actívalas en los ajustes del navegador.");
      } else {
        toast.error("No se pudo activar. Inténtalo desde Conexión → Ajustes.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (event: React.MouseEvent) => {
    event.stopPropagation();
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
        toast.success("Enviada. Debería sonar en un momento.");
      } else if (data?.ok) {
        toast.message("Aún no hay dispositivos suscritos.");
      } else {
        toast.error(data?.error || "No se pudo enviar la prueba.");
      }
    } catch {
      toast.error("No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  if (status === "loading" || status === "hidden") {
    return null;
  }

  if (status === "on") {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <BellRing className="size-3.5" />
          Notificaciones activadas
        </span>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Probar
        </button>
      </div>
    );
  }

  // status === "off"
  return (
    <div className="px-3 py-2 border-b border-border">
      <button
        type="button"
        onClick={handleActivate}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Bell className="size-3.5" />}
        Activar sonido en este dispositivo
      </button>
    </div>
  );
}
