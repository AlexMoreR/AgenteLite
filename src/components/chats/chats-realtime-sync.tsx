"use client";

import { useEffect, useRef } from "react";
import { usePendingConversationSelection } from "./chat-selection-store";
import {
  extractEvolutionEventName,
  extractEvolutionPhoneNumber,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionFromMe,
  extractEvolutionMessageId,
  extractEvolutionMediaUrl,
  extractEvolutionPushName,
  extractEvolutionRemoteJid,
  extractEvolutionInstanceName,
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

// Logs de depuración del realtime desactivados. Poner en true puntualmente si se
// necesita diagnosticar el socket de Evolution; en desarrollo normal ensucian la consola.
const CHAT_REALTIME_DEBUG = false;

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

function buildNativeWebSocketUrl(baseUrl: string, token: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl || !token.trim()) {
    return "";
  }

  const url = new URL(`${normalizedBaseUrl}/ws`);
  // https:// y wss:// → wss:// ; http:// y ws:// → ws://.
  // (El bug anterior degradaba wss:// a ws://, que el navegador bloquea en páginas https.)
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.searchParams.set("token", token.trim());
  return url.toString();
}

function normalizeEventName(eventName: string) {
  return eventName.trim().replace(/[\s.-]+/g, "_").toUpperCase();
}

function buildSocketUpdateSignature(input: {
  eventName: string;
  conversationKey?: string | null;
  instanceName?: string | null;
  phoneNumber?: string | null;
  payload: unknown;
}) {
  const messageId = extractEvolutionMessageId(input.payload)?.trim() || "";
  const messageText = extractEvolutionMessageText(input.payload)?.trim() || "";
  const messageType = extractEvolutionMessageType(input.payload)?.trim() || "";
  const mediaUrl = extractEvolutionMediaUrl(input.payload)?.trim() || "";
  const remoteJid = extractEvolutionRemoteJid(input.payload)?.trim() || "";
  const fromMe = extractEvolutionFromMe(input.payload) ? "1" : "0";
  const edited = hasEvolutionEditedMessagePayload(input.payload) ? "1" : "0";
  const deleted = hasEvolutionDeletedMessagePayload(input.payload) ? "1" : "0";

  if (!messageId && !messageText && !messageType && !mediaUrl && !remoteJid) {
    return null;
  }

  return [
    normalizeEventName(input.eventName),
    input.conversationKey?.trim() || "",
    input.instanceName?.trim() || "",
    input.phoneNumber?.trim() || "",
    messageId,
    messageText,
    messageType,
    mediaUrl,
    remoteJid,
    fromMe,
    edited,
    deleted,
  ].join("|");
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

function pickString(source: UnknownRecord | null, keys: string[]): string | null {
  if (!source) return null;

  for (const key of keys) {
    const value = readString(source[key]);
    if (value) return value;
  }

  return null;
}

// @s.whatsapp.net es el JID de contacto individual. Evolution Go a veces entrega
// solo los digitos; eso tambien es valido si normaliza a un telefono real.
// @g.us = grupo, @lid = identificador interno de Meta, status = estados.
function isIndividualContactAddress(value: string | null): boolean {
  if (!value?.trim()) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("@")) {
    return normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@c.us");
  }

  return Boolean(normalizePhoneFromJid(normalized));
}

function extractPhoneNumberFromPayload(payload: unknown): string | null {
  // Evolution GO (whatsmeow) manda data.Info con Chat/Sender/RecipientAlt/SenderAlt en vez
  // de data.key.remoteJid. El número real del contacto (@s.whatsapp.net) está en:
  //  - Entrante (IsFromMe=false): Info.Sender / Info.Chat.
  //  - Saliente (IsFromMe=true): Info.RecipientAlt (Chat/Sender vienen como @lid, ID privado).
  // Tomamos el primer candidato que sea un contacto individual real.
  const earlyRoot = asRecord(payload);
  const earlyData = asRecord(earlyRoot?.data);
  const info = asRecord(earlyData?.Info) ?? asRecord(earlyData?.info);
  if (info) {
    const infoCandidates = [
      readString(info.RecipientAlt),
      readString(info.Sender),
      readString(info.Chat),
      readString(info.SenderAlt),
    ];
    for (const jid of infoCandidates) {
      if (jid && isIndividualContactAddress(jid)) {
        return normalizePhoneFromJid(jid);
      }
    }
  }

  const remoteJid = extractEvolutionRemoteJid(payload) ?? extractEvolutionPhoneNumber(payload);

  // Si el identificador principal existe pero no es de contacto individual, descartar todo el payload.
  if (remoteJid && !isIndividualContactAddress(remoteJid)) {
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

  if (!rawJid || !isIndividualContactAddress(rawJid)) {
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
  const normalizedInstanceNamesKey = Array.from(
    new Set(instanceNames.map((name) => name.trim()).filter(Boolean)),
  ).join("\u0000");
  const liveUpdateTimerRef = useRef<number | null>(null);
  const liveUpdateFollowUpTimerRef = useRef<number | null>(null);
  const liveUpdateInFlightRef = useRef(false);
  const liveUpdateQueuedRef = useRef(false);
  const lastLiveUpdateAtRef = useRef(0);
  const lastLiveUpdateSignatureRef = useRef("");
  const listUpdateTimerRefs = useRef(new Map<string, number>());
  const listUpdateFollowUpTimerRefs = useRef(new Map<string, number>());
  const listUpdateInFlightKeysRef = useRef(new Set<string>());
  const listUpdatePendingByKeyRef = useRef(
    new Map<
      string,
      {
        priority: RefreshPriority;
        instanceName: string;
        payload: unknown;
        chatKey?: string;
        signature?: string | null;
        followUp?: boolean;
      }
    >(),
  );
  const lastListUpdateSignatureByKeyRef = useRef(new Map<string, string>());
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
  // Dedup de notificaciones: un mismo mensaje puede llegar por varios sockets (global + instancia).
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl);

    if (!enabled || !normalizedBaseUrl || !apiKey?.trim()) {
      return;
    }

    let nativeSocket: WebSocket | null = null;
    let nativeReconnectTimer: number | null = null;
    let nativeSocketClosedByCleanup = false;
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

    function clearNativeReconnectTimer() {
      if (nativeReconnectTimer !== null) {
        window.clearTimeout(nativeReconnectTimer);
        nativeReconnectTimer = null;
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
      signature?: string | null;
      followUp?: boolean;
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
          signature: input.signature ?? null,
          followUp: input.followUp ?? false,
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
          scheduleListUpdate(
            pendingUpdate.priority,
            pendingUpdate.instanceName,
            pendingUpdate.payload,
            pendingUpdate.chatKey,
            {
              signature: pendingUpdate.signature ?? null,
              followUp: pendingUpdate.followUp ?? false,
            },
          );
        }
      }
    }

    const scheduleLiveUpdate = (
      priority: RefreshPriority,
      options: { signature?: string | null; followUp?: boolean } = {},
    ) => {
      const now = Date.now();
      const minGap = priority === "active" ? ACTIVE_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? ACTIVE_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const signature = options.signature?.trim() || "";
      if (signature && lastLiveUpdateSignatureRef.current === signature) {
        debugRealtimeSync("skip duplicate live update", { priority, signature });
        return;
      }

      if (signature) {
        lastLiveUpdateSignatureRef.current = signature;
      }

      const earliestAllowedAt = lastLiveUpdateAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearLiveUpdateTimer();
      clearLiveUpdateFollowUpTimer();
      liveUpdateTimerRef.current = window.setTimeout(() => {
        void runLiveUpdate().then((success) => {
          if (success) {
            lastLiveUpdateAtRef.current = Date.now();
          }
          if (priority === "active" && options.followUp) {
            // Reintento diferido solo para mensajes salientes, donde el webhook puede
            // llegar antes que la escritura final en la base de datos.
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

    const scheduleListUpdate = (
      priority: RefreshPriority,
      instanceName: string,
      payload: unknown,
      chatKey?: string,
      options: { signature?: string | null; followUp?: boolean } = {},
    ) => {
      const phoneNumber = extractPhoneNumberFromPayload(payload);
      const updateKey = chatKey?.trim() || (phoneNumber ? `${instanceName}:${phoneNumber}` : "");
      if (!updateKey) {
        debugRealtimeSync("skip schedule list update without key", {
          priority,
          instanceName,
        });
        return;
      }

      const signature = options.signature?.trim() || "";
      const lastSignature = lastListUpdateSignatureByKeyRef.current.get(updateKey) || "";
      if (signature && signature === lastSignature) {
        debugRealtimeSync("skip duplicate list update", {
          updateKey,
          priority,
          instanceName,
          chatKey: chatKey ?? null,
          phoneNumber,
          signature,
        });
        return;
      }

      if (signature) {
        lastListUpdateSignatureByKeyRef.current.set(updateKey, signature);
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
          signature,
          followUp: options.followUp,
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
        void runListUpdate({ priority, instanceName, payload, chatKey, updateKey, signature, followUp: options.followUp }).then((success) => {
          if (success) {
            lastListUpdateAtByKeyRef.current.set(updateKey, Date.now());
          }

          const existingFollowUpTimer = listUpdateFollowUpTimerRefs.current.get(updateKey);
          if (existingFollowUpTimer !== undefined) {
            window.clearTimeout(existingFollowUpTimer);
            listUpdateFollowUpTimerRefs.current.delete(updateKey);
          }

          if (options.followUp) {
            // Reintento diferido solo para mensajes salientes; evita duplicar lecturas
            // en eventos entrantes que ya quedaron bien con el primer summary.
            const followUpTimer = window.setTimeout(() => {
              listUpdateFollowUpTimerRefs.current.delete(updateKey);
              void runListUpdate({
                priority: "background",
                instanceName,
                payload,
                chatKey,
                updateKey,
                signature,
                followUp: false,
              }).then((retrySuccess) => {
                if (retrySuccess) {
                  lastListUpdateAtByKeyRef.current.set(updateKey, Date.now());
                }
              });
            }, 2500);

            listUpdateFollowUpTimerRefs.current.set(updateKey, followUpTimer);
          }
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
        // Prueba de rendimiento: no forzamos refresh completo aquí.
        // Confiamos en el socket + updates optimistas para mantener la UI al día.
      }, Math.max(0, targetAt - now));
    };

    const handleRealtimeEvent = (input: {
      eventName: string;
      payload: unknown;
      socketInstanceName?: string | null;
    }) => {
      const normalizedEventName = normalizeEventName(input.eventName);
      const normalizedActiveInstanceName = activeInstanceNameRef.current?.trim() || "";
      const payload = input.payload;
      const socketInstanceName = input.socketInstanceName?.trim() || "";
      const payloadInstanceName = extractEvolutionInstanceName(payload)?.trim() || "";
      const effectiveInstanceName = socketInstanceName || payloadInstanceName;
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
      const eventSignature = buildSocketUpdateSignature({
        eventName: normalizedEventName,
        conversationKey: currentConversationKey,
        instanceName: effectiveInstanceName || socketInstanceName,
        phoneNumber,
        payload,
      });
      const hasMessageContent =
        Boolean(extractEvolutionMessageText(payload)?.trim()) ||
        Boolean(extractEvolutionMediaUrl(payload)?.trim()) ||
        Boolean(extractEvolutionMessageType(payload)?.trim());
      // El reintento diferido es para mensajes SALIENTES (fromMe): el webhook puede tardar en
      // guardarlos y el primer summary llega antes. Evolution GO marca el saliente en
      // data.Info.IsFromMe (extractEvolutionFromMe, hecho para Evolution API, no lo detecta ahí).
      const goInfoRecord = asRecord(asRecord(asRecord(payload)?.data)?.Info);
      const isOutgoingMessage = Boolean(extractEvolutionFromMe(payload)) || goInfoRecord?.IsFromMe === true;
      const shouldFollowUp =
        !isEditedOrDeletedPayload &&
        /MESSAGE/.test(normalizedEventName) &&
        isOutgoingMessage;
      const isEventForSelectedInstance =
        !normalizedActiveInstanceName ||
        !effectiveInstanceName ||
        effectiveInstanceName === normalizedActiveInstanceName;
      const isInboundMessage =
        !extractEvolutionFromMe(payload) &&
        !isEditedOrDeletedPayload &&
        Boolean(phoneNumber) &&
        hasMessageContent &&
        /MESSAGE/.test(normalizedEventName);
      if (isInboundMessage) {
        const messageId = extractEvolutionMessageId(payload)?.trim() || "";
        const isDuplicate = messageId ? notifiedMessageIdsRef.current.has(messageId) : false;
        if (!isDuplicate) {
          if (messageId) {
            notifiedMessageIdsRef.current.add(messageId);
            if (notifiedMessageIdsRef.current.size > 200) {
              const oldest = notifiedMessageIdsRef.current.values().next().value;
              if (oldest) notifiedMessageIdsRef.current.delete(oldest);
            }
          }
          window.dispatchEvent(
            new CustomEvent("chat-incoming-message", {
              detail: {
                phoneNumber,
                senderName: extractEvolutionPushName(payload)?.trim() || null,
                text: extractEvolutionMessageText(payload)?.trim() || "",
                type: extractEvolutionMessageType(payload) || null,
                chatKey: isSelectedAgentConversation ? currentConversationKey ?? null : null,
                isActiveConversation: isSelectedAgentConversation,
              },
            }),
          );
        }
      }

      debugRealtimeSync("realtime event", {
        eventName: normalizedEventName,
        socketInstanceName: socketInstanceName || null,
        payloadInstanceName: payloadInstanceName || null,
        effectiveInstanceName: effectiveInstanceName || null,
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
        // Los mensajes SALIENTES del agente (SendMessage / fromMe) a veces no traen el teléfono
        // en un campo que podamos casar con la conversación seleccionada, así que
        // isSelectedAgentConversation queda false y la respuesta del bot no aparecía en vivo.
        // Si es un saliente en la instancia activa (con una conversación de agente abierta),
        // refrescamos igual: la recarga de /live es idempotente y muestra la respuesta al vuelo.
        const canRefreshSelectedConversation =
          (isSelectedAgentConversation || isOutgoingMessage) && isEventForSelectedInstance;
        if (canRefreshSelectedConversation) {
          scheduleLiveUpdate("active", {
            signature: eventSignature,
            followUp: shouldFollowUp,
          });
        }
        if (canRefreshSelectedConversation && !isEditedOrDeletedPayload) {
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
          if (canRefreshSelectedConversation) {
            scheduleListUpdate(
              "active",
              effectiveInstanceName || normalizedActiveInstanceName,
              payload,
              currentConversationKey || undefined,
              {
                signature: eventSignature,
                followUp: shouldFollowUp,
              },
            );
          }
          return;
        }

        if (isEditedOrDeletedPayload) {
          return;
        }

        const summaryInstanceName = effectiveInstanceName || (isSelectedAgentConversation ? normalizedActiveInstanceName : "");
        if (!summaryInstanceName) {
          debugRealtimeSync("skip list update without instance", {
            eventName: normalizedEventName,
            phoneNumber,
            payloadInstanceName,
          });
          return;
        }
        scheduleListUpdate(
          "active",
          summaryInstanceName,
          payload,
          canRefreshSelectedConversation ? currentConversationKey || undefined : undefined,
          {
            signature: eventSignature,
            followUp: shouldFollowUp,
          },
        );
        return;
      }

      const isActiveInstance =
        Boolean(normalizedActiveInstanceName) &&
        (!globalEventsEnabled || effectiveInstanceName === normalizedActiveInstanceName) &&
        effectiveInstanceName === normalizedActiveInstanceName;

      if (isActiveInstance) {
        if (isOfficialConversationSelected) {
          if (isEditedOrDeletedPayload) {
            return;
          }
          schedulePageRefresh("active");
          return;
        }

        if (isSelectedAgentConversation) {
          scheduleLiveUpdate("active", {
            signature: eventSignature,
            followUp: shouldFollowUp,
          });
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
          scheduleListUpdate("active", effectiveInstanceName || normalizedActiveInstanceName, payload, undefined, {
            signature: eventSignature,
            followUp: shouldFollowUp,
          });
          return;
        }

        schedulePageRefresh("active");
        return;
      }

      if (effectiveInstanceName && effectiveInstanceName === normalizedActiveInstanceName) {
        if (isOfficialConversationSelected) {
          if (isEditedOrDeletedPayload) {
            return;
          }
          schedulePageRefresh("active");
          return;
        }

        if (isSelectedAgentConversation) {
          scheduleLiveUpdate("active", {
            signature: eventSignature,
            followUp: shouldFollowUp,
          });
          if (isEditedOrDeletedPayload) {
            return;
          }
          return;
        }

        if (isEditedOrDeletedPayload) {
          return;
        }

        if (phoneNumber) {
          scheduleListUpdate("active", effectiveInstanceName, payload, undefined, {
            signature: eventSignature,
            followUp: shouldFollowUp,
          });
          return;
        }

        schedulePageRefresh("active");
        return;
      }

      if (phoneNumber) {
        if (globalEventsEnabled) {
          if (isSelectedAgentConversation) {
            scheduleLiveUpdate("background", {
              signature: eventSignature,
              followUp: shouldFollowUp,
            });
          }

          if (isEditedOrDeletedPayload) {
            return;
          }

          const listInstanceName = effectiveInstanceName || (isSelectedAgentConversation ? normalizedActiveInstanceName : "");
          if (listInstanceName) {
            scheduleListUpdate("active", listInstanceName, payload, undefined, {
              signature: eventSignature,
              followUp: shouldFollowUp,
            });
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

        scheduleListUpdate(
          "active",
          effectiveInstanceName || normalizedActiveInstanceName,
          payload,
          undefined,
          {
            signature: eventSignature,
            followUp: shouldFollowUp,
          },
        );
        return;
      }

      if (currentConversationKey?.startsWith("agent:")) {
        scheduleLiveUpdate("background", {
          signature: eventSignature,
          followUp: shouldFollowUp,
        });
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
        schedulePageRefresh("background");
      }
    };

    const nativeWebSocketUrl = apiKey?.trim() ? buildNativeWebSocketUrl(normalizedBaseUrl, apiKey) : "";
    const connectNativeSocket = () => {
      if (!nativeWebSocketUrl || nativeSocketClosedByCleanup) {
        return;
      }

      try {
        nativeSocket = new WebSocket(nativeWebSocketUrl);
      } catch {
        nativeSocket = null;
        return;
      }

      nativeSocket.onmessage = (event) => {
        try {
          const rawFrame = typeof event.data === "string" ? event.data : "";
          if (!rawFrame) {
            return;
          }

          const frame = JSON.parse(rawFrame) as Record<string, unknown>;
          const rawPayload =
            typeof frame.payload === "string"
              ? JSON.parse(frame.payload)
              : frame.payload;
          const queueName = readString(frame.queue) || readString(frame.event) || "";
          const eventName = extractEvolutionEventName(rawPayload) || queueName;

          if (!eventName || !shouldTriggerRefresh(eventName)) {
            return;
          }

          handleRealtimeEvent({
            eventName,
            payload: rawPayload,
            socketInstanceName: extractEvolutionInstanceName(rawPayload),
          });
        } catch {
          // Ignorar frames no parseables.
        }
      };

      nativeSocket.onclose = () => {
        nativeSocket = null;
        if (nativeSocketClosedByCleanup) {
          return;
        }

        clearNativeReconnectTimer();
        nativeReconnectTimer = window.setTimeout(() => {
          connectNativeSocket();
        }, 2500);
      };
    };

    connectNativeSocket();

    return () => {
      nativeSocketClosedByCleanup = true;
      clearLiveUpdateTimer();
      clearLiveUpdateFollowUpTimer();
      clearNativeReconnectTimer();
      nativeSocket?.close();
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
    };
  }, [apiBaseUrl, apiKey, enabled, normalizedInstanceNamesKey, globalEventsEnabled]);

  return null;
}

