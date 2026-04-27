"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";

type ChatsRealtimeSyncProps = {
  apiBaseUrl?: string;
  instanceNames?: string[];
  enabled?: boolean;
  fallbackIntervalMs?: number;
};

function normalizeBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function normalizeInstanceNames(instanceNames: string[]) {
  return Array.from(new Set(instanceNames.map((name) => name.trim()).filter(Boolean)));
}

function buildSocketUrl(baseUrl: string, instanceName: string) {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(instanceName)}`;
}

function normalizeEventName(eventName: string) {
  return eventName.trim().replace(/[\s.-]+/g, "_").toUpperCase();
}

function shouldTriggerRefresh(eventName: string) {
  const normalized = normalizeEventName(eventName);
  if (!normalized) {
    return false;
  }

  if (["CONNECT", "DISCONNECT", "CONNECT_ERROR", "ERROR", "RECONNECT", "RECONNECTING", "RECONNECT_ATTEMPT"].includes(normalized)) {
    return false;
  }

  return /MESSAGE|CHAT|CONTACT|PRESENCE|GROUP|INSTANCE|QRCODE|CONNECTION|STATUS|SESSION|READY/.test(normalized);
}

export function ChatsRealtimeSync({
  apiBaseUrl,
  instanceNames = [],
  enabled = true,
  fallbackIntervalMs = 15000,
}: ChatsRealtimeSyncProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));
  const [isSocketReady, setIsSocketReady] = useState(false);
  const normalizedInstanceNames = useMemo(() => normalizeInstanceNames(instanceNames), [instanceNames]);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl);
    if (!enabled || !isVisible || !normalizedBaseUrl || normalizedInstanceNames.length === 0) {
      return;
    }

    const connectedInstances = new Set<string>();
    const sockets: Socket[] = [];

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 250);
    };

    function updateSocketReadyState() {
      setIsSocketReady(connectedInstances.size > 0);
    }

    for (const instanceName of normalizedInstanceNames) {
      const socket = io(buildSocketUrl(normalizedBaseUrl, instanceName), {
        transports: ["websocket", "polling"],
        reconnection: true,
      });

      socket.on("connect", () => {
        connectedInstances.add(instanceName);
        updateSocketReadyState();
      });

      socket.on("disconnect", () => {
        connectedInstances.delete(instanceName);
        updateSocketReadyState();
      });

      socket.onAny((eventName) => {
        if (typeof eventName === "string" && shouldTriggerRefresh(eventName)) {
          scheduleRefresh();
        }
      });

      sockets.push(socket);
    }

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      for (const socket of sockets) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [apiBaseUrl, enabled, instanceNames, isVisible, normalizedInstanceNames, router, startTransition]);

  useEffect(() => {
    if (!enabled || !isVisible || isSocketReady) {
      return;
    }

    const timer = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, fallbackIntervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, fallbackIntervalMs, isSocketReady, isVisible, router, startTransition]);

  return null;
}
