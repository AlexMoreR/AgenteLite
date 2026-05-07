"use client";

import { readConversationFromCache, saveConversationToCache } from "./chat-history-cache";
import type { SharedInboxSelectedConversation } from "./shared-inbox";

type WarmupConversationResponse = {
  ok?: boolean;
  conversation?: unknown;
};

const inflightWarmups = new Map<string, Promise<void>>();

function normalizeSelectedConversation(value: unknown): SharedInboxSelectedConversation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    messages?: Array<{ createdAt?: string | Date } & Record<string, unknown>>;
  };

  if (typeof data.id !== "string" || !Array.isArray(data.messages)) {
    return null;
  }

  return {
    ...(value as SharedInboxSelectedConversation),
    id: data.id,
    messages: data.messages
      .map((message) => ({
        ...(message as SharedInboxSelectedConversation["messages"][number]),
        createdAt: new Date(message.createdAt || Date.now()),
      }))
      .sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return diff !== 0 ? diff : left.id.localeCompare(right.id);
      }),
  };
}

export function warmConversationCache(chatKey: string) {
  const normalizedChatKey = chatKey.trim();
  if (!normalizedChatKey || readConversationFromCache(normalizedChatKey) || inflightWarmups.has(normalizedChatKey)) {
    return inflightWarmups.get(normalizedChatKey) ?? Promise.resolve();
  }

  const warmup = fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedChatKey)}`, {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then((response) => {
      if (!response.ok) {
        return null;
      }

      return response.json().catch(() => null) as Promise<WarmupConversationResponse | null>;
    })
    .then((payload) => {
      const conversation = normalizeSelectedConversation(payload?.conversation);
      if (!conversation) {
        return;
      }

      saveConversationToCache(conversation);
    })
    .catch(() => null)
    .finally(() => {
      inflightWarmups.delete(normalizedChatKey);
    });

  inflightWarmups.set(normalizedChatKey, warmup);
  return warmup;
}
