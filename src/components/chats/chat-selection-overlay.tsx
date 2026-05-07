"use client";

import { useEffect, useState } from "react";
import { MessageSquareText, UserRound } from "lucide-react";
import { readConversationFromCache } from "./chat-history-cache";

type PendingConversationSelection = {
  id: string;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  lastMessage?: string | null;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
  cacheKey?: string | null;
  hasCache?: boolean;
};

type ChatSelectionOverlayProps = {
  selectedConversationId: string;
};

const EVENT_NAME = "chat-selection-pending";

export function ChatSelectionOverlay({ selectedConversationId }: ChatSelectionOverlayProps) {
  const [pendingConversation, setPendingConversation] = useState<PendingConversationSelection | null>(null);
  const cachedConversation =
    pendingConversation &&
    (pendingConversation.hasCache ||
      Boolean(readConversationFromCache(pendingConversation.cacheKey || pendingConversation.id)));

  useEffect(() => {
    function handlePendingSelection(event: Event) {
      const customEvent = event as CustomEvent<PendingConversationSelection>;
      const nextConversation = customEvent.detail;
      if (nextConversation?.id) {
        setPendingConversation(nextConversation);
      }
    }

    window.addEventListener(EVENT_NAME, handlePendingSelection as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handlePendingSelection as EventListener);
  }, []);

  if (!pendingConversation || pendingConversation.id === selectedConversationId || cachedConversation) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 z-30 w-[min(92%,42rem)] -translate-x-1/2 md:bottom-24">
      <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white/96 px-4 py-3 shadow-[0_14px_36px_-26px_rgba(15,23,42,0.26)] backdrop-blur">
        <div className="flex items-center gap-3">
          {pendingConversation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pendingConversation.avatarUrl}
              alt={pendingConversation.label}
              className="h-9 w-9 rounded-2xl object-cover"
            />
          ) : (
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <UserRound className="h-4.5 w-4.5" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-950">{pendingConversation.label}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--primary)]">
                <MessageSquareText className="h-3 w-3" />
                Historial
              </span>
            </div>
            <p className="truncate text-xs text-slate-500">{pendingConversation.secondaryLabel}</p>
          </div>
        </div>
        {pendingConversation.lastMessage ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]/60" />
            <p className="line-clamp-1">
              {pendingConversation.lastMessage}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
