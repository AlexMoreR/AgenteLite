"use client";

import { useEffect, useState } from "react";
import { Loader2, UserRound } from "lucide-react";
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
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 w-[min(92%,42rem)] -translate-x-1/2">
      <div className="rounded-2xl border border-[rgba(148,163,184,0.14)] bg-white/92 px-4 py-3 shadow-[0_12px_34px_-24px_rgba(15,23,42,0.24)] backdrop-blur">
        <div className="flex items-center gap-3">
          {pendingConversation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pendingConversation.avatarUrl}
              alt={pendingConversation.label}
              className="h-9 w-9 rounded-2xl object-cover"
            />
          ) : (
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <UserRound className="h-4.5 w-4.5" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-950">{pendingConversation.label}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Cargando
              </span>
            </div>
            <p className="truncate text-xs text-slate-500">{pendingConversation.secondaryLabel}</p>
          </div>
        </div>
        {pendingConversation.lastMessage ? (
          <p className="mt-2 line-clamp-1 text-xs text-slate-500">
            Ultimo mensaje: {pendingConversation.lastMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
