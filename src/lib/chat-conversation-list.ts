type ConversationListRowLike = {
  source: "agent" | "official";
  conversationId: string;
  channelId?: string | null;
  contactId?: string | null;
  lastMessageAt?: Date | null;
};

function getConversationListRowTimestamp(value: Date | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getConversationListRowDedupKey(row: ConversationListRowLike) {
  if (row.source === "agent" && row.channelId && row.contactId) {
    return `agent:${row.channelId}:${row.contactId}`;
  }

  return `${row.source}:${row.conversationId}`;
}

export function dedupeConversationListRows<T extends ConversationListRowLike>(rows: T[]) {
  const rowsByKey = new Map<string, T>();

  for (const row of rows) {
    const key = getConversationListRowDedupKey(row);
    const current = rowsByKey.get(key);

    if (!current) {
      rowsByKey.set(key, row);
      continue;
    }

    const currentTimestamp = getConversationListRowTimestamp(current.lastMessageAt);
    const nextTimestamp = getConversationListRowTimestamp(row.lastMessageAt);
    if (nextTimestamp >= currentTimestamp) {
      rowsByKey.set(key, row);
    }
  }

  return Array.from(rowsByKey.values());
}

export function sortConversationListRows<T extends ConversationListRowLike>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftAt = getConversationListRowTimestamp(left.lastMessageAt);
    const rightAt = getConversationListRowTimestamp(right.lastMessageAt);
    return rightAt - leftAt;
  });
}

export function dedupeAndSortConversationListRows<T extends ConversationListRowLike>(rows: T[]) {
  return sortConversationListRows(dedupeConversationListRows(rows));
}
