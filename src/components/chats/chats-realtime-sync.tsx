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
  selectedConversationPhoneNumber?: string | null;
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

// Solo @s.whatsapp.net es un JID de contacto individual válido.
// @g.us = grupo, @lid = identificador interno de Meta (no es número), otros = desconocidos.
function isIndividualJid(jid: string | null): boolean {
  return Boolean(jid && jid.endsWith("@s.whatsapp.net"));
}

function extractPhoneNumberFromPayload(payload: unknown): string | null {
  const remoteJid = extractEvolutionRemoteJid(payload) ?? extractEvolutionPhoneNumber(payload);

  // Si el JID principal existe pero no es de contacto individual, descartar todo el payload.
  if (remoteJid && !isIndividualJid(remoteJid)) {
    return null;
  }

  if (remoteJid) {
    return normalizePhoneFromJid(remoteJid);
  }

  // Fallback: buscar en otros campos del payload, filtrando también JIDs no individuales.
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);
  const key = asRecord(data?.key);
  const sender = asRecord(data?.sender);
  const contextInfo = asRecord(asRecord(message?.extendedTextMessage)?.contextInfo);

  const rawJid =
    pickString(key, ["remoteJid", "participant"]) ||
    pickString(sender, ["id", "jid"]) ||
    pickString(data, ["remoteJid", "participant", "from", "phoneNumber", "number", "phone"]) ||
    pickString(contextInfo, ["participant", "remoteJid"]) ||
    pickString(root, ["remoteJid", "phoneNumber", "number", "phone", "owner", "ownerJid", "wuid"]);

  if (!rawJid || !isIndividualJid(rawJid)) {
    return null;
  }

  return normalizePhoneFromJid(rawJid);
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
  selectedConversationPhoneNumber = null,
  enabled = true,
  globalEventsEnabled = false,
}: ChatsRealtimeSyncProps) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));
  const normalizedInstanceNamesKey = Array.from(
    new Set(instanceNames.map((name) => name.trim()).filter(Boolean)),
  ).join("\u0000");
  const liveUpdateTimerRef = useRef<number | null>(null);
  const liveUpdateFollowUpTimerRef = useRef<number | null>(null);
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
    chatKey?: string;
  } | null>(null);
  const lastListUpdateAtRef = useRef(0);
  const pageRefreshTimerRef = useRef<number | null>(null);
  const lastPageRefreshAtRef = useRef(0);
  // Refs para valores volátiles: evitan que el useEffect de sockets se re-ejecute
  // (y desconecte/reconecte todos los sockets) cada vez que cambia la conversación activa.
  const selectedConversationKeyRef = useRef(selectedConversationKey);
  selectedConversationKeyRef.current = selectedConversationKey;
  const selectedConversationPhoneNumberRef = useRef(selectedConversationPhoneNumber);
  selectedConversationPhoneNumberRef.current = selectedConversationPhoneNumber;
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
    // Socket base (null) solo en globalEventsEnabled: Evolution global emite todos los eventos
    // en la raíz. En modo no-global solo conectar por instancia evita conexiones fallidas al
    // base URL que no acepta socket.io sin path de instancia.
    const socketTargets: Array<string | null> = Array.from(new Set([
      ...(globalEventsEnabled ? ([null] as Array<string | null>) : []),
      ...normalizedInstanceNames,
    ]));

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

    function clearLiveUpdateFollowUpTimer() {
      if (liveUpdateFollowUpTimerRef.current) {
        window.clearTimeout(liveUpdateFollowUpTimerRef.current);
        liveUpdateFollowUpTimerRef.current = null;
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

    async function runListUpdate(input: { priority: RefreshPriority; instanceName: string; payload: unknown; chatKey?: string }) {
      const phoneNumber = extractPhoneNumberFromPayload(input.payload);
      if (!phoneNumber && !input.chatKey) {
        return false;
      }

      if (listUpdateInFlightRef.current) {
        listUpdatePendingRef.current = input;
        return true;
      }

      listUpdateInFlightRef.current = true;

      const summaryUrl = input.chatKey
        ? `/api/cliente/chats/summary?chatKey=${encodeURIComponent(input.chatKey)}`
        : `/api/cliente/chats/summary?instanceName=${encodeURIComponent(input.instanceName)}&phoneNumber=${encodeURIComponent(phoneNumber!)}`;

      try {
        const response = await fetch(summaryUrl, {
            credentials: "same-origin",
            cache: "no-store",
          });

        if (!response.ok) {
          console.log("[ListUpdate] fetch error HTTP", { status: response.status, instanceName: input.instanceName, phoneNumber });
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
      clearLiveUpdateFollowUpTimer();
      liveUpdateTimerRef.current = window.setTimeout(() => {
        void runLiveUpdate().then((success) => {
          if (success) {
            lastLiveUpdateAtRef.current = Date.now();
          }
          if (priority === "active") {
            // Segundo intento ~3000ms después: captura la respuesta del agente IA cuya
            // escritura en DB llega tarde respecto al socket event (fromMe: true).
            clearLiveUpdateFollowUpTimer();
            liveUpdateFollowUpTimerRef.current = window.setTimeout(() => {
              void runLiveUpdate().then((retrySuccess) => {
                if (retrySuccess) {
                  lastLiveUpdateAtRef.current = Date.now();
                }
              });
            }, 3000);
          }
        });
      }, Math.max(0, targetAt - now));
    };

    const scheduleListUpdate = (priority: RefreshPriority, instanceName: string, payload: unknown, chatKey?: string) => {
      const phoneForLog = extractPhoneNumberFromPayload(payload);
      console.log("[ListUpdate] scheduleListUpdate iniciado", { instanceName, priority, phoneNumber: phoneForLog, chatKey });
      const now = Date.now();
      const minGap = priority === "active" ? LIST_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? LIST_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = lastListUpdateAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearListUpdateTimer();
      clearListUpdateFollowUpTimer();
      listUpdateTimerRef.current = window.setTimeout(() => {
        void runListUpdate({ priority, instanceName, payload, chatKey }).then((success) => {
          if (success) {
            lastListUpdateAtRef.current = Date.now();
          }
          // Segundo intento ~2500ms después para capturar casos donde el webhook
          // todavía no había escrito el mensaje al DB en el primer intento (race condition).
          clearListUpdateFollowUpTimer();
          listUpdateFollowUpTimerRef.current = window.setTimeout(() => {
            void runListUpdate({ priority: "background", instanceName, payload, chatKey }).then((retrySuccess) => {
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
      const socketApiKey = normalizedApiKey;
      const socket = io(buildSocketUrl(normalizedBaseUrl, instanceName), {
        transports: ["websocket", "polling"],
        reconnection: true,
        ...(socketApiKey ? {
          auth: { apikey: socketApiKey },
          query: { apikey: socketApiKey },
          extraHeaders: { apikey: socketApiKey },
        } : {}),
      });
      console.log("[WS] conectando", { url: buildSocketUrl(normalizedBaseUrl, instanceName), apiKeyUsed: socketApiKey?.slice(0, 8) + "..." });

      socket.onAny((eventName, ...args) => {
        if (typeof eventName === "string" && shouldTriggerRefresh(eventName)) {
          // Leer refs en el momento del evento — siempre reflejan la conversación actual
          // sin necesidad de recrear los sockets cuando el usuario cambia de chat.
          const normalizedActiveInstanceName = activeInstanceNameRef.current?.trim() || "";
          const payload = args[0];
          const phoneNumber = extractPhoneNumberFromPayload(payload);
          const currentConversationKey = selectedConversationKeyRef.current;
          const isOfficialConversationSelected = currentConversationKey?.startsWith("official:");
          const selectedPhoneNumber = selectedConversationPhoneNumberRef.current?.trim() || "";
          const normalizedSelectedPhoneNumber = selectedPhoneNumber.replace(/\D/g, "");
          const isSelectedAgentConversation =
            Boolean(currentConversationKey?.startsWith("agent:")) &&
            Boolean(phoneNumber) &&
            Boolean(normalizedSelectedPhoneNumber) &&
            phoneNumber === normalizedSelectedPhoneNumber;
          const isActiveInstance =
            Boolean(normalizedActiveInstanceName) &&
            (!globalEventsEnabled || instanceName === normalizedActiveInstanceName) &&
            instanceName === normalizedActiveInstanceName;

          if (isActiveInstance) {
            if (isOfficialConversationSelected) {
              schedulePageRefresh("active");
              return;
            }

            if (isSelectedAgentConversation) {
              scheduleLiveUpdate("active");
              // Usar chatKey directamente para no depender de extraer el telefono del payload:
              // esto garantiza que scheduleListUpdate tambien dispare para fromMe: true.
              scheduleListUpdate("active", instanceName ?? normalizedActiveInstanceName, payload, currentConversationKey);
              return;
            }

            if (phoneNumber) {
              scheduleListUpdate("background", instanceName ?? normalizedActiveInstanceName, payload);
              return;
            }

            schedulePageRefresh("background");
            return;
          }

          // Evolution socket.io usa 'instance' (no 'instanceName') como clave del payload global.
          const payloadInstanceName = (() => {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
            const p = payload as Record<string, unknown>;
            return String(p["instanceName"] || p["instance"] || "").trim();
          })();

          if (payloadInstanceName && payloadInstanceName === normalizedActiveInstanceName) {
            if (isOfficialConversationSelected) {
              schedulePageRefresh("active");
              return;
            }

            if (isSelectedAgentConversation) {
              scheduleLiveUpdate("active");
              scheduleListUpdate("active", normalizedActiveInstanceName, payload, currentConversationKey || undefined);
              return;
            }

            if (phoneNumber) {
              scheduleListUpdate("background", payloadInstanceName, payload);
              return;
            }

            schedulePageRefresh("background");
            return;
          }
          if (phoneNumber) {
            if (globalEventsEnabled) {
              if (isSelectedAgentConversation) {
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
      clearLiveUpdateFollowUpTimer();
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

