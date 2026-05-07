"use client";

import { useSyncExternalStore } from "react";
import type { SharedInboxConversationItem } from "./shared-inbox";

export type PendingChatSelection = {
  id: string;
  chatKey?: string | null;
  source?: "agent" | "official";
  agentId?: string | null;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  lastMessage?: string | null;
  lastMessageType?: SharedInboxConversationItem["lastMessageType"] | null;
  lastMessageDirection?: SharedInboxConversationItem["lastMessageDirection"] | null;
  lastMessageAt?: string | Date | null;
  channelType?: SharedInboxConversationItem["channelType"];
  cacheKey?: string | null;
  phoneNumber?: string | null;
  hasCache?: boolean;
};

type Listener = () => void;

let pendingSelection: PendingChatSelection | null = null;
const listeners = new Set<Listener>();

function areSelectionsEqual(left: PendingChatSelection | null, right: PendingChatSelection | null) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.chatKey === right.chatKey &&
    left.source === right.source &&
    left.agentId === right.agentId &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.lastMessage === right.lastMessage &&
    left.lastMessageType === right.lastMessageType &&
    left.lastMessageDirection === right.lastMessageDirection &&
    left.lastMessageAt === right.lastMessageAt &&
    left.channelType === right.channelType &&
    left.cacheKey === right.cacheKey &&
    left.phoneNumber === right.phoneNumber &&
    left.hasCache === right.hasCache
  );
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setPendingConversationSelection(nextSelection: PendingChatSelection | null) {
  if (areSelectionsEqual(pendingSelection, nextSelection)) {
    return;
  }

  pendingSelection = nextSelection;
  notify();
}

export function clearPendingConversationSelection() {
  if (pendingSelection === null) {
    return;
  }

  pendingSelection = null;
  notify();
}

export function getPendingConversationSelection() {
  return pendingSelection;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingConversationSelection() {
  return useSyncExternalStore(subscribe, getPendingConversationSelection, () => null);
}
