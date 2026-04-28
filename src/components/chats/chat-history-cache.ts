"use client";

import type { SharedInboxMessageItem, SharedInboxSelectedConversation } from "./shared-inbox";

type CachedMessageItem = Omit<SharedInboxMessageItem, "createdAt"> & {
  createdAt: string;
};

type CachedConversation = Omit<SharedInboxSelectedConversation, "messages"> & {
  messages: CachedMessageItem[];
  cachedAt: number;
};

type ConversationCacheStore = {
  version: 1;
  conversations: Record<string, CachedConversation>;
};

const STORAGE_KEY = "aglite:chat-history-cache:v1";
const MAX_CACHE_ENTRIES = 20;

function isBrowser() {
  return typeof window !== "undefined";
}

function readStore(): ConversationCacheStore {
  if (!isBrowser()) {
    return { version: 1, conversations: {} };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: 1, conversations: {} };
    }

    const parsed = JSON.parse(raw) as ConversationCacheStore | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.conversations !== "object" || parsed.conversations === null) {
      return { version: 1, conversations: {} };
    }

    return parsed;
  } catch {
    return { version: 1, conversations: {} };
  }
}

function writeStore(store: ConversationCacheStore) {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

function trimStore(store: ConversationCacheStore) {
  const entries = Object.entries(store.conversations);
  if (entries.length <= MAX_CACHE_ENTRIES) {
    return store;
  }

  const sorted = entries.sort((left, right) => right[1].cachedAt - left[1].cachedAt).slice(0, MAX_CACHE_ENTRIES);
  return {
    version: 1 as const,
    conversations: Object.fromEntries(sorted),
  };
}

function serializeConversation(conversation: SharedInboxSelectedConversation): CachedConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
    cachedAt: Date.now(),
  };
}

function mergeCachedConversations(existing: CachedConversation | null, next: CachedConversation): CachedConversation {
  if (!existing) {
    return next;
  }

  const messages = new Map<string, CachedMessageItem>();

  for (const message of existing.messages) {
    messages.set(message.id, message);
  }

  for (const message of next.messages) {
    messages.set(message.id, message);
  }

  return {
    ...existing,
    ...next,
    messages: Array.from(messages.values()).sort((left, right) => {
      const leftAt = new Date(left.createdAt).getTime();
      const rightAt = new Date(right.createdAt).getTime();

      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }

      return left.id.localeCompare(right.id);
    }),
    cachedAt: Date.now(),
  };
}

function hydrateConversation(conversation: CachedConversation): SharedInboxSelectedConversation {
  return {
    id: conversation.id,
    label: conversation.label,
    secondaryLabel: conversation.secondaryLabel,
    tags: conversation.tags,
    avatarUrl: conversation.avatarUrl ?? null,
    automationPaused: conversation.automationPaused,
    loadMoreCursor: conversation.loadMoreCursor ?? null,
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
    })),
  };
}

export function saveConversationToCache(conversation: SharedInboxSelectedConversation) {
  const store = readStore();
  const cachedConversation = serializeConversation(conversation);
  const existingConversation = store.conversations[conversation.id] ?? (conversation.cacheKey ? store.conversations[conversation.cacheKey] : null) ?? null;
  const mergedConversation = mergeCachedConversations(existingConversation, cachedConversation);

  store.conversations[conversation.id] = mergedConversation;

  if (conversation.cacheKey && conversation.cacheKey !== conversation.id) {
    store.conversations[conversation.cacheKey] = mergedConversation;
  }
  writeStore(trimStore(store));
}

export function readConversationFromCache(conversationId: string) {
  if (!conversationId) {
    return null;
  }

  const store = readStore();
  const cached = store.conversations[conversationId] ?? store.conversations[conversationId.split(":").slice(1).join(":")] ?? null;
  return cached ? hydrateConversation(cached) : null;
}

export function clearConversationCache() {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures so cache cleanup never breaks the UI.
  }
}
