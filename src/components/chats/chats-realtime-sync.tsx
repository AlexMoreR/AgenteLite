"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type ChatsRealtimeSyncProps = {
  apiBaseUrl?: string;
  instanceNames?: string[];
  activeInstanceName?: string | null;
  selectedConversationKey?: string | null;
  enabled?: boolean;
};

type RefreshPriority = "active" | "background";

const ACTIVE_REFRESH_DELAY_MS = 180;
const BACKGROUND_REFRESH_DELAY_MS = 1200;
const ACTIVE_REFRESH_MIN_GAP_MS = 350;
const BACKGROUND_REFRESH_MIN_GAP_MS = 4000;

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
  instanceNames = [],
  activeInstanceName = null,
  selectedConversationKey = null,
  enabled = true,
}: ChatsRealtimeSyncProps) {
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));
  const normalizedInstanceNames = useMemo(() => normalizeInstanceNames(instanceNames), [instanceNames]);
  const liveUpdateTimerRef = useRef<number | null>(null);
  const liveUpdateInFlightRef = useRef(false);
  const liveUpdateQueuedRef = useRef(false);
  const lastLiveUpdateAtRef = useRef(0);
  const listUpdateTimerRef = useRef<number | null>(null);
  const listUpdateInFlightRef = useRef(false);
  const listUpdateQueuedRef = useRef(false);
  const lastListUpdateAtRef = useRef(0);

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

    const sockets: Socket[] = [];
    const normalizedActiveInstanceName = activeInstanceName?.trim() || "";

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
      const normalizedChatKey = selectedConversationKey?.trim() || "";
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

    async function runListUpdate(input: { instanceName: string; payload: unknown }) {
      const phoneNumber = extractPhoneNumberFromPayload(input.payload);
      if (!phoneNumber) {
        return false;
      }

      if (listUpdateInFlightRef.current) {
        listUpdateQueuedRef.current = true;
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
        listUpdateInFlightRef.current = false;

        if (listUpdateQueuedRef.current) {
          listUpdateQueuedRef.current = false;
          scheduleListUpdate("background", input.instanceName, input.payload);
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
      const now = Date.now();
      const minGap = priority === "active" ? ACTIVE_REFRESH_MIN_GAP_MS : BACKGROUND_REFRESH_MIN_GAP_MS;
      const preferredDelay = priority === "active" ? ACTIVE_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS;
      const earliestAllowedAt = lastListUpdateAtRef.current + minGap;
      const targetAt = Math.max(now + preferredDelay, earliestAllowedAt);

      clearListUpdateTimer();
      listUpdateTimerRef.current = window.setTimeout(() => {
        void runListUpdate({ instanceName, payload }).then((success) => {
          if (success) {
            lastListUpdateAtRef.current = Date.now();
          }
        });
      }, Math.max(0, targetAt - now));
    };

    for (const instanceName of normalizedInstanceNames) {
      const socket = io(buildSocketUrl(normalizedBaseUrl, instanceName), {
        transports: ["websocket", "polling"],
        reconnection: true,
      });

      socket.onAny((eventName, ...args) => {
        if (typeof eventName === "string" && shouldTriggerRefresh(eventName)) {
          const isActiveInstance = normalizedActiveInstanceName && instanceName === normalizedActiveInstanceName;
          const payload = args[0];

          if (isActiveInstance) {
            scheduleLiveUpdate("active");
            if (selectedConversationKey?.startsWith("agent:")) {
              scheduleListUpdate("active", instanceName, payload);
            }
            return;
          }

          const payloadInstanceName =
            payload && typeof payload === "object" && !Array.isArray(payload) && "instanceName" in payload
              ? String((payload as { instanceName?: unknown }).instanceName || "").trim()
              : "";

          if (payloadInstanceName && payloadInstanceName === normalizedActiveInstanceName) {
            scheduleLiveUpdate("active");
            if (selectedConversationKey?.startsWith("agent:")) {
              scheduleListUpdate("active", instanceName, payload);
            }
            return;
          }

          const phoneNumber = extractPhoneNumberFromPayload(payload);
          if (phoneNumber) {
            scheduleListUpdate("background", instanceName, payload);
            return;
          }

          if (selectedConversationKey?.startsWith("agent:")) {
            scheduleLiveUpdate("background");
          }
        }
      });

      sockets.push(socket);
    }

    return () => {
      clearLiveUpdateTimer();
      clearListUpdateTimer();
      liveUpdateQueuedRef.current = false;
      liveUpdateInFlightRef.current = false;
      listUpdateQueuedRef.current = false;
      listUpdateInFlightRef.current = false;

      for (const socket of sockets) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [activeInstanceName, apiBaseUrl, enabled, instanceNames, isVisible, normalizedInstanceNames, selectedConversationKey]);

  return null;
}
