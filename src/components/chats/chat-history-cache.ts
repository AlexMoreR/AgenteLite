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
const VISITED_STORAGE_KEY = "aglite:chat-visited:v1";
const MAX_CACHE_ENTRIES = 20;
const MAX_VISITED_ENTRIES = 200;
const CACHE_SAVE_DEBOUNCE_MS = 120;

const pendingConversationSaves = new Map<string, SharedInboxSelectedConversation>();
let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

function readVisitedStore(): Record<string, number> {
  if (!isBrowser()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(VISITED_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, number> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeVisitedStore(store: Record<string, number>) {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

function trimVisitedStore(store: Record<string, number>) {
  const entries = Object.entries(store);
  if (entries.length <= MAX_VISITED_ENTRIES) {
    return store;
  }

  const sorted = entries.sort((left, right) => right[1] - left[1]).slice(0, MAX_VISITED_ENTRIES);
  return Object.fromEntries(sorted);
}

function normalizeVisitedKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function normalizeConversationCacheKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

export function markConversationAsVisited(conversationId: string) {
  const normalizedConversationId = normalizeVisitedKey(conversationId);
  if (!normalizedConversationId) {
    return;
  }

  const store = readVisitedStore();
  store[normalizedConversationId] = Date.now();
  writeVisitedStore(trimVisitedStore(store));
}

export function hasConversationBeenVisited(conversationId: string) {
  const normalizedConversationId = normalizeVisitedKey(conversationId);
  if (!normalizedConversationId) {
    return false;
  }

  const store = readVisitedStore();
  return normalizedConversationId in store;
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

function normalizeConversationStoreKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function mergeCachedMessages(existing: CachedMessageItem[] | SharedInboxSelectedConversation["messages"], next: CachedMessageItem[] | SharedInboxSelectedConversation["messages"]) {
  const messages = new Map<string, CachedMessageItem>();

  for (const message of existing) {
    messages.set(message.id, {
      ...message,
      createdAt: typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    });
  }

  for (const message of next) {
    messages.set(message.id, {
      ...message,
      createdAt: typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    });
  }

  return Array.from(messages.values()).sort((left, right) => {
    const leftAt = new Date(left.createdAt).getTime();
    const rightAt = new Date(right.createdAt).getTime();

    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }

    return left.id.localeCompare(right.id);
  });
}

export function mergeConversationSnapshots(
  existing: SharedInboxSelectedConversation | null,
  next: SharedInboxSelectedConversation | null,
) {
  if (!existing) {
    return next;
  }

  if (!next) {
    return existing;
  }

  return {
    ...existing,
    ...next,
    messages: mergeCachedMessages(existing.messages, next.messages).map((message) => ({
      ...message,
      createdAt: typeof message.createdAt === "string" ? new Date(message.createdAt) : message.createdAt,
    })),
  };
}

function mergeCachedConversations(existing: CachedConversation | null, next: CachedConversation): CachedConversation {
  if (!existing) {
    return next;
  }

  return {
    ...existing,
    ...next,
    messages: mergeCachedMessages(existing.messages, next.messages),
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
    loadMoreHref: conversation.loadMoreHref ?? null,
    loadMoreCursor: conversation.loadMoreCursor ?? null,
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
    })),
  };
}

export function saveConversationToCache(conversation: SharedInboxSelectedConversation) {
  if (!isBrowser()) {
    return;
  }

  const cacheKey = normalizeConversationStoreKey(conversation.cacheKey ?? "");
  const conversationKey = normalizeConversationStoreKey(conversation.id);
  if (!conversationKey) {
    return;
  }

  pendingConversationSaves.set(conversationKey, conversation);
  if (cacheKey && cacheKey !== conversationKey) {
    pendingConversationSaves.set(cacheKey, conversation);
  }

  if (pendingSaveTimer !== null) {
    window.clearTimeout(pendingSaveTimer);
  }

  pendingSaveTimer = window.setTimeout(() => {
    pendingSaveTimer = null;

    if (pendingConversationSaves.size === 0) {
      return;
    }

    const store = readStore();
    const visitedStore = readVisitedStore();

    for (const pendingConversation of pendingConversationSaves.values()) {
      const cachedConversation = serializeConversation(pendingConversation);
      const existingConversation =
        store.conversations[pendingConversation.id] ??
        (pendingConversation.cacheKey ? store.conversations[pendingConversation.cacheKey] : null) ??
        null;
      const mergedConversation = mergeCachedConversations(existingConversation, cachedConversation);

      store.conversations[pendingConversation.id] = mergedConversation;
      visitedStore[normalizeConversationStoreKey(pendingConversation.id)] = Date.now();

      if (pendingConversation.cacheKey && pendingConversation.cacheKey !== pendingConversation.id) {
        store.conversations[pendingConversation.cacheKey] = mergedConversation;
        visitedStore[normalizeConversationStoreKey(pendingConversation.cacheKey)] = Date.now();
      }
    }

    pendingConversationSaves.clear();
    writeStore(trimStore(store));
    writeVisitedStore(trimVisitedStore(visitedStore));
  }, CACHE_SAVE_DEBOUNCE_MS);
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

  pendingConversationSaves.clear();
  if (pendingSaveTimer !== null) {
    window.clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures so cache cleanup never breaks the UI.
  }
}

export function clearConversationFromCache(conversationId: string) {
  if (!isBrowser()) {
    return;
  }

  const normalizedConversationId = normalizeConversationCacheKey(conversationId);
  if (!normalizedConversationId) {
    return;
  }

  pendingConversationSaves.delete(normalizedConversationId);
  pendingConversationSaves.delete(`agent:${normalizedConversationId}`);
  pendingConversationSaves.delete(`official:${normalizedConversationId}`);

  try {
    const store = readStore();
    const nextConversations: Record<string, CachedConversation> = {};

    for (const [key, conversation] of Object.entries(store.conversations)) {
      const normalizedKey = normalizeConversationCacheKey(key);
      const normalizedStoredId = normalizeConversationCacheKey(conversation.id);
      const normalizedCacheKey = conversation.cacheKey ? normalizeConversationCacheKey(conversation.cacheKey) : "";

      if (
        normalizedKey === normalizedConversationId ||
        normalizedStoredId === normalizedConversationId ||
        normalizedCacheKey === normalizedConversationId
      ) {
        continue;
      }

      nextConversations[key] = conversation;
    }

    writeStore({
      version: 1,
      conversations: nextConversations,
    });

    const visitedStore = readVisitedStore();
    delete visitedStore[normalizedConversationId];
    delete visitedStore[`agent:${normalizedConversationId}`];
    delete visitedStore[`official:${normalizedConversationId}`];
    writeVisitedStore(visitedStore);
  } catch {
    // Ignore storage failures so cache cleanup never breaks the UI.
  }
}
