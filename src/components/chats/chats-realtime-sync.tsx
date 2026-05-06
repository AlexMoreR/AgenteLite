"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import {
  extractEvolutionPhoneNumber,
  extractEvolutionRemoteJid,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";

type ChatsRealtimeSyncProps = {
  apiBaseUrl?: string;
  apiKey?: string | null;
  instanceNames?: string[];
  activeInstanceName?: string | null;
  selectedConversationKey?: string | null;
  enabled?: boolean;
  globalEventsEnabled?: boolean;
};

type RefreshPriority = "active" | "background";

const ACTIVE_REFRESH_DELAY_MS = 180;
const BACKGROUND_REFRESH_DELAY_MS = 1200;
const ACTIVE_REFRESH_MIN_GAP_MS = 350;
const BACKGROUND_REFRESH_MIN_GAP_MS = 4000;
const PAGE_REFRESH_DELAY_MS = 250;
const PAGE_REFRESH_MIN_GAP_MS = 1200;
// El live-update de la conversación activa puede ir rápido (180ms) porque solo
// lee mensajes ya guardados por el webhook en ese momento. El summary de lista
// necesita más margen: el webhook puede tardar 500-1000ms en escribir el mensaje
// antes de que la query de summary lo vea.
const LIST_REFRESH_DELAY_MS = 1200;
const LIST_REFRESH_MIN_GAP_MS = 2000;

function normalizeBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function normalizeInstanceNames(instanceNames: string[]) {
  return Array.from(new Set(instanceNames.map((name) => name.trim()).filter(Boolean)));
}

function buildSocketUrl(baseUrl: string, instanceName?: string | null) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!instanceName?.trim()) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/${encodeURIComponent(instanceName)}`;
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

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickString(source: UnknownRecord | null, keys: string[]): string | null {
  if (!source) return null;

  for (const key of keys) {
    const value = readString(source[key]);
    if (value) return value;
  }

  return null;
}

function normalizePhoneNumber(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  return normalized || null;
}

function extractPhoneNumberFromPayload(payload: unknown): string | null {
  const webhookPhoneNumber = normalizePhoneFromJid(
    extractEvolutionRemoteJid(payload) ?? extractEvolutionPhoneNumber(payload),
  );

  if (webhookPhoneNumber) {
    return webhookPhoneNumber;
  }

  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);
  const key = asRecord(data?.key);
  const sender = asRecord(data?.sender);
  const contextInfo = asRecord(asRecord(message?.extendedTextMessage)?.contextInfo);

  return (
    normalizePhoneNumber(
      pickString(key, ["remoteJid", "participant"]) ||
        pickString(sender, ["id", "jid"]) ||
        pickString(data, ["remoteJid", "participant", "from", "phoneNumber", "number", "phone"]) ||
        pickString(contextInfo, ["participant", "remoteJid"]) ||
        pickString(root, ["remoteJid", "phoneNumber", "number", "phone", "owner", "ownerJid", "wuid"]),
    )
  );
}

function normalizeConversationSummarySnapshot(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as {
    id?: unknown;
    lastMessageAt?: string | Date | null;
  };

  if (typeof snapshot.id !== "string") {
    return null;
  }

  return {
    ...(value as UnknownRecord),
    id: snapshot.id,
    lastMessageAt: snapshot.lastMessageAt ? new Date(snapshot.lastMessageAt) : null,
  };
}

export function ChatsRealtimeSync({
  apiBaseUrl,
  apiKey = null,
  instanceNames = [],
  activeInstanceName = null,
  selectedConversationKey = null,
  enabled = true,
  globalEventsEnabled = false,
}: ChatsRealtimeSyncProps) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));
  const normalizedInstanceNamesKey = Array.from(
    new Set(instanceNames.map((name) => name.trim()).filter(Boolean)),
  ).join("\u0000");
  const liveUpdateTimerRef = useRef<number | null>(null);
  const liveUpdateInFlightRef = useRef(false);
  const liveUpdateQueuedRef = useRef(false);
  const lastLiveUpdateAtRef = useRef(0);
  const listUpdateTimerRef = useRef<number | null>(null);
  const listUpdateFollowUpTimerRef = useRef<number | null>(null);
  const listUpdateInFlightRef = useRef(false);
  const listUpdatePendingRef = useRef<{
    priority: RefreshPriority;
    instanceName: string;
    payload: unknown;
  } | null>(null);
  const lastListUpdateAtRef = useRef(0);
  const pageRefreshTimerRef = useRef<number | null>(null);
  const lastPageRefreshAtRef = useRef(0);
  // Refs para valores volátiles: evitan que el useEffect de sockets se re-ejecute
  // (y desconecte/reconecte todos los sockets) cada vez que cambia la conversación activa.
  const selectedConversationKeyRef = useRef(selectedConversationKey);
  selectedConversationKeyRef.current = selectedConversationKey;
  const activeInstanceNameRef = useRef(activeInstanceName);
  activeInstanceNameRef.current = activeInstanceName;

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
    const normalizedInstanceNames = normalizedInstanceNamesKey ? normalizedInstanceNamesKey.split("\u0000") : [];
    // Escuchar el socket base y los sockets por instancia cubre ambos modos de Evolution:
    // global (sin /instancia) y tradicional (/instancia). Los refreshes están throttleados,
    // así que los eventos duplicados no generan trabajo extra significativo.
    const socketTargets = Array.from(new Set([null, ...normalizedInstanceNames]));

    if (!enabled || !isVisible || !normalizedBaseUrl || socketTargets.length === 0) {
      return;
    }

    const sockets: Socket[] = [];

    function clearLiveUpdateTimer() {
      if (liveUpdateTimerRef.current) {
        window.clearTimeout(liveUpdateTimerRef.current);
        liveUpdateTimerRef.current = null;
      }
    }

    function clearListUpdateTimer() {
      if (listUpdateTimerRef.current) {
        window.clearTimeout(listUpdateTimerRef.current);
        listUpdateTimerRef.current = null;
      }
    }

    function clearListUpdateFollowUpTimer() {
      if (listUpdateFollowUpTimerRef.current) {
        window.clearTimeout(listUpdateFollowUpTimerRef.current);
        listUpdateFollowUpTimerRef.current = null;
      }
    }

    function clearPageRefreshTimer() {
      if (pageRefreshTimerRef.current) {
        window.clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
    }

    function hydrateConversationSnapshot(value: unknown) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const snapshot = value as {
        id?: unknown;
        messages?: Array<{ createdAt?: string } & Record<string, unknown>>;
      };

      if (typeof snapshot.id !== "string" || !Array.isArray(snapshot.messages)) {
        return null;
      }

      return {
        ...(value as Record<string, unknown>),
        id: snapshot.id,
        messages: snapshot.messages.map((message) => ({
          ...message,
          createdAt: new Date(message.createdAt || Date.now()),
        })),
      };
    }

    async function runLiveUpdate() {
      const normalizedChatKey = selectedConversationKeyRef.current?.trim() || "";
      if (!normalizedChatKey.startsWith("agent:")) {
        return false;
      }

      if (liveUpdateInFlightRef.current) {
        liveUpdateQueuedRef.current = true;
        return true;
      }

      liveUpdateInFlightRef.current = true;

      try {
        const response = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedChatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!response.ok) {
          return false;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown; error?: string }
          | null;

        if (!payload?.ok || !payload.conversation) {
          return false;
        }

        const conversation = hydrateConversationSnapshot(payload.conversation);
        if (!conversation) {
          return false;
        }

        lastLiveUpdateAtRef.current = Date.now();
        window.dispatchEvent(
          new CustomEvent("chat-live-update", {
            detail: {
              conversation,
              chatKey: normalizedChatKey,
            },
          }),
        );

        return true;
      } catch {
        return false;
      } finally {
        liveUpdateInFlightRef.current = false;

        if (liveUpdateQueuedRef.current) {
          liveUpdateQueuedRef.current = false;
          scheduleLiveUpdate("active");
        }
      }
    }

    async function runListUpdate(input: { priority: RefreshPriority; instanceName: string; payload: unknown }) {
      const phoneNumber = extractPhoneNumberFromPayload(input.payload);
      if (!phoneNumber) {
        return false;
      }

      if (listUpdateInFlightRef.current) {
        listUpdatePendingRef.current = input;
        return true;
      }

      listUpdateInFlightRef.current = true;

      try {
        const response = await fetch(
          `/api/cliente/chats/summary?instanceName=${encodeURIComponent(input.instanceName)}&phoneNumber=${encodeURIComponent(phoneNumber)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
          },
        );

        if (!response.ok) {
          console.log("[ListUpdate] fetch falló", { status: response.status, instanceName: input.instanceName, phoneNumber });
          return false;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown; error?: string }
          | null;

        if (!payload?.ok || !payload.conversation) {
          console.log("[ListUpdate] payload inválido o ok=false", { payload });
          return false;
        }

        const conversation = normalizeConversationSummarySnapshot(payload.conversation);
        if (!conversation) {
          console.log("[ListUpdate] normalizeConversationSummarySnapshot devolvió null", payload.conversation);
          return false;
        }

        console.log("[ListUpdate] response ok, despachando chat-list-update", {
          id: conversation.id,
          lastMessage: (conversation as Record<string, unknown>).lastMessage,
          lastMessageAt: (conversation as Record<string, unknown>).lastMessageAt,
        });
        window.dispatchEvent(
          new CustomEvent("chat-list-update", {
            detail: {
              conversation,
            },
          }),
        );

        return true;
      } catch {
        return false;
      } finally {
        listUpdateInFlightRef.current = false;

        const pendingUpdate = listUpdatePendingRef.current;
        listUpdatePendingRef.current = null;

        if (pendingUpdate) {
          scheduleListUpdate(pendingUpdate.priority, pendingUpdate.instanceName, pendingUpdate.payload);
        }
      }
    }

    const scheduleLiveUpdate = (priority: RefreshPriority) => {
      const now = Date.now();
      const minGap = priority === "active" ? ACTIVE_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? ACTIVE_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = lastLiveUpdateAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearLiveUpdateTimer();
      liveUpdateTimerRef.current = window.setTimeout(() => {
        void runLiveUpdate();
      }, Math.max(0, targetAt - now));
    };

    const scheduleListUpdate = (priority: RefreshPriority, instanceName: string, payload: unknown) => {
      const phoneForLog = extractPhoneNumberFromPayload(payload);
      console.log("[ListUpdate] scheduleListUpdate iniciado", { instanceName, priority, phoneNumber: phoneForLog });
      const now = Date.now();
      const minGap = priority === "active" ? LIST_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? LIST_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = lastListUpdateAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearListUpdateTimer();
      clearListUpdateFollowUpTimer();
      listUpdateTimerRef.current = window.setTimeout(() => {
        void runListUpdate({ priority, instanceName, payload }).then((success) => {
          if (success) {
            lastListUpdateAtRef.current = Date.now();
          }
          // Segundo intento ~2500ms después para capturar casos donde el webhook
          // todavía no había escrito el mensaje al DB en el primer intento (race condition).
          clearListUpdateFollowUpTimer();
          listUpdateFollowUpTimerRef.current = window.setTimeout(() => {
            void runListUpdate({ priority: "background", instanceName, payload }).then((retrySuccess) => {
              if (retrySuccess) {
                lastListUpdateAtRef.current = Date.now();
              }
            });
          }, 2500);
        });
      }, Math.max(0, targetAt - now));
    };

    const schedulePageRefresh = (priority: RefreshPriority) => {
      const now = Date.now();
      const minGap = priority === "active" ? PAGE_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? PAGE_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = lastPageRefreshAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearPageRefreshTimer();
      pageRefreshTimerRef.current = window.setTimeout(() => {
        lastPageRefreshAtRef.current = Date.now();
        router.refresh();
      }, Math.max(0, targetAt - now));
    };

    for (const instanceName of socketTargets) {
      const normalizedApiKey = apiKey?.trim() || null;
      const socket = io(buildSocketUrl(normalizedBaseUrl, instanceName), {
        transports: ["websocket", "polling"],
        reconnection: true,
        ...(normalizedApiKey ? { auth: { apikey: normalizedApiKey } } : {}),
      });

      socket.onAny((eventName, ...args) => {
        if (typeof eventName === "string" && shouldTriggerRefresh(eventName)) {
          // Leer refs en el momento del evento — siempre reflejan la conversación actual
          // sin necesidad de recrear los sockets cuando el usuario cambia de chat.
          const normalizedActiveInstanceName = activeInstanceNameRef.current?.trim() || "";
          const isActiveInstance =
            Boolean(normalizedActiveInstanceName) &&
            (!globalEventsEnabled || instanceName === normalizedActiveInstanceName) &&
            instanceName === normalizedActiveInstanceName;
          const payload = args[0];
          const currentConversationKey = selectedConversationKeyRef.current;
          const isOfficialConversationSelected = currentConversationKey?.startsWith("official:");

          if (isActiveInstance) {
            if (isOfficialConversationSelected) {
              schedulePageRefresh("active");
              return;
            }

            scheduleLiveUpdate("active");
            if (currentConversationKey?.startsWith("agent:")) {
              scheduleListUpdate("active", instanceName ?? normalizedActiveInstanceName, payload);
            }
            return;
          }

          const payloadInstanceName =
            payload && typeof payload === "object" && !Array.isArray(payload) && "instanceName" in payload
              ? String((payload as { instanceName?: unknown }).instanceName || "").trim()
              : "";

          if (payloadInstanceName && payloadInstanceName === normalizedActiveInstanceName) {
            if (isOfficialConversationSelected) {
              schedulePageRefresh("active");
              return;
            }

            scheduleLiveUpdate("active");
            if (currentConversationKey?.startsWith("agent:")) {
              scheduleListUpdate("active", normalizedActiveInstanceName, payload);
            }
            return;
          }

          const phoneNumber = extractPhoneNumberFromPayload(payload);
          if (phoneNumber) {
            if (globalEventsEnabled) {
              if (currentConversationKey?.startsWith("agent:")) {
                scheduleLiveUpdate("background");
              }

              // En modo global el payload incluye instanceName: usar ese valor para la
              // query del summary, igual que el path no-global (línea de abajo).
              // schedulePageRefresh("background") se reemplaza por scheduleListUpdate
              // porque page-refresh tiene min-gap de 4000ms y dejaría el preview
              // desactualizado varios segundos; scheduleListUpdate es directo y rápido.
              const listInstanceName = payloadInstanceName || normalizedActiveInstanceName;
              console.log("[WS] scheduleListUpdate llamado", { listInstanceName, phoneNumber, payloadInstanceName, normalizedActiveInstanceName, eventName });
              if (listInstanceName) {
                scheduleListUpdate("background", listInstanceName, payload);
              } else {
                schedulePageRefresh("background");
              }
              return;
            }

            if (isOfficialConversationSelected) {
              schedulePageRefresh("background");
              return;
            }

            scheduleListUpdate("background", payloadInstanceName || (instanceName ?? normalizedActiveInstanceName) || "", payload);
            return;
          }

          if (currentConversationKey?.startsWith("agent:")) {
            scheduleLiveUpdate("background");
            schedulePageRefresh("background");
          } else if (isOfficialConversationSelected) {
            schedulePageRefresh("background");
          }
        }
      });

      sockets.push(socket);
    }

    return () => {
      clearLiveUpdateTimer();
      clearListUpdateTimer();
      clearListUpdateFollowUpTimer();
      clearPageRefreshTimer();
      liveUpdateQueuedRef.current = false;
      liveUpdateInFlightRef.current = false;
      listUpdatePendingRef.current = null;
      listUpdateInFlightRef.current = false;

      for (const socket of sockets) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [apiBaseUrl, apiKey, enabled, isVisible, normalizedInstanceNamesKey, globalEventsEnabled, router]);

  return null;
}
