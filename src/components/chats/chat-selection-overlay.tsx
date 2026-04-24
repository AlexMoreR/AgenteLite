"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageSquareText, UserRound } from "lucide-react";

type PendingConversationSelection = {
  id: string;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  lastMessage?: string | null;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
};

type ChatSelectionOverlayProps = {
  selectedConversationId: string;
};

const EVENT_NAME = "chat-selection-pending";

export function ChatSelectionOverlay({ selectedConversationId }: ChatSelectionOverlayProps) {
  const [pendingConversation, setPendingConversation] = useState<PendingConversationSelection | null>(null);

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

  if (!pendingConversation || pendingConversation.id === selectedConversationId) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[rgba(248,250,252,0.84)] backdrop-blur-[2px]">
      <div className="border-b border-[rgba(148,163,184,0.14)] bg-white/90 px-3 py-3 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.2)]">
        <div className="flex items-center gap-3">
          {pendingConversation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pendingConversation.avatarUrl}
              alt={pendingConversation.label}
              className="h-10 w-10 rounded-2xl object-cover"
            />
          ) : (
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <UserRound className="h-5 w-5" />
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
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-[22px] border border-[rgba(148,163,184,0.16)] bg-white/95 p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.35)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-slate-900">Preparando la conversación</p>
              <p className="text-sm leading-6 text-slate-600">
                Estamos cargando el historial del chat para que puedas responder sin esperar a que toda la bandeja se recargue.
              </p>
              <div className="space-y-2 pt-2">
                <div className="h-3.5 w-full animate-pulse rounded-full bg-slate-100" />
                <div className="h-3.5 w-5/6 animate-pulse rounded-full bg-slate-100" />
                <div className="h-3.5 w-4/6 animate-pulse rounded-full bg-slate-100" />
              </div>
            </div>
          </div>

          {pendingConversation.lastMessage ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Ultimo mensaje</p>
              <p className="text-sm leading-6 text-slate-700">{pendingConversation.lastMessage}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
