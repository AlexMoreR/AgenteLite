"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { usePendingConversationSelection } from "./chat-selection-store";
import {
  extractEvolutionPhoneNumber,
  extractEvolutionRemoteJid,
  hasEvolutionDeletedMessagePayload,
  hasEvolutionEditedMessagePayload,
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

  return /MESSAGE|CHAT|CALL|CONTACT|PRESENCE|GROUP|INSTANCE|QRCODE|CONNECTION|STATUS|SESSION|READY/.test(normalized);
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickSocketPayload(args: unknown[]): unknown {
  for (const arg of args) {
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      return arg;
    }

    if (Array.isArray(arg)) {
      const nested = arg.find((item) => item && typeof item === "object" && !Array.isArray(item));
      if (nested) {
        return nested;
      }
    }
  }

  return args[0];
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
  const listUpdateTimerRefs = useRef(new Map<string, number>());
  const listUpdateFollowUpTimerRefs = useRef(new Map<string, number>());
  const listUpdateInFlightKeysRef = useRef(new Set<string>());
  const listUpdatePendingByKeyRef = useRef(
    new Map<string, { priority: RefreshPriority; instanceName: string; payload: unknown; chatKey?: string }>(),
  );
  const lastListUpdateAtByKeyRef = useRef(new Map<string, number>());
  const pageRefreshTimerRef = useRef<number | null>(null);
  const lastPageRefreshAtRef = useRef(0);
  // Refs para valores volátiles: evitan que el useEffect de sockets se re-ejecute
  // (y desconecte/reconecte todos los sockets) cada vez que cambia la conversación activa.
  const selectedConversationKeyRef = useRef(selectedConversationKey);
  selectedConversationKeyRef.current = selectedConversationKey;
  const selectedConversationPhoneNumberRef = useRef(selectedConversationPhoneNumber);
  selectedConversationPhoneNumberRef.current = selectedConversationPhoneNumber;
  const pendingConversation = usePendingConversationSelection();
  const pendingSelectionRef = useRef<{
    key: string | null;
    phoneNumber: string | null;
  } | null>(null);
  pendingSelectionRef.current = pendingConversation
    ? {
        key: pendingConversation.chatKey ?? pendingConversation.id ?? null,
        phoneNumber: pendingConversation.phoneNumber ?? null,
      }
    : null;
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
    const listUpdateTimers = listUpdateTimerRefs.current;
    const listUpdateFollowUpTimers = listUpdateFollowUpTimerRefs.current;
    const listUpdatePendingByKey = listUpdatePendingByKeyRef.current;
    const listUpdateInFlightKeys = listUpdateInFlightKeysRef.current;

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

    function clearPageRefreshTimer() {
      if (pageRefreshTimerRef.current) {
        window.clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
    }

    function getEffectiveSelectedConversationKey() {
      return pendingSelectionRef.current?.key ?? selectedConversationKeyRef.current;
    }

    function getEffectiveSelectedPhoneNumber() {
      return pendingSelectionRef.current?.phoneNumber ?? selectedConversationPhoneNumberRef.current;
    }

    function hydrateConversationSnapshot(value: unknown) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const snapshot = value as {
        id?: unknown;
        messages?: Array<{ createdAt?: string; editedAt?: string | Date | null; deletedAt?: string | Date | null } & Record<string, unknown>>;
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
          editedAt: message.editedAt ? new Date(message.editedAt) : null,
          deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
        })),
      };
    }

    async function runLiveUpdate() {
      const normalizedChatKey = getEffectiveSelectedConversationKey()?.trim() || "";
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

    async function runListUpdate(input: {
      priority: RefreshPriority;
      instanceName: string;
      payload: unknown;
      chatKey?: string;
      updateKey: string;
    }) {
      const phoneNumber = extractPhoneNumberFromPayload(input.payload);
      if (!phoneNumber && !input.chatKey) {
        return false;
      }

      if (listUpdateInFlightKeysRef.current.has(input.updateKey)) {
        listUpdatePendingByKeyRef.current.set(input.updateKey, {
          priority: input.priority,
          instanceName: input.instanceName,
          payload: input.payload,
          chatKey: input.chatKey,
        });
        return true;
      }

      listUpdateInFlightKeysRef.current.add(input.updateKey);

      const summaryUrl = input.chatKey
        ? `/api/cliente/chats/summary?chatKey=${encodeURIComponent(input.chatKey)}`
        : `/api/cliente/chats/summary?instanceName=${encodeURIComponent(input.instanceName)}&phoneNumber=${encodeURIComponent(phoneNumber!)}`;

      try {
        const response = await fetch(summaryUrl, {
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

        const conversation = normalizeConversationSummarySnapshot(payload.conversation);
        if (!conversation) {
          return false;
        }
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
        listUpdateInFlightKeysRef.current.delete(input.updateKey);

        const pendingUpdate = listUpdatePendingByKeyRef.current.get(input.updateKey);
        listUpdatePendingByKeyRef.current.delete(input.updateKey);

        if (pendingUpdate) {
          scheduleListUpdate(pendingUpdate.priority, pendingUpdate.instanceName, pendingUpdate.payload, pendingUpdate.chatKey);
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

    const clearListTimersForKey = (updateKey: string) => {
      const timer = listUpdateTimerRefs.current.get(updateKey);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        listUpdateTimerRefs.current.delete(updateKey);
      }

      const followUpTimer = listUpdateFollowUpTimerRefs.current.get(updateKey);
      if (followUpTimer !== undefined) {
        window.clearTimeout(followUpTimer);
        listUpdateFollowUpTimerRefs.current.delete(updateKey);
      }
    };

    const scheduleListUpdate = (priority: RefreshPriority, instanceName: string, payload: unknown, chatKey?: string) => {
      const phoneNumber = extractPhoneNumberFromPayload(payload);
      const updateKey = chatKey?.trim() || (phoneNumber ? `${instanceName}:${phoneNumber}` : "");
      if (!updateKey) {
        return;
      }

      const now = Date.now();
      const minGap = priority === "active" ? LIST_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? LIST_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = (lastListUpdateAtByKeyRef.current.get(updateKey) ?? 0) + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearListTimersForKey(updateKey);

      const primaryTimer = window.setTimeout(() => {
        void runListUpdate({ priority, instanceName, payload, chatKey, updateKey }).then((success) => {
          if (success) {
            lastListUpdateAtByKeyRef.current.set(updateKey, Date.now());
          }

          // Segundo intento ~2500ms después para capturar casos donde el webhook
          // todavía no había escrito el mensaje al DB en el primer intento (race condition).
          const existingFollowUpTimer = listUpdateFollowUpTimerRefs.current.get(updateKey);
          if (existingFollowUpTimer !== undefined) {
            window.clearTimeout(existingFollowUpTimer);
          }

          const followUpTimer = window.setTimeout(() => {
            void runListUpdate({ priority: "background", instanceName, payload, chatKey, updateKey }).then((retrySuccess) => {
              if (retrySuccess) {
                lastListUpdateAtByKeyRef.current.set(updateKey, Date.now());
              }
            });
          }, 2500);

          listUpdateFollowUpTimerRefs.current.set(updateKey, followUpTimer);
        });
      }, Math.max(0, targetAt - now));

      listUpdateTimerRefs.current.set(updateKey, primaryTimer);
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

      socket.onAny((eventName, ...args) => {
        if (typeof eventName === "string" && shouldTriggerRefresh(eventName)) {
          const normalizedEventName = normalizeEventName(eventName);
          // Leer refs en el momento del evento — siempre reflejan la conversación actual
          // sin necesidad de recrear los sockets cuando el usuario cambia de chat.
          const normalizedActiveInstanceName = activeInstanceNameRef.current?.trim() || "";
          const payload = pickSocketPayload(args);
          const isEditedOrDeletedPayload =
            hasEvolutionEditedMessagePayload(payload) || hasEvolutionDeletedMessagePayload(payload);
          const phoneNumber = extractPhoneNumberFromPayload(payload);
          const currentConversationKey = pendingSelectionRef.current?.key ?? selectedConversationKeyRef.current;
          const isOfficialConversationSelected = currentConversationKey?.startsWith("official:");
          const selectedPhoneNumber = getEffectiveSelectedPhoneNumber()?.trim() || "";
          const normalizedSelectedPhoneNumber = selectedPhoneNumber.replace(/\D/g, "");
          const hasActiveAgentConversation = Boolean(currentConversationKey?.startsWith("agent:"));
          const isSelectedAgentConversation =
            hasActiveAgentConversation &&
            Boolean(phoneNumber) &&
            Boolean(normalizedSelectedPhoneNumber) &&
            phoneNumber === normalizedSelectedPhoneNumber;

          if (hasActiveAgentConversation) {
            scheduleLiveUpdate("active");

            if (isEditedOrDeletedPayload) {
              return;
            }

            if (phoneNumber) {
              // Solo el chat seleccionado necesita forzar `chatKey`.
              // Si el evento pertenece a otra conversación, dejamos que el
              // summary se resuelva por `instanceName + phoneNumber` para que
              // la lista refleje el chat correcto.
              scheduleListUpdate(
                "active",
                instanceName ?? normalizedActiveInstanceName,
                payload,
                isSelectedAgentConversation ? currentConversationKey || undefined : undefined,
              );
            } else {
              // Si no se pudo extraer el número, igual refrescamos pronto la
              // vista activa para no dejar la bandeja "congelada" varios segundos.
              schedulePageRefresh("active");
            }
            return;
          }

          const isActiveInstance =
            Boolean(normalizedActiveInstanceName) &&
            (!globalEventsEnabled || instanceName === normalizedActiveInstanceName) &&
            instanceName === normalizedActiveInstanceName;

          if (isActiveInstance) {
            if (isOfficialConversationSelected) {
              if (isEditedOrDeletedPayload) {
                return;
              }
              schedulePageRefresh("active");
              return;
            }

            if (isSelectedAgentConversation) {
              scheduleLiveUpdate("active");
              if (isEditedOrDeletedPayload) {
                return;
              }
              return;
            }

            if (isEditedOrDeletedPayload) {
              return;
            }

            if (phoneNumber) {
              scheduleListUpdate("active", instanceName ?? normalizedActiveInstanceName, payload);
              return;
            }

            schedulePageRefresh("active");
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
              if (isEditedOrDeletedPayload) {
                return;
              }
              schedulePageRefresh("active");
              return;
            }

            if (isSelectedAgentConversation) {
              scheduleLiveUpdate("active");
              if (isEditedOrDeletedPayload) {
                return;
              }
              return;
            }

            if (isEditedOrDeletedPayload) {
              return;
            }

            if (phoneNumber) {
              scheduleListUpdate("active", payloadInstanceName, payload);
              return;
            }

            schedulePageRefresh("active");
            return;
          }
          if (phoneNumber) {
            if (globalEventsEnabled) {
              if (isSelectedAgentConversation) {
                scheduleLiveUpdate("background");
              }

              if (isEditedOrDeletedPayload) {
                return;
              }

              // En modo global el payload incluye instanceName: usar ese valor para la
              // query del summary, igual que el path no-global (línea de abajo).
              // schedulePageRefresh("background") se reemplaza por scheduleListUpdate
              // porque page-refresh tiene min-gap de 4000ms y dejaría el preview
              // desactualizado varios segundos; scheduleListUpdate es directo y rápido.
              const listInstanceName = payloadInstanceName || normalizedActiveInstanceName;
              if (listInstanceName) {
                scheduleListUpdate("active", listInstanceName, payload);
              } else {
                schedulePageRefresh("active");
              }
              return;
            }

            if (isOfficialConversationSelected) {
              if (isEditedOrDeletedPayload) {
                return;
              }
              schedulePageRefresh("background");
              return;
            }

            if (isEditedOrDeletedPayload) {
              return;
            }

            scheduleListUpdate("active", payloadInstanceName || (instanceName ?? normalizedActiveInstanceName) || "", payload);
            return;
          }

          if (currentConversationKey?.startsWith("agent:")) {
            scheduleLiveUpdate("background");
            if (isEditedOrDeletedPayload) {
              return;
            }
            schedulePageRefresh("background");
          } else if (isOfficialConversationSelected) {
            if (isEditedOrDeletedPayload) {
              return;
            }
            schedulePageRefresh("background");
          } else if (/MESSAGE|CHAT/.test(normalizedEventName)) {
            if (isEditedOrDeletedPayload) {
              return;
            }
            // Fallback para payloads que no dejan extraer el telefono pero sí son eventos
            // de mensaje reales. Un refresh de background mantiene la lista viva.
            schedulePageRefresh("background");
          }
        }
      });

      sockets.push(socket);
    }

    return () => {
      clearLiveUpdateTimer();
      clearLiveUpdateFollowUpTimer();
      for (const timer of listUpdateTimers.values()) {
        window.clearTimeout(timer);
      }
      for (const timer of listUpdateFollowUpTimers.values()) {
        window.clearTimeout(timer);
      }
      listUpdateTimers.clear();
      listUpdateFollowUpTimers.clear();
      listUpdatePendingByKey.clear();
      listUpdateInFlightKeys.clear();
      clearPageRefreshTimer();
      liveUpdateQueuedRef.current = false;
      liveUpdateInFlightRef.current = false;

      for (const socket of sockets) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [apiBaseUrl, apiKey, enabled, isVisible, normalizedInstanceNamesKey, globalEventsEnabled, router]);

  return null;
}


