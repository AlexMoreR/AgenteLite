"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { isProbablyIos, isStandalone } from "@/lib/pwa-instalada";
import {
  getIsSubscribed,
  isPushSupported,
  requestPermissionAndSubscribe,
} from "./push-subscription-client";

/*
  "instalar", "bloqueado" y "sin-soporte" (23-nov-2026): antes no mostraban NADA y en el iPhone de
  Claudia la pantalla de Notificaciones quedaba con una caja vacia, sin forma de activarlas. En una
  pestaña de Safari el iPhone no tiene notificaciones web: solo con la app en la pantalla de inicio.
*/
type Status = "loading" | "instalar" | "bloqueado" | "sin-soporte" | "off" | "on";

/**
 * Control COMPACTO para activar/probar las notificaciones push del dispositivo, pensado
 * para incrustarse dentro del menú de la campanita de chats. Reutiliza la misma lógica
 * que el interruptor completo de Ajustes (NotificationPermissionToggle). Si no se pueden activar
 * aquí (Safari del iPhone sin instalar, permiso bloqueado), dice cómo hacerlo.
 */
export function NotificationPermissionInline() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (isProbablyIos() && !isStandalone()) {
        if (!cancelled) setStatus("instalar");
        return;
      }
      if (!isPushSupported()) {
        if (!cancelled) setStatus("sin-soporte");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("bloqueado");
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
        setStatus("bloqueado");
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

  if (status === "loading") {
    return null;
  }

  if (status === "instalar" || status === "bloqueado" || status === "sin-soporte") {
    const texto =
      status === "instalar"
        ? "En iPhone solo suenan con la app instalada. En Safari toca ··· → Compartir → Agregar a inicio, abre la app desde ese ícono y vuelve aquí a activarlas."
        : status === "bloqueado"
          ? isProbablyIos()
            ? "Están bloqueadas en este iPhone. Ve a Ajustes → Notificaciones → la app del CRM y activa Permitir notificaciones."
            : "Están bloqueadas en este navegador. Toca el candado junto a la dirección → Notificaciones → Permitir, y recarga."
          : "Este navegador no puede recibir notificaciones. Abre el CRM en Chrome o instala la app.";
    return (
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs text-foreground">
        {status === "instalar" ? (
          <Smartphone className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <BellOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span>{texto}</span>
      </div>
    );
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
