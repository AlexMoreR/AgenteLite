"use client";

import type { SharedInboxMessageItem, SharedInboxSelectedConversation } from "./shared-inbox";

type CachedMessageItem = Omit<SharedInboxMessageItem, "createdAt" | "editedAt" | "deletedAt"> & {
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
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
let pendingSaveTimer: number | null = null;
let cachedStore: ConversationCacheStore | null = null;
let cachedVisitedStore: Record<string, number> | null = null;
let storageListenerAttached = false;

function isBrowser() {
  return typeof window !== "undefined";
}

function invalidateCaches(event?: StorageEvent) {
  if (event && event.key && event.key !== STORAGE_KEY && event.key !== VISITED_STORAGE_KEY) {
    return;
  }

  cachedStore = null;
  cachedVisitedStore = null;
}

function ensureStorageListeners() {
  if (!isBrowser() || storageListenerAttached) {
    return;
  }

  window.addEventListener("storage", invalidateCaches);
  storageListenerAttached = true;
}

function readStore(): ConversationCacheStore {
  ensureStorageListeners();

  if (cachedStore) {
    return cachedStore;
  }

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

    cachedStore = parsed;
    return parsed;
  } catch {
    return { version: 1, conversations: {} };
  }
}

function writeStore(store: ConversationCacheStore) {
  cachedStore = store;

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
  ensureStorageListeners();

  if (cachedVisitedStore) {
    return cachedVisitedStore;
  }

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

    cachedVisitedStore = parsed;
    return parsed;
  } catch {
    return {};
  }
}

function writeVisitedStore(store: Record<string, number>) {
  cachedVisitedStore = store;

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

function normalizeSerializableDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.toISOString();
}

function serializeConversation(conversation: SharedInboxSelectedConversation): CachedConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: normalizeSerializableDate(message.createdAt) ?? new Date().toISOString(),
      editedAt: normalizeSerializableDate(message.editedAt),
      deletedAt: normalizeSerializableDate(message.deletedAt),
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

function getMessageCreatedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  return typeof message.createdAt === "string" ? new Date(message.createdAt).getTime() : message.createdAt.getTime();
}

function toCachedMessageItem(
  message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
): CachedMessageItem {
  return {
    ...message,
    createdAt: typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    editedAt:
      "editedAt" in message && message.editedAt
        ? typeof message.editedAt === "string"
          ? message.editedAt
          : message.editedAt.toISOString()
        : null,
    deletedAt:
      "deletedAt" in message && message.deletedAt
        ? typeof message.deletedAt === "string"
          ? message.deletedAt
          : message.deletedAt.toISOString()
        : null,
  };
}

function areCachedTagListsEqual(
  left: SharedInboxSelectedConversation["tags"],
  right: SharedInboxSelectedConversation["tags"],
) {
  if (left === right) {
    return true;
  }

  if ((left?.length ?? 0) !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < (left?.length ?? 0); index += 1) {
    const leftTag = left?.[index];
    const rightTag = right?.[index];

    if (!leftTag || !rightTag || leftTag.label !== rightTag.label || leftTag.color !== rightTag.color) {
      return false;
    }
  }

  return true;
}

function getMessageEditedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  if (!("editedAt" in message) || !message.editedAt) {
    return null;
  }

  return typeof message.editedAt === "string" ? new Date(message.editedAt).getTime() : message.editedAt.getTime();
}

function getMessageDeletedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  if (!("deletedAt" in message) || !message.deletedAt) {
    return null;
  }

  return typeof message.deletedAt === "string" ? new Date(message.deletedAt).getTime() : message.deletedAt.getTime();
}

function areMergedMessagesEqual(
  left: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
  right: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    getMessageCreatedAtTime(left) === getMessageCreatedAtTime(right) &&
    getMessageEditedAtTime(left) === getMessageEditedAtTime(right) &&
    getMessageDeletedAtTime(left) === getMessageDeletedAtTime(right)
  );
}

function areCachedMessagesEqual(left: CachedMessageItem, right: CachedMessageItem) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    left.createdAt === right.createdAt &&
    left.editedAt === right.editedAt &&
    left.deletedAt === right.deletedAt
  );
}

function areCachedConversationsEqual(left: CachedConversation, right: CachedConversation) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.contactId === right.contactId &&
    left.contactName === right.contactName &&
    left.automationPaused === right.automationPaused &&
    left.loadMoreHref === right.loadMoreHref &&
    left.loadMoreCursor === right.loadMoreCursor &&
    left.hasMoreMessages === right.hasMoreMessages &&
    left.cacheKey === right.cacheKey &&
    left.isPreview === right.isPreview &&
    areCachedTagListsEqual(left.tags, right.tags) &&
    left.messages.length === right.messages.length &&
    left.messages.every((message, index) => areCachedMessagesEqual(message, right.messages[index]!))
  );
}

function mergeCachedMessages(
  existing: CachedMessageItem[] | SharedInboxSelectedConversation["messages"],
  next: CachedMessageItem[] | SharedInboxSelectedConversation["messages"],
) {
  const messages = new Map<string, CachedMessageItem>();

  for (const message of existing) {
    messages.set(message.id, toCachedMessageItem(message));
  }

  for (const message of next) {
    const existingMessage = messages.get(message.id);
    if (existingMessage && areMergedMessagesEqual(existingMessage, message)) {
      continue;
    }

    messages.set(message.id, toCachedMessageItem(message));
  }

  return Array.from(messages.values()).sort((left, right) => {
    const leftAt = getMessageCreatedAtTime(left);
    const rightAt = getMessageCreatedAtTime(right);

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

  if (existing.isPreview && !next.isPreview) {
    return next;
  }

  if (next.isPreview && !existing.isPreview) {
    return existing;
  }

  const nextMessagesById = new Map(next.messages.map((message) => [message.id, message]));
  const mergedMessages: SharedInboxSelectedConversation["messages"] = [];

  for (const existingMessage of existing.messages) {
    const nextMessage = nextMessagesById.get(existingMessage.id);
    if (!nextMessage) {
      mergedMessages.push(existingMessage);
      continue;
    }

    if (areMergedMessagesEqual(existingMessage, nextMessage)) {
      mergedMessages.push(existingMessage);
    } else {
      mergedMessages.push(nextMessage);
    }

    nextMessagesById.delete(existingMessage.id);
  }

  for (const nextMessage of nextMessagesById.values()) {
    mergedMessages.push(nextMessage);
  }

  const mergedTags = next.tags !== undefined ? next.tags : existing.tags;

  return {
    ...existing,
    ...next,
    tags: mergedTags,
    messages: mergedMessages.sort((left, right) => {
      const leftAt = getMessageCreatedAtTime(left);
      const rightAt = getMessageCreatedAtTime(right);

      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }

      return left.id.localeCompare(right.id);
    }),
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
      editedAt: message.editedAt ? new Date(message.editedAt) : null,
      deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
    })),
    isPreview: conversation.isPreview,
  };
}

export function saveConversationToCache(conversation: SharedInboxSelectedConversation) {
  if (!isBrowser()) {
    return;
  }

  const conversationKey = normalizeConversationStoreKey(conversation.id);
  if (!conversationKey) {
    return;
  }

  pendingConversationSaves.set(conversationKey, conversation);

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
    let storeChanged = false;
    let visitedChanged = false;

    for (const pendingConversation of pendingConversationSaves.values()) {
      const cachedConversation = serializeConversation(pendingConversation);
      const existingConversation = store.conversations[pendingConversation.id] ?? null;
      const mergedConversation = mergeCachedConversations(existingConversation, cachedConversation);

      if (!existingConversation || !areCachedConversationsEqual(existingConversation, mergedConversation)) {
        store.conversations[pendingConversation.id] = mergedConversation;
        storeChanged = true;
      }

      visitedStore[normalizeConversationStoreKey(pendingConversation.id)] = Date.now();
      visitedChanged = true;

      if (pendingConversation.cacheKey && pendingConversation.cacheKey !== pendingConversation.id) {
        delete store.conversations[pendingConversation.cacheKey];
        storeChanged = true;
        visitedStore[normalizeConversationStoreKey(pendingConversation.cacheKey)] = Date.now();
        visitedChanged = true;
      }
    }

    pendingConversationSaves.clear();
    if (storeChanged) {
      writeStore(trimStore(store));
    }
    if (visitedChanged) {
      writeVisitedStore(trimVisitedStore(visitedStore));
    }
  }, CACHE_SAVE_DEBOUNCE_MS);
}

// Si la caché supera este tiempo, no la usamos para el render inicial: evita mostrar
// un "chat viejo" al recargar. La navegación entre chats la mantiene fresca (se
// reescribe en cada update), así que sigue siendo instantánea; solo se descarta la
// caché añeja de sesiones anteriores y se carga el estado actual (SSR preview + /live).
const CACHE_FRESHNESS_MS = 60_000;

export function readConversationFromCache(conversationId: string) {
  if (!conversationId) {
    return null;
  }

  const store = readStore();
  const normalizedConversationId = normalizeConversationCacheKey(conversationId);
  const cached =
    store.conversations[conversationId] ??
    store.conversations[normalizedConversationId] ??
    store.conversations[conversationId.split(":").slice(1).join(":")] ??
    null;

  if (!cached) {
    return null;
  }

  if (typeof cached.cachedAt === "number" && Date.now() - cached.cachedAt > CACHE_FRESHNESS_MS) {
    return null;
  }

  return hydrateConversation(cached);
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

  cachedStore = { version: 1, conversations: {} };
  cachedVisitedStore = {};

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
