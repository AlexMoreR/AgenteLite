"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { usePendingConversationSelection } from "./chat-selection-store";
import {
  extractEvolutionPhoneNumber,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionFromMe,
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

const CHAT_REALTIME_DEBUG = process.env.NODE_ENV !== "production";
const ACTIVE_REFRESH_DELAY_MS = 180;
const BACKGROUND_REFRESH_DELAY_MS = 1200;
const ACTIVE_REFRESH_MIN_GAP_MS = 350;
const BACKGROUND_REFRESH_MIN_GAP_MS = 4000;
const PAGE_REFRESH_DELAY_MS = 250;
const PAGE_REFRESH_MIN_GAP_MS = 1200;
// El live-update de la conversacion activa puede ir rapido (180ms) porque solo
// lee mensajes ya guardados por el webhook en ese momento. El summary de lista
// necesita mas margen: el webhook puede tardar 500-1000ms en escribir el mensaje
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

function debugRealtimeSync(...args: unknown[]) {
  if (!CHAT_REALTIME_DEBUG) {
    return;
  }

  console.log("[ChatsRealtimeSync]", ...args);
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

// Solo @s.whatsapp.net es un JID de contacto individual valido.
// @g.us = grupo, @lid = identificador interno de Meta (no es numero), otros = desconocidos.
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

  // Fallback: buscar en otros campos del payload, filtrando tambien JIDs no individuales.
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

function buildOptimisticConversationListSnapshot(input: {
  conversationKey: string;
  payload: unknown;
}) {
  const lastMessage = extractEvolutionMessageText(input.payload)?.trim() || null;
  const lastMessageType = extractEvolutionMessageType(input.payload);
  const lastMessageDirection = extractEvolutionFromMe(input.payload) ? "OUTBOUND" : "INBOUND";

  return {
    id: input.conversationKey,
    lastMessage,
    lastMessageType,
    lastMessageDirection,
    lastMessageAt: new Date().toISOString(),
    incomingCount: lastMessageDirection === "INBOUND" ? 1 : 0,
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
  // Refs para valores volatiles: evitan que el useEffect de sockets se re-ejecute
  // (y desconecte/reconecte todos los sockets) cada vez que cambia la conversacion activa.
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
    // en la raiz. En modo no-global solo conectar por instancia evita conexiones fallidas al
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
        debugRealtimeSync("skip live update", { normalizedChatKey });
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
        debugRealtimeSync("live update applied", {
          chatKey: normalizedChatKey,
          messageCount: Array.isArray((conversation as { messages?: unknown[] }).messages)
            ? (conversation as { messages?: unknown[] }).messages?.length ?? null
            : null,
        });
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
        debugRealtimeSync("skip list update without key", {
          instanceName: input.instanceName,
          priority: input.priority,
        });
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

      debugRealtimeSync("run list update", {
        updateKey: input.updateKey,
        priority: input.priority,
        instanceName: input.instanceName,
        chatKey: input.chatKey ?? null,
        phoneNumber,
        summaryUrl,
      });

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
        debugRealtimeSync("list update applied", {
          updateKey: input.updateKey,
          conversationId: conversation.id,
          lastMessageAt: conversation.lastMessageAt?.toISOString?.() ?? null,
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
            // Segundo intento ~3000ms despues: captura la respuesta del agente IA cuya
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
      const phoneNumber = extractPhoneNumberFromPayload(payload);
      const updateKey = chatKey?.trim() || (phoneNumber ? `${instanceName}:${phoneNumber}` : "");
      if (!updateKey) {
        debugRealtimeSync("skip schedule list update without key", {
          priority,
          instanceName,
        });
        return;
      }

      const now = Date.now();
      const minGap = priority === "active" ? LIST_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? LIST_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = (lastListUpdateAtByKeyRef.current.get(updateKey) ?? 0) + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      const existingTimer = listUpdateTimerRefs.current.get(updateKey);
      const existingFollowUpTimer = listUpdateFollowUpTimerRefs.current.get(updateKey);

      if (existingTimer !== undefined || existingFollowUpTimer !== undefined || listUpdateInFlightKeysRef.current.has(updateKey)) {
        debugRealtimeSync("queue list update payload", {
          updateKey,
          priority,
          instanceName,
          chatKey: chatKey ?? null,
          phoneNumber,
        });
        listUpdatePendingByKeyRef.current.set(updateKey, {
          priority,
          instanceName,
          payload,
          chatKey,
        });
        return;
      }

      debugRealtimeSync("schedule list update", {
        updateKey,
        priority,
        instanceName,
        chatKey: chatKey ?? null,
        phoneNumber,
        targetAt,
      });
      const primaryTimer = window.setTimeout(() => {
        listUpdateTimerRefs.current.delete(updateKey);
        void runListUpdate({ priority, instanceName, payload, chatKey, updateKey }).then((success) => {
          if (success) {
            lastListUpdateAtByKeyRef.current.set(updateKey, Date.now());
          }

          // Segundo intento ~2500ms despues para capturar casos donde el webhook
          // todavia no habia escrito el mensaje al DB en el primer intento (race condition).
          const existingFollowUpTimer = listUpdateFollowUpTimerRefs.current.get(updateKey);
          if (existingFollowUpTimer !== undefined) {
            window.clearTimeout(existingFollowUpTimer);
            listUpdateFollowUpTimerRefs.current.delete(updateKey);
          }

          const followUpTimer = window.setTimeout(() => {
            listUpdateFollowUpTimerRefs.current.delete(updateKey);
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
          // Leer refs en el momento del evento - siempre reflejan la conversacion actual
          // sin necesidad de recrear los sockets cuando el usuario cambia de chat.
          const normalizedActiveInstanceName = activeInstanceNameRef.current?.trim() || "";
          const payload = pickSocketPayload(args);
          const payloadRemoteJid = extractEvolutionRemoteJid(payload);
          const payloadPhoneNumber = extractEvolutionPhoneNumber(payload);
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

          debugRealtimeSync("socket event", {
            eventName: normalizedEventName,
            instanceName,
            currentConversationKey,
            selectedPhoneNumber: normalizedSelectedPhoneNumber || null,
            phoneNumber,
            payloadRemoteJid,
            payloadPhoneNumber,
            hasActiveAgentConversation,
            isSelectedAgentConversation,
            isOfficialConversationSelected,
            isEditedOrDeletedPayload,
          });

          if (hasActiveAgentConversation) {
            scheduleLiveUpdate("active");
            if (isSelectedAgentConversation && !isEditedOrDeletedPayload) {
              window.dispatchEvent(
                new CustomEvent("chat-list-update", {
                  detail: {
                    conversation: buildOptimisticConversationListSnapshot({
                      conversationKey: currentConversationKey || "",
                      payload,
                    }),
                  },
                }),
              );
            }
            if (!phoneNumber) {
              scheduleListUpdate(
                "active",
                instanceName ?? normalizedActiveInstanceName,
                payload,
                currentConversationKey || undefined,
              );
              return;
            }

            if (isEditedOrDeletedPayload) {
              return;
            }

            // Con número disponible, actualizamos solo el resumen de la lista.
            // El chat activo ya quedó cubierto por `scheduleLiveUpdate("active")`.
            scheduleListUpdate(
              "active",
              instanceName ?? normalizedActiveInstanceName,
              payload,
              isSelectedAgentConversation ? currentConversationKey || undefined : undefined,
            );
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
              if (!isEditedOrDeletedPayload) {
                window.dispatchEvent(
                  new CustomEvent("chat-list-update", {
                    detail: {
                      conversation: buildOptimisticConversationListSnapshot({
                        conversationKey: currentConversationKey || "",
                        payload,
                      }),
                    },
                  }),
                );
              }
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
              // query del summary, igual que el path no-global (linea de abajo).
              // schedulePageRefresh("background") se reemplaza por scheduleListUpdate
              // porque page-refresh tiene min-gap de 4000ms y dejaria el preview
              // desactualizado varios segundos; scheduleListUpdate es directo y rapido.
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
            // Fallback para payloads que no dejan extraer el telefono pero si son eventos
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

