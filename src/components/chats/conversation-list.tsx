"use client";

import { memo, useCallback, useEffect, useMemo, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, Facebook, Instagram, Mic, UserRound } from "lucide-react";
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph";
import { readConversationFromCache } from "./chat-history-cache";
import type { SharedInboxConversationItem } from "./shared-inbox";

// Instancia única compartida por todos los items — new Intl.DateTimeFormat() es costoso
// y no debería crearse dentro del render de cada fila en cada actualización.
const conversationTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
});

function renderChannelBadgeIcon(channelType?: SharedInboxConversationItem["channelType"]) {
  if (channelType === "whatsapp_official") return <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-white" />;
  if (channelType === "instagram") return <Instagram className="h-3.5 w-3.5 shrink-0 text-white" />;
  if (channelType === "facebook") return <Facebook className="h-3.5 w-3.5 shrink-0 text-white" />;
  if (channelType === "whatsapp") return <WhatsAppGlyph className="h-3.5 w-3.5 shrink-0 text-white" />;
  return null;
}

function renderIncomingCountLabel(count?: number | null) {
  if (!count || count <= 0) {
    return null;
  }

  return count > 99 ? "99+" : String(count);
}

function getConversationPreview(conversation: SharedInboxConversationItem) {
  const content = conversation.lastMessage?.trim();
  if (content) return content;
  if (conversation.lastMessageType === "AUDIO") return "Audio";
  if (conversation.lastMessageType === "IMAGE") return "Imagen";
  if (conversation.lastMessageType === "VIDEO") return "Video";
  if (conversation.lastMessageType === "DOCUMENT") return "Documento";
  return "Sin mensajes visibles aun.";
}

function renderConversationPreview(conversation: SharedInboxConversationItem) {
  if (conversation.lastMessageType === "AUDIO" && !conversation.lastMessage?.trim()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Mic className="h-3.5 w-3.5 shrink-0" />
        <span>Audio</span>
      </span>
    );
  }
  return getConversationPreview(conversation);
}

function getConversationTagBadgeStyle(color?: string | null) {
  const normalized = color?.trim();
  if (!normalized) {
    return {
      backgroundColor: "var(--primary)",
    };
  }

  if (/^(#|rgb\(|hsl\(|oklch\(|var\(|color\()/i.test(normalized)) {
    return {
      backgroundColor: normalized,
    };
  }

  return {
    backgroundColor: "var(--primary)",
  };
}

const ConversationListItem = memo(function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
  onPrefetch,
}: {
  conversation: SharedInboxConversationItem;
  isSelected: boolean;
  onSelect: (conversation: SharedInboxConversationItem) => void;
  onPrefetch: (conversation: SharedInboxConversationItem) => void;
}) {
  const incomingCountLabel = renderIncomingCountLabel(conversation.incomingCount);
  const previewText = renderConversationPreview(conversation);

  return (
    <Link
      href={conversation.href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }

        event.preventDefault();
        onSelect(conversation);
      }}
      onMouseEnter={() => onPrefetch(conversation)}
      onFocus={() => onPrefetch(conversation)}
      className={`group relative grid w-full grid-cols-[40px_minmax(0,1fr)] items-start gap-3 overflow-hidden px-3 py-2.5 transition-[background-color,box-shadow,transform] duration-200 md:grid-cols-[44px_minmax(0,1fr)] md:px-3 md:py-3 ${
        isSelected
          ? "bg-[color-mix(in_srgb,var(--primary)_6%,white)]"
          : "hover:bg-[color-mix(in_srgb,var(--primary)_4%,white)] hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)]"
        }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "96px" }}
    >
      <span
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
          isSelected ? "bg-[var(--primary)]" : "bg-transparent group-hover:bg-emerald-400/70"
        }`}
      />

      <div className="relative h-10 w-10 shrink-0 md:h-11 md:w-11">
        {conversation.avatarUrl ? (
          <Image
            src={conversation.avatarUrl}
            alt={conversation.label ?? ""}
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 rounded-2xl object-cover md:h-11 md:w-11"
          />
        ) : (
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 md:h-11 md:w-11">
            <UserRound className="h-4.5 w-4.5 md:h-5 md:w-5" />
          </div>
        )}

        {incomingCountLabel ? (
          <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2563eb] px-1 shadow-[0_1px_4px_rgba(15,23,42,0.18)]">
            <span className="text-[10px] font-semibold leading-none text-white">
              {incomingCountLabel}
            </span>
          </span>
        ) : null}

        {conversation.channelType ? (
          <span className="absolute -bottom-1 -right-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_1px_4px_rgba(15,23,42,0.18)]">
            {renderChannelBadgeIcon(conversation.channelType)}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 space-y-[1px] overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex flex-1 items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[1.12] text-slate-950 md:text-[13px]">
              {conversation.label}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-slate-500 md:text-[10px]">
            {conversation.lastMessageAt ? conversationTimeFormatter.format(conversation.lastMessageAt) : ""}
          </span>
        </div>

        <div className="mt-0.5 flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
          <p className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[1.12] text-slate-600 md:text-[13px]">
            {previewText}
          </p>
        </div>

        {conversation.tags?.length ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {conversation.tags.map((tag) => (
              <span
                key={`${conversation.id}:${tag.label}`}
                className="inline-flex max-w-full items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                style={{
                  ...getConversationTagBadgeStyle(tag.color),
                  color: "#ffffff",
                }}
                title={tag.label}
              >
                <span className="truncate">{tag.label.toUpperCase()}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
});

const ESTIMATED_ROW_HEIGHT = 96;
const VIRTUALIZATION_THRESHOLD = 36;
const OVERSCAN_ROWS = 6;

export function ConversationList({
  conversations,
  selectedConversationId,
  scrollContainerRef,
}: {
  conversations: SharedInboxConversationItem[];
  selectedConversationId: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const router = useRouter();
  const effectiveSelectedId = isPending && pendingId ? pendingId : selectedConversationId;

  const emitPendingSelection = useCallback((conversation: SharedInboxConversationItem) => {
    window.dispatchEvent(
      new CustomEvent("chat-selection-pending", {
        detail: {
          id: conversation.id,
          label: conversation.label,
          secondaryLabel: conversation.secondaryLabel,
          avatarUrl: conversation.avatarUrl ?? null,
          lastMessage: conversation.lastMessage,
          channelType: conversation.channelType,
          cacheKey: conversation.id,
          hasCache: Boolean(readConversationFromCache(conversation.id)),
        },
      }),
    );
  }, []);

  const handleSelect = useCallback((conversation: SharedInboxConversationItem) => {
    setPendingId(conversation.id);
    const cachedConversation = readConversationFromCache(conversation.id);
    if (!cachedConversation) {
      emitPendingSelection(conversation);
    }
    startTransition(() => {
      // Si ya estamos en la misma URL (conversación sin datos en Prisma aún),
      // router.push sería no-op — usar refresh() para re-ejecutar el server component.
      const currentUrl = window.location.pathname + window.location.search;
      if (conversation.href === currentUrl) {
        router.refresh();
      } else {
        router.push(conversation.href);
      }
    });
  }, [emitPendingSelection, router, startTransition]);

  const handlePrefetch = useCallback((conversation: SharedInboxConversationItem) => {
    router.prefetch(conversation.href);
  }, [router]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) {
      return;
    }

    const scrollContainer = container;

    function updateViewportMetrics() {
      setViewportHeight(scrollContainer.clientHeight);
      setScrollTop(scrollContainer.scrollTop);
    }

    updateViewportMetrics();
    scrollContainer.addEventListener("scroll", updateViewportMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(updateViewportMetrics);
    resizeObserver.observe(scrollContainer);

    return () => {
      scrollContainer.removeEventListener("scroll", updateViewportMetrics);
      resizeObserver.disconnect();
    };
  }, [scrollContainerRef]);

  const virtualizedWindow = useMemo(() => {
    if (conversations.length <= VIRTUALIZATION_THRESHOLD || viewportHeight <= 0) {
      return {
        start: 0,
        end: conversations.length,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const visibleCount = Math.ceil(viewportHeight / ESTIMATED_ROW_HEIGHT);
    const baseStart = Math.max(0, Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT) - OVERSCAN_ROWS);
    const baseEnd = Math.min(conversations.length, baseStart + visibleCount + OVERSCAN_ROWS * 2);
    const selectedIndex = conversations.findIndex((conversation) => conversation.id === effectiveSelectedId);

    if (selectedIndex >= 0 && (selectedIndex < baseStart || selectedIndex >= baseEnd)) {
      const selectedStart = Math.max(0, selectedIndex - Math.floor(visibleCount / 2));
      const selectedEnd = Math.min(conversations.length, selectedStart + visibleCount + OVERSCAN_ROWS * 2);
      return {
        start: selectedStart,
        end: selectedEnd,
        topSpacer: selectedStart * ESTIMATED_ROW_HEIGHT,
        bottomSpacer: Math.max(0, (conversations.length - selectedEnd) * ESTIMATED_ROW_HEIGHT),
      };
    }

    return {
      start: baseStart,
      end: baseEnd,
      topSpacer: baseStart * ESTIMATED_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (conversations.length - baseEnd) * ESTIMATED_ROW_HEIGHT),
    };
  }, [conversations, effectiveSelectedId, scrollTop, viewportHeight]);

  const visibleConversations = useMemo(
    () => conversations.slice(virtualizedWindow.start, virtualizedWindow.end),
    [conversations, virtualizedWindow.end, virtualizedWindow.start],
  );

  return (
    <>
      {virtualizedWindow.topSpacer > 0 ? (
        <div aria-hidden="true" style={{ height: virtualizedWindow.topSpacer }} />
      ) : null}

      {(conversations.length > VIRTUALIZATION_THRESHOLD ? visibleConversations : conversations).map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          isSelected={effectiveSelectedId === conversation.id}
          onSelect={handleSelect}
          onPrefetch={handlePrefetch}
        />
      ))}

      {virtualizedWindow.bottomSpacer > 0 ? (
        <div aria-hidden="true" style={{ height: virtualizedWindow.bottomSpacer }} />
      ) : null}
    </>
  );
}
