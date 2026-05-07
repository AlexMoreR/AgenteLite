"use client";

import { Loader2 } from "lucide-react";
import { usePendingConversationSelection } from "./chat-selection-store";
import { readConversationFromCache } from "./chat-history-cache";

type ChatSelectionOverlayProps = {
  selectedConversationId: string;
};

export function ChatSelectionOverlay({ selectedConversationId }: ChatSelectionOverlayProps) {
  const pendingConversation = usePendingConversationSelection();
  const cachedConversation =
    pendingConversation &&
    (pendingConversation.hasCache ||
      Boolean(readConversationFromCache(pendingConversation.cacheKey || pendingConversation.id)));

  if (!pendingConversation || pendingConversation.id === selectedConversationId || cachedConversation) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 w-[min(92%,18rem)] -translate-x-1/2">
      <div className="inline-flex w-full items-center justify-center rounded-full border border-[rgba(148,163,184,0.16)] bg-white/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.25)] backdrop-blur">
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-[var(--primary)]" />
        Historial
      </div>
    </div>
  );
}
