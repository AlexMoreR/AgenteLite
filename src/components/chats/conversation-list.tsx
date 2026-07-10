"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, Facebook, FileText, Image as ImageIcon, Instagram, LoaderCircle, Mic, Sticker, UserRound, Video } from "lucide-react";
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { ContactAvatar } from "./contact-avatar";
import { warmConversationCache } from "./chat-conversation-warmup";
import { setPendingConversationSelection } from "./chat-selection-store";
import { readConversationFromCache } from "./chat-history-cache";
import type { SharedInboxConversationItem } from "./shared-inbox";

// Logs de depuración desactivados (ensuciaban la consola en desarrollo).
const CHAT_LIST_DEBUG = false;

function debugConversationList(...args: unknown[]) {
  if (!CHAT_LIST_DEBUG) {
    return;
  }

  console.log("[ConversationList]", ...args);
}

// Instancia única compartida por todos los items — new Intl.DateTimeFormat() es costoso
// y no debería crearse dentro del render de cada fila en cada actualización.
const conversationTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Bogota",
});

function formatConversationTime(value: Date) {
  return conversationTimeFormatter.format(value).replace(/\u00a0/g, " ");
}

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
  if (conversation.lastMessageType === "IMAGE") return "Foto";
  if (conversation.lastMessageType === "VIDEO") return "Video";
  if (conversation.lastMessageType === "STICKER") return "Sticker";
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
  if (conversation.lastMessageType === "IMAGE" && !conversation.lastMessage?.trim()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span>Foto</span>
      </span>
    );
  }
  if (conversation.lastMessageType === "VIDEO" && !conversation.lastMessage?.trim()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Video className="h-3.5 w-3.5 shrink-0" />
        <span>Video</span>
      </span>
    );
  }
  if (conversation.lastMessageType === "DOCUMENT" && !conversation.lastMessage?.trim()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span>Documento</span>
      </span>
    );
  }
  if (conversation.lastMessageType === "STICKER" && !conversation.lastMessage?.trim()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Sticker className="h-3.5 w-3.5 shrink-0" />
        <span>Sticker</span>
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

function getConversationAvatarClassName() {
  return "size-10 after:border-0";
}

// Cuántas etiquetas mostrar como máximo en la fila antes del contador "+N".
const MAX_VISIBLE_TAGS = 3;

// Muestra hasta MAX_VISIBLE_TAGS etiquetas en una sola fila. Se encogen y se cortan
// (truncate) para compartir el ancho disponible; si hay más, agrega un badge "+N".
function ConversationTagsRow({
  tags,
  conversationId,
}: {
  tags: NonNullable<SharedInboxConversationItem["tags"]>;
  conversationId: string;
}) {
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hidden = tags.length - visibleTags.length;

  return (
    <div className="pt-0.5">
      <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
        {visibleTags.map((tag) => (
          <Badge
            key={`${conversationId}:${tag.label}`}
            className={`min-w-0 shrink max-w-[140px] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)] ${TAG_BADGE_CLASS}`}
            style={{
              ...getConversationTagBadgeStyle(tag.color),
              color: "#ffffff",
            }}
            title={tag.label}
          >
            <span className="min-w-0 truncate">{tag.label}</span>
          </Badge>
        ))}
        {hidden > 0 ? (
          <Badge className="shrink-0 border-0 bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground shadow-none">
            +{hidden}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

const ConversationListItem = memo(function ConversationListItem({
  conversation,
  isSelected,
  onPreviewSelect,
  onSelect,
  onPrefetch,
}: {
  conversation: SharedInboxConversationItem;
  isSelected: boolean;
  onPreviewSelect: (conversation: SharedInboxConversationItem) => void;
  onSelect: (conversation: SharedInboxConversationItem) => void;
  onPrefetch: (conversation: SharedInboxConversationItem) => void;
}) {
  const incomingCountLabel = renderIncomingCountLabel(conversation.incomingCount);
  const previewText = renderConversationPreview(conversation);

  return (
    <Link
      href={conversation.href}
      onPointerDown={(event) => {
        if ("button" in event && event.button !== 0) {
          return;
        }

        onPreviewSelect(conversation);
        onPrefetch(conversation);
      }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }

        event.preventDefault();
        onSelect(conversation);
      }}
      onMouseEnter={() => onPrefetch(conversation)}
      onFocus={() => onPrefetch(conversation)}
      className={`group relative grid w-full grid-cols-[40px_minmax(0,1fr)] items-start gap-2 overflow-hidden px-3 py-2.5 transition-[background-color,box-shadow,transform] duration-200 md:grid-cols-[40px_minmax(0,1fr)] md:px-3 md:py-3 ${
        isSelected
          ? "bg-primary/10"
          : "hover:bg-muted/50 hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)]"
        }`}
    >
      <span
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
          isSelected ? "bg-[var(--primary)]" : "bg-transparent group-hover:bg-emerald-400/70"
        }`}
      />

      <div className="relative size-10 shrink-0">
        <ContactAvatar
          avatarUrl={conversation.avatarUrl}
          label={conversation.label ?? conversation.secondaryLabel ?? ""}
          className={getConversationAvatarClassName()}
          fallbackClassName="rounded-full bg-muted text-muted-foreground"
        />

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
        <div className="flex min-w-0 items-center gap-1 text-[10px] leading-[1.1]">
          <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span
            className={`min-w-0 truncate font-medium ${
              conversation.assignedToName ? "text-foreground/70" : "text-muted-foreground italic"
            }`}
          >
            {conversation.assignedToName ?? "---"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex flex-1 items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[1.12] text-foreground md:text-[13px]">
              {conversation.label}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground md:text-[10px]">
            {conversation.lastMessageAt ? formatConversationTime(conversation.lastMessageAt) : ""}
          </span>
        </div>

        <div className="mt-0.5 flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
          <p className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[1.12] text-muted-foreground md:text-[13px]">
            {previewText}
          </p>
        </div>

        {conversation.tags?.length ? (
          <ConversationTagsRow tags={conversation.tags} conversationId={conversation.id} />
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
  hasMoreConversations = false,
  isLoadingMoreConversations = false,
  onLoadMoreConversations,
}: {
  conversations: SharedInboxConversationItem[];
  selectedConversationId: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  hasMoreConversations?: boolean;
  isLoadingMoreConversations?: boolean;
  onLoadMoreConversations?: () => void | Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const navigationFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const prefetchedHrefsRef = useRef(new Set<string>());
  const loadMoreRequestedForCountRef = useRef<number | null>(null);
  const router = useRouter();
  const effectiveSelectedId = isPending && pendingId ? pendingId : selectedConversationId;

  const handlePreviewSelect = useCallback((conversation: SharedInboxConversationItem) => {
    setPendingId(conversation.id);
    setPendingConversationSelection({
      id: conversation.id,
      chatKey: conversation.id,
      source: conversation.source,
      agentId: conversation.agentId ?? null,
      label: conversation.label,
      secondaryLabel: conversation.secondaryLabel,
      avatarUrl: conversation.avatarUrl ?? null,
      tags: conversation.tags ?? [],
      lastMessage: conversation.lastMessage,
      lastMessageType: conversation.lastMessageType ?? null,
      lastMessageDirection: conversation.lastMessageDirection ?? null,
      lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      channelType: conversation.channelType,
      cacheKey: conversation.id,
      phoneNumber: conversation.secondaryLabel,
      hasCache: Boolean(readConversationFromCache(conversation.id)),
    });
    void warmConversationCache(conversation.id);
  }, []);

  const handleSelect = useCallback((conversation: SharedInboxConversationItem) => {
    handlePreviewSelect(conversation);
    if (navigationFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationFrameRef.current);
    }

    navigationFrameRef.current = window.requestAnimationFrame(() => {
      startTransition(() => {
        router.push(conversation.href, { scroll: false });
      });
      navigationFrameRef.current = null;
    });
  }, [handlePreviewSelect, router, startTransition]);

  const handlePrefetch = useCallback((conversation: SharedInboxConversationItem) => {
    const href = conversation.href.trim();
    if (!href || prefetchedHrefsRef.current.has(href)) {
      return;
    }

    prefetchedHrefsRef.current.add(href);
    router.prefetch(href);
    void warmConversationCache(conversation.id);
  }, [router]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) {
      return;
    }

    const scrollContainer = container;

    function updateViewportHeight() {
      const nextHeight = scrollContainer.clientHeight;
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    }

    function updateScrollTop() {
    if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const nextScrollTop = scrollContainer.scrollTop;
        setScrollTop((current) => (current === nextScrollTop ? current : nextScrollTop));

        const distFromBottom = scrollContainer.scrollHeight - nextScrollTop - scrollContainer.clientHeight;
        const nearBottom = distFromBottom <= 240;
        if (nearBottom) {
          debugConversationList("near bottom", {
            distFromBottom,
            count: conversations.length,
            hasMoreConversations,
            isLoadingMoreConversations,
          });
        }
        if (
          nearBottom &&
          hasMoreConversations &&
          !isLoadingMoreConversations &&
          onLoadMoreConversations &&
          loadMoreRequestedForCountRef.current !== conversations.length
        ) {
          debugConversationList("trigger load more", {
            count: conversations.length,
            distFromBottom,
          });
          loadMoreRequestedForCountRef.current = conversations.length;
          void onLoadMoreConversations();
        }
      });
    }

    updateViewportHeight();
    updateScrollTop();
    scrollContainer.addEventListener("scroll", updateScrollTop, { passive: true });

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(scrollContainer);

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      scrollContainer.removeEventListener("scroll", updateScrollTop);
      resizeObserver.disconnect();
    };
  }, [conversations.length, hasMoreConversations, isLoadingMoreConversations, onLoadMoreConversations, scrollContainerRef]);

  useEffect(() => {
    loadMoreRequestedForCountRef.current = null;
  }, [conversations.length, selectedConversationId]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    const sentinel = loadMoreSentinelRef.current;

    if (!container || !sentinel) {
      return;
    }

    if (!hasMoreConversations || isLoadingMoreConversations || !onLoadMoreConversations) {
      debugConversationList("sentinel skipped", {
        hasMoreConversations,
        isLoadingMoreConversations,
        hasObserver: Boolean(onLoadMoreConversations),
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry?.isIntersecting &&
          hasMoreConversations &&
          !isLoadingMoreConversations &&
          onLoadMoreConversations &&
          loadMoreRequestedForCountRef.current !== conversations.length
        ) {
          debugConversationList("sentinel intersected", {
            count: conversations.length,
            isIntersecting: entry.isIntersecting,
          });
          loadMoreRequestedForCountRef.current = conversations.length;
          void onLoadMoreConversations();
        }
      },
      {
        root: container,
        rootMargin: "160px 0px 160px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [
    conversations.length,
    hasMoreConversations,
    isLoadingMoreConversations,
    onLoadMoreConversations,
    scrollContainerRef,
  ]);

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
    return {
      start: baseStart,
      end: baseEnd,
      topSpacer: baseStart * ESTIMATED_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (conversations.length - baseEnd) * ESTIMATED_ROW_HEIGHT),
    };
  }, [conversations, scrollTop, viewportHeight]);

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
          key={conversation.id || conversation.href}
          conversation={conversation}
          isSelected={effectiveSelectedId === conversation.id}
          onPreviewSelect={handlePreviewSelect}
          onSelect={handleSelect}
          onPrefetch={handlePrefetch}
        />
      ))}

      {isLoadingMoreConversations ? (
        <div className="flex items-center justify-center py-3" aria-live="polite" aria-label="Cargando más conversaciones">
          <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {virtualizedWindow.bottomSpacer > 0 ? (
        <div aria-hidden="true" style={{ height: virtualizedWindow.bottomSpacer }} />
      ) : null}

      {hasMoreConversations ? <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" /> : null}
    </>
  );
}


