import type {
  AssignedFilter,
  StatusFilter,
  LiveConversationListSnapshot,
  LiveConversationSnapshot,
  SharedInboxConversationItem,
  SharedInboxConversationItemLike,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";
import { getMessagePreviewText } from "./chat-inbox-format";
import { mergeConversationSnapshots } from "./chat-history-cache";

export function normalizeLiveConversationSnapshot(value: unknown): LiveConversationSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    messages?: Array<{ createdAt?: string | Date; editedAt?: string | Date | null; deletedAt?: string | Date | null } & Record<string, unknown>>;
  };

  if (typeof data.id !== "string" || !Array.isArray(data.messages)) {
    return null;
  }

  return {
    ...(value as SharedInboxSelectedConversation),
    id: data.id,
    // Normalizar a ASC (oldest-first) para que la conversación siga el orden natural.
    messages: data.messages
      .map((message) => ({
        ...(message as SharedInboxMessageItem),
        createdAt: new Date(message.createdAt || Date.now()),
        editedAt: message.editedAt ? new Date(message.editedAt) : null,
        deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
      }))
      .sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }),
  };
}

export function normalizeLiveConversationListSnapshot(value: unknown): LiveConversationListSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    lastMessageAt?: string | Date | null;
  };

  if (typeof data.id !== "string") {
    return null;
  }

  return {
    ...(value as SharedInboxConversationItem),
    id: data.id,
    lastMessageAt: data.lastMessageAt ? new Date(data.lastMessageAt) : null,
  };
}

export function getConversationLastMessageTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function normalizeConversationItem(item: SharedInboxConversationItemLike, fallbackHref = ""): SharedInboxConversationItem {
  const resolvedId =
    typeof item.id === "string" && item.id.trim()
      ? item.id
      : typeof item.key === "string" && item.key.trim()
        ? item.key
        : typeof item.conversationId === "string" && item.conversationId.trim()
          ? item.conversationId
          : "";
  const lastMessageAt = item.lastMessageAt ? new Date(item.lastMessageAt) : null;
  return {
    ...item,
    id: resolvedId,
    source: item.source === "official" ? "official" : "agent",
    label: item.label ?? "",
    secondaryLabel: item.secondaryLabel ?? "",
    lastMessage: item.lastMessage ?? null,
    href: item.href?.trim() || fallbackHref,
    lastMessageAt: lastMessageAt && Number.isFinite(lastMessageAt.getTime()) ? lastMessageAt : null,
  };
}

export function normalizeConversationItems(
  items: SharedInboxConversationItemLike[],
  fallbackHrefFactory: (item: SharedInboxConversationItemLike) => string = () => "",
): SharedInboxConversationItem[] {
  return items.map((item) => normalizeConversationItem(item, fallbackHrefFactory(item)));
}

export function buildConversationItemHrefFromParams(
  searchAction: string,
  selectedConnectionKey: string,
  searchQuery: string,
  conversation: SharedInboxConversationItemLike,
  assignedFilter: AssignedFilter = "all",
  statusFilter: StatusFilter = "open",
) {
  const chatKey =
    (typeof conversation.id === "string" && conversation.id.trim()) ||
    (typeof conversation.key === "string" && conversation.key.trim()) ||
    (typeof conversation.conversationId === "string" && conversation.conversationId.trim()) ||
    "";

  if (!chatKey) {
    return "";
  }

  const params = new URLSearchParams();
  params.set("chatKey", chatKey);
  if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  if (assignedFilter !== "all") params.set("assigned", assignedFilter);
  if (statusFilter !== "open") params.set("status", statusFilter);
  const qs = params.toString();
  return qs ? `${searchAction}?${qs}` : searchAction;
}

export function extractConversationIdFromKey(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

export function conversationIdMatchesKey(key: string, conversationId: string) {
  const normalizedKey = key.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedKey || !normalizedConversationId) {
    return false;
  }

  if (normalizedKey === normalizedConversationId) {
    return true;
  }

  return extractConversationIdFromKey(normalizedKey) === normalizedConversationId;
}

export function findConversationItemBySnapshotId(
  items: SharedInboxConversationItem[],
  snapshotId: string,
  source?: SharedInboxConversationItem["channelType"],
) {
  const normalizedSnapshotId = snapshotId.trim();
  if (!normalizedSnapshotId) {
    return null;
  }

  return (
    items.find((item) => conversationIdMatchesKey(item.id, normalizedSnapshotId)) ??
    (source === "whatsapp_official"
      ? items.find((item) => item.id === normalizedSnapshotId)
      : null)
  );
}

export function buildConversationItemFromSnapshot(
  snapshot: LiveConversationSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  const latestMessage = snapshot.messages.at(-1) ?? null;
  const nextItem: SharedInboxConversationItem = {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? "agent",
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    label: snapshot.label ?? existing?.label ?? snapshot.id,
    secondaryLabel: snapshot.secondaryLabel ?? existing?.secondaryLabel ?? "",
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: existing?.channelType,
    assignedToName: existing?.assignedToName ?? null,
    // Esta funcion solo actualiza la conversacion abierta: el usuario la esta viendo,
    // asi que no hay mensajes sin leer.
    incomingCount: 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: latestMessage ? getMessagePreviewText(latestMessage) : existing?.lastMessage ?? null,
    lastMessageType: latestMessage?.type ?? existing?.lastMessageType ?? null,
    lastMessageDirection: latestMessage?.direction ?? existing?.lastMessageDirection ?? null,
    lastMessageAt: latestMessage?.createdAt ?? existing?.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };

  return nextItem;
}

export function buildConversationItemFromListSnapshot(
  snapshot: LiveConversationListSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  const lastMessage = snapshot.lastMessage?.trim() || null;
  const isMediaPreviewType =
    snapshot.lastMessageType === "AUDIO" ||
    snapshot.lastMessageType === "IMAGE" ||
    snapshot.lastMessageType === "VIDEO" ||
    snapshot.lastMessageType === "STICKER" ||
    snapshot.lastMessageType === "DOCUMENT";

  return {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? (snapshot.channelType === "whatsapp_official" ? "official" : "agent"),
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    label: snapshot.label ?? existing?.label ?? snapshot.id,
    secondaryLabel: snapshot.secondaryLabel ?? existing?.secondaryLabel ?? "",
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: snapshot.channelType ?? existing?.channelType,
    assignedToName: snapshot.assignedToName ?? existing?.assignedToName ?? null,
    incomingCount: snapshot.incomingCount ?? existing?.incomingCount ?? 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: lastMessage || (isMediaPreviewType ? null : existing?.lastMessage ?? null),
    lastMessageType: snapshot.lastMessageType ?? existing?.lastMessageType ?? null,
    lastMessageDirection: snapshot.lastMessageDirection ?? existing?.lastMessageDirection ?? null,
    // No usar existing como fallback para lastMessageAt: si el snapshot trae null pero existing
    // tiene una fecha vieja, el item quedaría anclado en su posición anterior en el sort.
    lastMessageAt: snapshot.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };
}

export function sortConversationItems(items: SharedInboxConversationItem[]) {
  return [...items].sort((left, right) => {
    const leftAt = getConversationLastMessageTimestamp(left.lastMessageAt);
    const rightAt = getConversationLastMessageTimestamp(right.lastMessageAt);
    return rightAt - leftAt;
  });
}

export function insertConversationItemByTimestamp(
  items: SharedInboxConversationItem[],
  item: SharedInboxConversationItem,
) {
  const itemAt = getConversationLastMessageTimestamp(item.lastMessageAt);
  let insertIndex = 0;

  while (insertIndex < items.length && getConversationLastMessageTimestamp(items[insertIndex]?.lastMessageAt) > itemAt) {
    insertIndex += 1;
  }

  return [
    ...items.slice(0, insertIndex),
    item,
    ...items.slice(insertIndex),
  ];
}

export function updateConversationItemInSortedList(
  current: SharedInboxConversationItem[],
  snapshotId: string,
  nextItem: SharedInboxConversationItem,
) {
  const currentIndex = current.findIndex((item) => conversationIdMatchesKey(item.id, snapshotId));
  if (currentIndex === -1) {
    const nextItems = insertConversationItemByTimestamp(current, nextItem);
    return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
      ? current
      : nextItems;
  }

  const currentItem = current[currentIndex];
  if (areConversationListItemsEqual(currentItem, nextItem)) {
    return current;
  }

  const currentAt = getConversationLastMessageTimestamp(currentItem.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(nextItem.lastMessageAt);

  if (currentAt === nextAt) {
    const nextItems = [...current];
    nextItems[currentIndex] = nextItem;
    return nextItems;
  }

  const withoutCurrent = current.filter((_, index) => index !== currentIndex);
  const nextItems = insertConversationItemByTimestamp(withoutCurrent, nextItem);

  return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
    ? current
    : nextItems;
}

export function mergeConversationListItem(
  next: SharedInboxConversationItem,
  existing?: SharedInboxConversationItem | null,
) {
  if (!existing) {
    return next;
  }

  const existingAt = getConversationLastMessageTimestamp(existing.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(next.lastMessageAt);

  if (existingAt <= nextAt) {
    return next;
  }

  return {
    ...next,
    incomingCount: Math.max(existing.incomingCount ?? 0, next.incomingCount ?? 0),
    // Si ya tenemos una versión más reciente del preview en memoria, debemos
    // conservarla completa para no mezclar contenido viejo con timestamps nuevos.
    lastMessage: existing.lastMessage ?? next.lastMessage ?? null,
    lastMessageType: existing.lastMessageType ?? next.lastMessageType ?? null,
    lastMessageDirection: existing.lastMessageDirection ?? next.lastMessageDirection ?? null,
    lastMessageAt: existing.lastMessageAt ?? next.lastMessageAt ?? null,
  };
}

export function areTagListsEqual(
  left: SharedInboxConversationItem["tags"],
  right: SharedInboxConversationItem["tags"],
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

export function areConversationListItemsEqual(
  left: SharedInboxConversationItem,
  right: SharedInboxConversationItem,
) {
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.agentId === right.agentId &&
    left.contactId === right.contactId &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.assignedToName === right.assignedToName &&
    left.lastMessage === right.lastMessage &&
    left.lastMessageType === right.lastMessageType &&
    left.lastMessageDirection === right.lastMessageDirection &&
    getConversationLastMessageTimestamp(left.lastMessageAt) === getConversationLastMessageTimestamp(right.lastMessageAt) &&
    left.incomingCount === right.incomingCount &&
    left.channelType === right.channelType &&
    left.href === right.href &&
    areTagListsEqual(left.tags ?? [], right.tags ?? [])
  );
}

export function areMessageItemsEqual(
  left: SharedInboxMessageItem,
  right: SharedInboxMessageItem,
) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    left.rawPayload === right.rawPayload &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    (left.editedAt?.getTime() ?? 0) === (right.editedAt?.getTime() ?? 0) &&
    (left.deletedAt?.getTime() ?? 0) === (right.deletedAt?.getTime() ?? 0)
  );
}

export function areSelectedConversationsEqual(
  left: SharedInboxSelectedConversation,
  right: SharedInboxSelectedConversation,
) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.contactId === right.contactId &&
    left.contactName === right.contactName &&
    left.avatarUrl === right.avatarUrl &&
    left.automationPaused === right.automationPaused &&
    left.loadMoreHref === right.loadMoreHref &&
    left.loadMoreCursor === right.loadMoreCursor &&
    left.hasMoreMessages === right.hasMoreMessages &&
    left.cacheKey === right.cacheKey &&
    left.isPreview === right.isPreview &&
    areTagListsEqual(left.tags ?? [], right.tags ?? []) &&
    left.messages.length === right.messages.length &&
    left.messages.every((message, index) => areMessageItemsEqual(message, right.messages[index]!))
  );
}

export function mergeConversationSnapshotIfChanged(
  existing: SharedInboxSelectedConversation | null,
  next: SharedInboxSelectedConversation | null,
) {
  const merged = mergeConversationSnapshots(existing, next);
  if (!existing || !merged) {
    return merged;
  }

  return areSelectedConversationsEqual(existing, merged) ? existing : merged;
}

export function updateConversationItemByContact(
  current: SharedInboxConversationItem[],
  contactId: string,
  updater: (item: SharedInboxConversationItem) => SharedInboxConversationItem,
) {
  let changed = false;
  const nextItems = current.map((item) => {
    if (item.contactId !== contactId) {
      return item;
    }

    changed = true;
    return updater(item);
  });

  return changed ? nextItems : current;
}
