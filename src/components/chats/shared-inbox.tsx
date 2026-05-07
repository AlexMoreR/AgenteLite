"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  Facebook,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Search,
  SendHorizonal,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { ChatSelectionOverlay } from "@/components/chats/chat-selection-overlay";
import { mergeConversationSnapshots, readConversationFromCache, saveConversationToCache } from "@/components/chats/chat-history-cache";
import { ConversationList } from "@/components/chats/conversation-list";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import { EtiquetaModal } from "@/components/chats/etiqueta-modal";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const chatDateFormatter = new Intl.DateTimeFormat("en-CA");
const chatDateLabelFormatter = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const chatTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "numeric",
  minute: "2-digit",
});

export type SharedInboxConversationItem = {
  id: string;
  source: "agent" | "official";
  agentId?: string | null;
  contactId?: string | null;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
  incomingCount?: number | null;
  avatarUrl?: string | null;
  lastMessage: string | null;
  lastMessageType?: SharedInboxMessageItem["type"] | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
  href: string;
};

export type SharedInboxMessageItem = {
  id: string;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  authorType?: "user" | "bot";
  outboundStatusLabel?: string | null;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
  mediaUrl?: string | null;
  rawPayload?: unknown;
};

export type SharedInboxSelectedConversation = {
  id: string;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  messages: SharedInboxMessageItem[];
  automationPaused?: boolean;
  loadMoreHref?: string | null;
  loadMoreCursor?: string | null;
  cacheKey?: string | null;
};

type OptimisticDraftMessage = SharedInboxMessageItem & {
  conversationId: string;
  isOptimistic: true;
};

type LiveConversationSnapshot = SharedInboxSelectedConversation & {
  messages: Array<SharedInboxMessageItem & { createdAt: Date }>;
};

type LiveConversationListSnapshot = SharedInboxConversationItem & {
  lastMessageAt: Date | null;
};

type ConversationContactUpdateDetail = {
  contactId: string;
  name: string;
};

type ConversationTagsUpdateDetail = {
  contactId: string;
  tags: Array<{
    label: string;
    color: string;
  }>;
};

type PendingConversationSelection = {
  id: string;
  chatKey?: string | null;
  source?: "agent" | "official";
  agentId?: string | null;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  lastMessage?: string | null;
  lastMessageType?: SharedInboxMessageItem["type"] | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: string | Date | null;
  channelType?: SharedInboxConversationItem["channelType"];
  cacheKey?: string | null;
  phoneNumber?: string | null;
  hasCache?: boolean;
};

function buildPendingConversationPreview(
  pendingConversation: PendingConversationSelection,
): SharedInboxSelectedConversation {
  const lastMessage = pendingConversation.lastMessage?.trim() || "";
  const direction = pendingConversation.lastMessageDirection || "INBOUND";
  const createdAt = pendingConversation.lastMessageAt ? new Date(pendingConversation.lastMessageAt) : new Date();
  const previewMessages = lastMessage
    ? [
        {
          id: `${pendingConversation.cacheKey ?? pendingConversation.id}:preview`,
          content: lastMessage,
          direction,
          createdAt,
          authorType: direction === "OUTBOUND" ? "bot" : "user",
          type: pendingConversation.lastMessageType ?? "TEXT",
        } satisfies SharedInboxMessageItem,
      ]
    : [];

  return {
    id: pendingConversation.id,
    label: pendingConversation.label,
    secondaryLabel: pendingConversation.secondaryLabel,
    avatarUrl: pendingConversation.avatarUrl ?? null,
    tags: [],
    contactId: null,
    contactName: null,
    messages: previewMessages,
    cacheKey: pendingConversation.cacheKey ?? pendingConversation.id,
  };
}

function buildComposerHiddenFields(
  baseFields: Array<{ name: string; value: string }>,
  selectedConversation: PendingConversationSelection | null,
) {
  if (!selectedConversation) {
    return baseFields;
  }

  const nextFields = [...baseFields];
  const upsertField = (name: string, value: string) => {
    const index = nextFields.findIndex((field) => field.name === name);
    if (index >= 0) {
      nextFields[index] = { name, value };
      return;
    }

    nextFields.push({ name, value });
  };

  upsertField("source", selectedConversation.source || "agent");
  upsertField("conversationId", selectedConversation.id);
  upsertField("agentId", selectedConversation.source === "agent" ? (selectedConversation.agentId ?? "") : "");

  return nextFields;
}

export type SharedInboxSidebarItem = {
  id: string;
  label: string;
  helper?: string;
  href: string;
  isActive?: boolean;
  channelType?: SharedInboxConversationItem["channelType"];
};

type SharedInboxProps = {
  searchAction: string;
  selectedConversationId: string;
  searchQuery: string;
  selectedConnectionKey?: string;
  sidebarItems?: SharedInboxSidebarItem[];
  conversations: SharedInboxConversationItem[];
  selectedConversation: SharedInboxSelectedConversation | null;
  backHref: string;
  headerBadge?: ReactNode;
  headerActions?: ReactNode;
  composer?: {
    action: (formData: FormData) => void | Promise<void>;
    hiddenFields: Array<{ name: string; value: string }>;
    placeholder?: string;
  };
  emptyListTitle: string;
  emptyListDescription: string;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  messageScrollBehavior?: "bottom" | "preserve";
};

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

function countIncomingMessagesSinceLastOutbound(messages: SharedInboxMessageItem[]) {
  let incomingCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "OUTBOUND") {
      break;
    }

    if (message.direction === "INBOUND") {
      incomingCount += 1;
    }
  }

  return incomingCount;
}

function getMessagePreviewText(message?: SharedInboxMessageItem | null) {
  if (!message) {
    return null;
  }

  const content = message.content?.trim();
  if (content) {
    return content;
  }

  if (message.type === "AUDIO") return "Audio";
  if (message.type === "IMAGE") return "Imagen";
  if (message.type === "VIDEO") return "Video";
  if (message.type === "DOCUMENT") return "Documento";

  return null;
}

function normalizeLiveConversationSnapshot(value: unknown): LiveConversationSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    messages?: Array<{ createdAt?: string | Date } & Record<string, unknown>>;
  };

  if (typeof data.id !== "string" || !Array.isArray(data.messages)) {
    return null;
  }

  return {
    ...(value as SharedInboxSelectedConversation),
    id: data.id,
    // Normalizar a ASC (oldest-first) igual que page.tsx hace con .reverse().
    // /live retorna DESC del DB; buildConversationItemFromSnapshot y
    // countIncomingMessagesSinceLastOutbound asumen ASC.
    messages: data.messages
      .map((message) => ({
        ...(message as SharedInboxMessageItem),
        createdAt: new Date(message.createdAt || Date.now()),
      }))
      .sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }),
  };
}

function normalizeLiveConversationListSnapshot(value: unknown): LiveConversationListSnapshot | null {
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

function extractConversationIdFromKey(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function conversationIdMatchesKey(key: string, conversationId: string) {
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

function findConversationItemBySnapshotId(
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

function buildConversationItemFromSnapshot(
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
    incomingCount: countIncomingMessagesSinceLastOutbound(snapshot.messages),
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: latestMessage ? getMessagePreviewText(latestMessage) : existing?.lastMessage ?? null,
    lastMessageType: latestMessage?.type ?? existing?.lastMessageType ?? null,
    lastMessageDirection: latestMessage?.direction ?? existing?.lastMessageDirection ?? null,
    lastMessageAt: latestMessage?.createdAt ?? existing?.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };

  return nextItem;
}

function buildConversationItemFromListSnapshot(
  snapshot: LiveConversationListSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  return {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? (snapshot.channelType === "whatsapp_official" ? "official" : "agent"),
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    label: snapshot.label,
    secondaryLabel: snapshot.secondaryLabel,
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: snapshot.channelType ?? existing?.channelType,
    incomingCount: snapshot.incomingCount ?? existing?.incomingCount ?? 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: snapshot.lastMessage ?? existing?.lastMessage ?? null,
    lastMessageType: snapshot.lastMessageType ?? existing?.lastMessageType ?? null,
    lastMessageDirection: snapshot.lastMessageDirection ?? existing?.lastMessageDirection ?? null,
    // No usar existing como fallback para lastMessageAt: si el snapshot trae null pero existing
    // tiene una fecha vieja, el item quedaría anclado en su posición anterior en el sort.
    lastMessageAt: snapshot.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };
}

function sortConversationItems(items: SharedInboxConversationItem[]) {
  return [...items].sort((left, right) => {
    const leftAt = left.lastMessageAt ? left.lastMessageAt.getTime() : 0;
    const rightAt = right.lastMessageAt ? right.lastMessageAt.getTime() : 0;
    return rightAt - leftAt;
  });
}

function updateConversationItemByContact(
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

function renderWhatsAppText(content: string) {
  const parts = content.split(/(\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function renderMessageText(content?: string | null, className = "") {
  if (!content?.trim()) {
    return null;
  }

  return <p className={`whitespace-pre-wrap break-words ${className}`}>{renderWhatsAppText(content)}</p>;
}

function formatDateDivider(date: Date) {
  return chatDateLabelFormatter.format(date);
}

function isRenderableMediaUrl(url?: string | null) {
  if (!url) {
    return false;
  }

  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

function isVisualMessage(message: SharedInboxMessageItem) {
  return Boolean(extractImagePreviewUrl(message)) && (message.type === "IMAGE" || (!message.type && message.mediaUrl));
}

function isAudioMessage(message: SharedInboxMessageItem) {
  return Boolean(extractMediaUrlFromPayload(message, "AUDIO")) && message.type === "AUDIO";
}

function isVideoMessage(message: SharedInboxMessageItem) {
  return Boolean(extractMediaUrlFromPayload(message, "VIDEO")) && message.type === "VIDEO";
}

function isDocumentMessage(message: SharedInboxMessageItem) {
  return Boolean(extractMediaUrlFromPayload(message, "DOCUMENT")) && message.type === "DOCUMENT";
}

function extractMediaUrlFromPayload(message: SharedInboxMessageItem, type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT") {
  const rootPayload = getNestedRecord(message.rawPayload, "evolution") ?? (isObjectRecord(message.rawPayload) ? message.rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(rootPayload, "message");
  const nestedMessage =
    type === "IMAGE"
      ? getNestedRecord(messageData, "imageMessage")
      : type === "AUDIO"
        ? getNestedRecord(messageData, "audioMessage")
        : type === "VIDEO"
          ? getNestedRecord(messageData, "videoMessage")
          : getNestedRecord(messageData, "documentMessage");

  const candidate =
    getNestedString(nestedMessage, "url") ||
    getNestedString(nestedMessage, "directPath") ||
    getNestedString(data, "mediaUrl") ||
    getNestedString(data, "media") ||
    getNestedString(data, "url") ||
    message.mediaUrl ||
    null;

  return isRenderableMediaUrl(candidate) ? candidate : null;
}

function AudioMessageCard({
  mediaUrl,
  content,
  outbound,
}: {
  mediaUrl: string;
  content: string | null;
  outbound: boolean;
}) {
  return (
    <div className="w-[280px] max-w-full space-y-2">
      <audio
        src={mediaUrl}
        controls
        preload="metadata"
        className={`block w-full min-w-0 rounded-xl ${outbound ? "[color-scheme:dark]" : ""}`}
      />

      {renderMessageText(content)}
    </div>
  );
}

function ComposerSendButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70 md:h-10 md:w-10"
      aria-label={pending ? "Enviando mensaje" : "Enviar mensaje"}
    >
      <SendHorizonal className={`h-5 w-5 ${pending ? "animate-pulse" : ""}`} />
    </button>
  );
}

type ChatAdPreview = {
  title: string;
  body?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceApp?: string | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedRecord(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isObjectRecord(nested) ? nested : null;
}

function getNestedString(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested : null;
}

function getNestedValue(value: unknown, key: string) {
  if (!isObjectRecord(value) || !(key in value)) {
    return null;
  }

  return value[key];
}

function bytesLikeToBase64(value: unknown) {
  const toBase64 = (bytes: number[]) => {
    if (bytes.length === 0) {
      return null;
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return window.btoa(binary);
  };

  if (value instanceof Uint8Array) {
    return toBase64(Array.from(value));
  }

  if (Array.isArray(value)) {
    const bytes = value.filter((item): item is number => typeof item === "number");
    return toBase64(bytes);
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  const numericEntries = Object.entries(value)
    .filter(([key, entryValue]) => /^\d+$/.test(key) && typeof entryValue === "number")
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, entryValue]) => entryValue as number);

  return toBase64(numericEntries);
}

function extractImagePreviewUrl(message: SharedInboxMessageItem) {
  if (isRenderableMediaUrl(message.mediaUrl)) {
    return message.mediaUrl;
  }

  const rootPayload = getNestedRecord(message.rawPayload, "evolution") ?? (isObjectRecord(message.rawPayload) ? message.rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(rootPayload, "message");
  const imageMessage = getNestedRecord(messageData, "imageMessage");
  const directImageUrl =
    getNestedString(imageMessage, "url") ||
    getNestedString(imageMessage, "directPath") ||
    getNestedString(data, "mediaUrl") ||
    getNestedString(data, "media") ||
    getNestedString(data, "url");

  if (isRenderableMediaUrl(directImageUrl)) {
    return directImageUrl;
  }

  const thumbnailBytes =
    getNestedValue(imageMessage, "jpegThumbnail") ??
    getNestedValue(imageMessage, "thumbnail") ??
    getNestedValue(getNestedRecord(getNestedRecord(data, "contextInfo"), "externalAdReply"), "thumbnail");

  const base64 = bytesLikeToBase64(thumbnailBytes);

  return base64 ? `data:image/jpeg;base64,${base64}` : isRenderableMediaUrl(message.mediaUrl) ? message.mediaUrl : null;
}

function extractChatAdPreview(rawPayload: unknown): ChatAdPreview | null {
  const rootPayload = getNestedRecord(rawPayload, "evolution") ?? (isObjectRecord(rawPayload) ? rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const contextInfo = getNestedRecord(data, "contextInfo") ?? getNestedRecord(rootPayload, "contextInfo");
  const externalAdReply = getNestedRecord(contextInfo, "externalAdReply");

  if (!externalAdReply) {
    return null;
  }

  const title = getNestedString(externalAdReply, "title");

  if (!title) {
    return null;
  }

  return {
    title,
    body: getNestedString(externalAdReply, "body"),
    sourceUrl: getNestedString(externalAdReply, "sourceUrl"),
    thumbnailUrl: getNestedString(externalAdReply, "thumbnailUrl"),
    sourceApp: getNestedString(externalAdReply, "sourceApp"),
  };
}

// Componente memoizado: solo re-renderiza si cambian sus props directas.
// Evita que los ~N mensajes renderizados re-ejecuten cuando cambia estado de UI
// en SharedInbox (modal abierto, optimisticOutgoingMessage, pendingConversation, etc.).
const MessageBubble = memo(function MessageBubble({
  message,
  previousMessage,
}: {
  message: SharedInboxMessageItem;
  previousMessage: SharedInboxMessageItem | undefined;
}) {
  const outbound = message.direction === "OUTBOUND";
  const currentDateKey = chatDateFormatter.format(message.createdAt);
  const previousDateKey = previousMessage ? chatDateFormatter.format(previousMessage.createdAt) : null;
  const showDateDivider = currentDateKey !== previousDateKey;
  const adPreview = extractChatAdPreview(message.rawPayload);
  const isOptimistic = "isOptimistic" in message && Boolean((message as { isOptimistic?: boolean }).isOptimistic);

  return (
    <div
      className="space-y-2.5 md:space-y-3"
      style={{ contentVisibility: "auto", containIntrinsicSize: "160px" }}
    >
      {showDateDivider ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium capitalize text-slate-500 shadow-sm backdrop-blur">
            {formatDateDivider(message.createdAt)}
          </span>
        </div>
      ) : null}

      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[88%] rounded-[16px] px-[10px] py-[8px] text-[13px] leading-5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] md:max-w-[72%] md:px-[10px] md:py-[9px] ${
            outbound
              ? "bg-[var(--primary)] text-white"
              : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
          } ${isOptimistic ? "opacity-85" : ""}`}
        >
          {adPreview ? (
            <div className="space-y-3">
              <div
                className={`overflow-hidden rounded-[14px] border ${
                  outbound ? "border-white/20 bg-white/10" : "border-[rgba(148,163,184,0.16)] bg-slate-50"
                }`}
              >
                {adPreview.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={adPreview.thumbnailUrl}
                    alt={adPreview.title}
                    className="h-auto max-h-[220px] w-full object-cover"
                  />
                ) : null}
                <div className="space-y-1.5 px-3 py-3">
                  <div className="flex items-center gap-2 text-[11px]">
                    {adPreview.sourceApp === "facebook" ? (
                      <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-blue-600"}`} />
                    ) : (
                      <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-emerald-600"}`} />
                    )}
                    <span className={outbound ? "text-white/80" : "text-slate-500"}>
                      {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="line-clamp-2 text-[13px] font-semibold leading-5">{adPreview.title}</p>
                    {adPreview.body ? (
                      <p className={`line-clamp-2 text-[12px] leading-5 ${outbound ? "text-white/85" : "text-slate-600"}`}>
                        {adPreview.body}
                      </p>
                    ) : null}
                  </div>
                  {adPreview.sourceUrl ? (
                    <a
                      href={adPreview.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex text-[11px] underline underline-offset-2 ${
                        outbound ? "text-white/85" : "text-slate-500"
                      }`}
                    >
                      {adPreview.sourceUrl.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null}
                </div>
              </div>
              {renderMessageText(message.content)}
            </div>
          ) : isVisualMessage(message) ? (
            <div className="space-y-2">
              {(() => {
                const previewUrl = extractImagePreviewUrl(message);
                return previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={message.content?.trim() || "Imagen del chat"}
                    className="max-h-[320px] w-full rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className={`flex min-h-[140px] items-center justify-center rounded-xl border border-dashed text-sm ${
                      outbound ? "border-white/20 text-white/80" : "border-slate-200 text-slate-500"
                    }`}
                  >
                    Imagen no disponible
                  </div>
                );
              })()}
              {renderMessageText(message.content)}
            </div>
          ) : isVideoMessage(message) ? (
            <div className="space-y-2">
              {(() => {
                const videoUrl = message.mediaUrl || extractMediaUrlFromPayload(message, "VIDEO");
                return videoUrl ? (
                  <video
                    src={videoUrl}
                    controls
                    preload="metadata"
                    className="max-h-[320px] w-full rounded-xl bg-black"
                  />
                ) : (
                  <div
                    className={`flex min-h-[140px] items-center justify-center rounded-xl border border-dashed text-sm ${
                      outbound ? "border-white/20 text-white/80" : "border-slate-200 text-slate-500"
                    }`}
                  >
                    Video no disponible
                  </div>
                );
              })()}
              {renderMessageText(message.content)}
            </div>
          ) : isAudioMessage(message) ? (
            message.mediaUrl || extractMediaUrlFromPayload(message, "AUDIO") ? (
              <AudioMessageCard
                mediaUrl={message.mediaUrl || extractMediaUrlFromPayload(message, "AUDIO") || ""}
                content={message.content}
                outbound={outbound}
              />
            ) : (
              renderMessageText(message.content) || <p>Audio no disponible</p>
            )
          ) : isDocumentMessage(message) ? (
            <div className="space-y-2">
              <a
                href={message.mediaUrl || extractMediaUrlFromPayload(message, "DOCUMENT") || "#"}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium underline-offset-2 transition hover:underline ${
                  outbound ? "bg-white/14 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Abrir documento
              </a>
              {renderMessageText(message.content)}
            </div>
          ) : (
            renderMessageText(message.content) || <p>-</p>
          )}

          <div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
            {message.authorType === "bot" ? (
              <Bot className="h-3 w-3" />
            ) : (
              <UserRound className="h-3 w-3" />
            )}
            <span>{chatTimeFormatter.format(message.createdAt)}</span>
            {outbound && message.outboundStatusLabel ? (
              message.outboundStatusLabel === "entregado" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <span className="ml-1">{message.outboundStatusLabel}</span>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

export function SharedInbox({
  searchAction,
  selectedConversationId,
  searchQuery,
  selectedConnectionKey = "",
  sidebarItems = [],
  conversations,
  selectedConversation,
  backHref,
  headerBadge,
  headerActions,
  composer,
  emptyListTitle,
  emptyListDescription,
  emptySelectionTitle,
  emptySelectionDescription,
  messageScrollBehavior = "bottom",
}: SharedInboxProps) {
  const [conversationItems, setConversationItems] = useState<SharedInboxConversationItem[]>(conversations);
  const [optimisticConversation, setOptimisticConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [liveConversation, setLiveConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [cachedSelectedConversation, setCachedSelectedConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [optimisticOutgoingMessage, setOptimisticOutgoingMessage] = useState<OptimisticDraftMessage | null>(null);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const [etiquetaModalOpen, setEtiquetaModalOpen] = useState(false);
  const handleCloseEtiquetaModal = useCallback(() => setEtiquetaModalOpen(false), []);
  const conversationListScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollKeyRef = useRef("");
  const [unreadCount, setUnreadCount] = useState(0);
  const autoLoadLockRef = useRef(false);
  // Ref sincronizada en cada render: permite leer el valor actual dentro de event
  // listeners sin declararlos como dependencia (evita re-registro en cada mensaje).
  const selectedConversationRef = useRef(selectedConversation);
  const router = useRouter();
  const [searchInputValue, setSearchInputValue] = useState(searchQuery);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  const buildSearchUrl = useCallback(
    (q: string) => {
      const params = new URLSearchParams();
      if (selectedConversationId) params.set("chatKey", selectedConversationId);
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (q) params.set("q", q);
      const qs = params.toString();
      return qs ? `${searchAction}?${qs}` : searchAction;
    },
    [searchAction, selectedConversationId, selectedConnectionKey],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        router.replace(buildSearchUrl(value.trim()));
      }, 350);
    },
    [buildSearchUrl, router],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    router.replace(buildSearchUrl(""));
  }, [buildSearchUrl, router]);

  const [pendingConversation, setPendingConversation] = useState<{
    id: string;
    chatKey?: string | null;
    label: string;
    secondaryLabel: string;
    avatarUrl?: string | null;
    lastMessage?: string | null;
    channelType?: SharedInboxConversationItem["channelType"];
    cacheKey?: string | null;
    hasCache?: boolean;
  } | null>(null);

  useEffect(() => {
    if (selectedConversation) {
      saveConversationToCache(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    setCachedSelectedConversation(selectedConversation ? readConversationFromCache(selectedConversation.id) : null);
  }, [selectedConversation]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    setConversationItems(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!optimisticOutgoingMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setOptimisticOutgoingMessage(null);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [optimisticOutgoingMessage]);

  useEffect(() => {
    function handlePendingSelection(event: Event) {
      const customEvent = event as CustomEvent<{
        id: string;
        chatKey?: string | null;
        source?: "agent" | "official";
        agentId?: string | null;
        label: string;
        secondaryLabel: string;
        avatarUrl?: string | null;
        lastMessage?: string | null;
        lastMessageType?: SharedInboxMessageItem["type"] | null;
        lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
        lastMessageAt?: string | Date | null;
        channelType?: SharedInboxConversationItem["channelType"];
        cacheKey?: string | null;
        phoneNumber?: string | null;
        hasCache?: boolean;
      }>;
      const nextConversation = customEvent.detail;
      if (!nextConversation?.id) {
        return;
      }

      setPendingConversation(nextConversation);
      const cachedConversation = readConversationFromCache(nextConversation.id);
      setOptimisticConversation(cachedConversation ?? buildPendingConversationPreview(nextConversation));
    }

    window.addEventListener("chat-selection-pending", handlePendingSelection as EventListener);
    return () => window.removeEventListener("chat-selection-pending", handlePendingSelection as EventListener);
  }, []);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationSnapshot(customEvent.detail?.conversation);
      if (!snapshot || !conversationIdMatchesKey(selectedConversationId, snapshot.id)) {
        return;
      }

      setLiveConversation((current) => {
        // Si current pertenece a una conversación diferente (liveConversation nunca se
        // resetea al navegar), usarlo como base haría que mergeCachedMessages concatene
        // mensajes de dos chats distintos. Solo se usa current si es del mismo chat.
        const base = (current && current.id === snapshot.id)
          ? current
          : (selectedConversationRef.current ?? null);
        return mergeConversationSnapshots(base, snapshot);
      });
      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const updatedItem = buildConversationItemFromSnapshot(snapshot, currentItem);
        const nextItems = current.map((item) =>
          conversationIdMatchesKey(item.id, snapshot.id) ? { ...item, ...updatedItem } : item,
        );

        return nextItems.sort((left, right) => {
          const leftAt = left.lastMessageAt ? left.lastMessageAt.getTime() : 0;
          const rightAt = right.lastMessageAt ? right.lastMessageAt.getTime() : 0;
          return rightAt - leftAt;
        });
      });
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [selectedConversationId]);

  useEffect(() => {
    function handleListUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationListSnapshot(customEvent.detail?.conversation);
      if (!snapshot) {
        return;
      }

      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const updatedItem = buildConversationItemFromListSnapshot(snapshot, currentItem);
        const nextItems = current.map((item) =>
          conversationIdMatchesKey(item.id, snapshot.id) ? { ...item, ...updatedItem } : item,
        );

        return sortConversationItems(nextItems);
      });
    }

    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleContactUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationContactUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId || !detail.name?.trim()) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => ({
          ...item,
          label: detail.name.trim(),
        })),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });
    }

    window.addEventListener("chat-contact-updated", handleContactUpdate as EventListener);
    return () => window.removeEventListener("chat-contact-updated", handleContactUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleTagsUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationTagsUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => ({
          ...item,
          tags: detail.tags,
        })),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          tags: detail.tags,
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          tags: detail.tags,
        };
      });
    }

    window.addEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
  }, []);

  useEffect(() => {
    const normalizedSelectedConversationId = (pendingConversation?.chatKey ?? selectedConversationId).trim();

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    const hasLoadedMessages =
      (selectedConversation?.messages.length ?? 0) > 0 ||
      (cachedSelectedConversation?.messages.length ?? 0) > 0 ||
      (liveConversation && conversationIdMatchesKey(liveConversation.id, normalizedSelectedConversationId) && (liveConversation.messages.length ?? 0) > 0);

    if (hasLoadedMessages) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadSelectedConversationDetail() {
      try {
        const response = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;

        if (!payload?.ok || !payload.conversation || cancelled) {
          return;
        }

        const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
        if (!snapshot || cancelled) {
          return;
        }

        setLiveConversation((current) => {
          const base = current && conversationIdMatchesKey(current.id, snapshot.id)
            ? current
            : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                ? selectedConversationRef.current
                : selectedConversation ?? null);
          return mergeConversationSnapshots(base, snapshot);
        });
      } catch {
        // Intentional no-op: si falla, la vista cacheada/preview sigue siendo usable.
      }
    }

    void loadSelectedConversationDetail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cachedSelectedConversation?.messages.length, liveConversation, pendingConversation?.chatKey, selectedConversation, selectedConversationId]);

  useEffect(() => {
    if (!pendingConversation?.id || pendingConversation.id !== selectedConversationId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPendingConversation(null);
      setOptimisticConversation(null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pendingConversation?.id, selectedConversationId]);

  const effectiveLiveConversation =
    liveConversation && conversationIdMatchesKey(selectedConversationId, liveConversation.id) ? liveConversation : null;
  const liveOrCachedConversation = mergeConversationSnapshots(selectedConversation ?? null, effectiveLiveConversation ?? cachedSelectedConversation);

  useEffect(() => {
    if (effectiveLiveConversation && liveOrCachedConversation) {
      saveConversationToCache(liveOrCachedConversation);
    }
  }, [effectiveLiveConversation, liveOrCachedConversation]);

  const renderedConversation =
    optimisticConversation &&
    pendingConversation?.id === optimisticConversation.id &&
    (!liveOrCachedConversation || (optimisticConversation.messages.length > 0 && liveOrCachedConversation.messages.length === 0))
      ? optimisticConversation
      : liveOrCachedConversation && pendingConversation?.id === liveOrCachedConversation.id
        ? liveOrCachedConversation
        : optimisticConversation && pendingConversation?.id === optimisticConversation.id
          ? optimisticConversation
          : liveOrCachedConversation;
  const optimisticDraftMatchesLatestMessage =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.at(-1)?.direction === "OUTBOUND" &&
        renderedConversation.messages.at(-1)?.content?.trim() === optimisticOutgoingMessage.content?.trim(),
    );
  const renderedMessages =
    renderedConversation &&
    optimisticOutgoingMessage &&
    renderedConversation.id === optimisticOutgoingMessage.conversationId &&
    !optimisticDraftMatchesLatestMessage
      ? [...renderedConversation.messages, optimisticOutgoingMessage]
      : renderedConversation?.messages ?? [];
  const hasSettledConversation = Boolean(renderedConversation && selectedConversation && renderedConversation.id === selectedConversation.id);
  const hasMobileSelection = Boolean(renderedConversation || pendingConversation || selectedConversationId);
  const composerHiddenFields = composer
    ? buildComposerHiddenFields(
        composer.hiddenFields,
        pendingConversation && pendingConversation.id === renderedConversation?.id ? pendingConversation : null,
      )
    : [];
  const selectedConversationScrollKey = renderedConversation
    ? `${renderedConversation.id}:${renderedMessages.length}:${renderedMessages.at(-1)?.id ?? ""}`
    : "empty";
  const hasSidebar = sidebarItems.length > 0;

  useEffect(() => {
    autoLoadLockRef.current = false;
  }, [renderedConversation?.loadMoreHref, renderedConversation?.id]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    const loadMoreSentinel = loadMoreSentinelRef.current;
    const loadMoreHref = renderedConversation?.loadMoreHref;

    if (
      !scrollContainer ||
      !loadMoreSentinel ||
      !loadMoreHref ||
      messageScrollBehavior !== "preserve" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;

        if (!entry?.isIntersecting || autoLoadLockRef.current) {
          return;
        }

        autoLoadLockRef.current = true;
        router.replace(loadMoreHref, { scroll: false });
      },
      {
        root: scrollContainer,
        threshold: 0,
        rootMargin: "96px 0px 0px 0px",
      },
    );

    observer.observe(loadMoreSentinel);

    return () => {
      observer.disconnect();
    };
  }, [messageScrollBehavior, renderedConversation?.id, renderedConversation?.loadMoreHref, router]);

  // Reset scroll state when the user opens a different conversation.
  useEffect(() => {
    isNearBottomRef.current = true;
    setUnreadCount(0);
    prevScrollKeyRef.current = "";
  }, [selectedConversationId]);

  // Track whether the user is near the bottom of the message list.
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;

    function handleScroll() {
      const el = container!;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distFromBottom <= 150;
      if (isNearBottomRef.current) setUnreadCount(0);
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom" || !renderedConversation) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        isNearBottomRef.current = true;
        setUnreadCount(0);
        scrollFrameRef.current = null;
      });
    });
  }, [messageScrollBehavior, renderedConversation]);

  // Smart scroll: auto-scroll only when near bottom; count new messages when scrolled up.
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;

    const container = messagesScrollRef.current;
    const currentKey = selectedConversationScrollKey;
    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = currentKey;

    if (currentKey === "empty" || !container) return;

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }

          isNearBottomRef.current = true;
          setUnreadCount(0);
          scrollFrameRef.current = null;
        });
      });
    };

    if (!prevKey || prevKey === "empty") {
      // Initial load — jump to bottom without animation.
      jumpToBottom(false);
      return;
    }

    const prevConvId = prevKey.split(":")[0];
    const curConvId = currentKey.split(":")[0];

    if (prevConvId !== curConvId) {
      // Different conversation opened — always jump to bottom.
      jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = Number(prevKey.split(":")[1]) || 0;
    const curCount = Number(currentKey.split(":")[1]) || 0;
    const added = curCount - prevCount;
    if (added <= 0) return;

    // First messages arriving (0 → N): always jump to bottom regardless of scroll position.
    if (prevCount === 0) {
      jumpToBottom(false);
      return;
    }

    if (isNearBottomRef.current) {
      jumpToBottom(true);
    } else {
      setUnreadCount((prev) => prev + added);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  return (
    <>
    <div
      className={`chat-inbox-grid flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden md:grid ${
        hasSidebar ? "md:grid-cols-[250px_360px_minmax(0,1fr)]" : "md:grid-cols-[380px_minmax(0,1fr)]"
      }`}
    >
      {hasSidebar ? (
        <div className="hidden min-h-0 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#171717] p-0 text-white shadow-[0_28px_70px_-42px_rgba(15,23,42,0.42)] md:flex md:h-full">
          <div className="flex min-h-0 w-full flex-col">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90">
                  <MessageSquareText className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-[-0.03em] text-white">Chats</p>
                  <p className="text-[11px] text-white/45">Conexiones creadas</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <nav className="space-y-1">
                {sidebarItems.map((item) => {
                  const isActive = item.isActive || selectedConnectionKey === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                        isActive ? "bg-white/8 text-white" : "text-white/72 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isActive ? "border-white/16 bg-white/8" : "border-white/8 bg-white/4"
                        }`}
                      >
                        {item.channelType === "whatsapp_official" ? (
                          <BadgeCheck className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-400" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        {item.helper ? <p className="truncate text-[11px] text-white/42">{item.helper}</p> : null}
                      </div>

                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition ${
                          isActive ? "translate-x-0 text-white/75" : "text-white/28 group-hover:text-white/55"
                        }`}
                      />
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      <Card
        className={`${hasMobileSelection ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
      >
        <div className="flex min-h-0 w-full flex-col">
          <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-white px-3 py-2.5 md:px-3 md:py-3">
            <form className="relative" action={searchAction} onSubmit={() => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }}>
              <input type="hidden" name="chatKey" value={selectedConversationId} />
              {selectedConnectionKey ? <input type="hidden" name="connection" value={selectedConnectionKey} /> : null}
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                value={searchInputValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Buscar chat..."
                className="h-10 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-8 text-[14px] text-slate-700 outline-none transition focus:border-[var(--primary)] focus:bg-white md:text-sm"
              />
              {searchInputValue ? (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-400 transition hover:text-slate-600 focus:outline-none"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </form>
          </div>
          <div
            ref={conversationListScrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-[rgba(148,163,184,0.12)] [-webkit-overflow-scrolling:touch]"
          >
            {conversationItems.length > 0 ? (
              <ConversationList
                conversations={conversationItems}
                selectedConversationId={selectedConversationId}
                scrollContainerRef={conversationListScrollRef}
              />
            ) : (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                    <MessageSquareText className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-950">{emptyListTitle}</h3>
                    <p className="text-sm leading-6 text-slate-600">{emptyListDescription}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        className={`${hasMobileSelection || conversationItems.length === 0 ? "flex" : "hidden md:flex"} chat-inbox-panel min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
      >
        {renderedConversation ? (
          <div className="flex min-h-0 h-full w-full flex-1 flex-col">
            <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] md:px-[10px] md:py-[10px]">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Link
                    href={backHref}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 md:hidden"
                    aria-label="Volver a chats"
                    >
                      <ArrowLeft className="h-4 w-4" />
                  </Link>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="shrink-0 cursor-default">
                          {renderedConversation.avatarUrl ? (
                            <Image
                              src={renderedConversation.avatarUrl}
                              alt={renderedConversation.label}
                              width={40}
                              height={40}
                              unoptimized
                              className="h-10 w-10 rounded-2xl object-cover"
                            />
                          ) : (
                            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                              {getInitials(renderedConversation.label)}
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      {renderedConversation.secondaryLabel ? (
                        <TooltipContent side="right">
                          {renderedConversation.secondaryLabel}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TooltipProvider>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <h2 className="truncate text-[13px] font-semibold text-slate-950 md:text-sm">
                          {renderedConversation.label}
                        </h2>
                      {renderedConversation.contactId ? (
                        <button
                          type="button"
                          onClick={() => setEditContactOpen(true)}
                          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Editar contacto"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEtiquetaModalOpen(true)}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Etiquetas"
                      >
                        <Tag className="h-3.5 w-3.5" />
                      </button>
                      </div>
                      {renderedConversation.tags?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {renderedConversation.tags.map((tag) => (
                            <span
                              key={`${renderedConversation.id}:${tag.label}`}
                              className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                              style={{
                                backgroundColor: tag.color,
                                color: "#ffffff",
                              }}
                              title={tag.label}
                            >
                              <span className="truncate">{tag.label}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                {hasSettledConversation && (headerActions || headerBadge) ? (
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    {headerActions}
                    {headerBadge}
                  </div>
                ) : null}
              </div>
            </div>

              <div className="relative flex min-h-0 flex-1 flex-col bg-[#f3f4f6]">
                <ChatSelectionOverlay selectedConversationId={selectedConversationId} />
                <div className="relative min-h-0 flex-1">
                  <div
                    ref={messagesScrollRef}
                    className="chat-messages-scroll h-full overflow-y-auto overscroll-contain px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
                    style={{
                      backgroundColor: "#f3f4f6",
                      backgroundImage:
                        `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23cbd5e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'%3E%3Ccircle cx='28' cy='24' r='10'/%3E%3Cpath d='M62 18l8 14 14 2-10 10 2 14-14-7-12 7 2-14-10-10 14-2z'/%3E%3Cpath d='M122 18c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M169 24l20 20M189 24l-20 20'/%3E%3Crect x='20' y='76' width='28' height='18' rx='6'/%3E%3Cpath d='M26 102c6-8 16-8 22 0'/%3E%3Cpath d='M76 74l10 18 20 3-14 14 3 20-19-10-18 10 3-20-14-14 20-3z'/%3E%3Cpath d='M130 78h28v18h-28z'/%3E%3Cpath d='M144 70v36M130 87h28'/%3E%3Cpath d='M176 76c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M24 142c6-8 18-8 24 0 6 8 18 8 24 0'/%3E%3Cpath d='M86 144c0-8 6-14 14-14s14 6 14 14-6 14-14 14-14-6-14-14z'/%3E%3Cpath d='M128 136l24 24M152 136l-24 24'/%3E%3Cpath d='M174 132h26v26h-26z'/%3E%3Cpath d='M182 124v42M174 145h26'/%3E%3Ccircle cx='42' cy='188' r='16'/%3E%3Cpath d='M36 188h12M42 182v12'/%3E%3Cpath d='M92 180c8-10 22-10 30 0-8 10-22 10-30 0z'/%3E%3Cpath d='M140 180l12 12 18-18'/%3E%3Cpath d='M178 184c6-8 16-8 22 0'/%3E%3C/g%3E%3C/svg%3E")`,
                      backgroundPosition: "center",
                      backgroundSize: "220px 220px",
                    }}
                  >
                    <div className="space-y-2.5 md:space-y-3">
                      {renderedConversation.loadMoreHref ? (
                        <div className="pb-1">
                          <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                          <div className="flex justify-center">
                            <Link
                              href={renderedConversation.loadMoreHref}
                              scroll={false}
                              className="inline-flex items-center rounded-full border border-[rgba(148,163,184,0.16)] bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-800"
                            >
                              Cargar mensajes anteriores
                            </Link>
                          </div>
                        </div>
                      ) : null}
                      {renderedMessages.map((message, index) => (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          previousMessage={renderedMessages[index - 1]}
                        />
                      ))}
                      {messageScrollBehavior === "preserve" ? (
                        <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} behavior="preserve" />
                      ) : null}
                    </div>
                  </div>
                  {unreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="absolute bottom-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-slate-900"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      {unreadCount}
                    </button>
                  ) : null}
                </div>

              {composer && renderedConversation ? (
                <div className="chat-composer z-20 shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_28px_-24px_rgba(15,23,42,0.2)] backdrop-blur md:border-t md:bg-white md:px-2 md:py-2 md:shadow-none md:backdrop-blur-0">
                  <form
                    action={composer.action}
                    className="mx-auto w-full max-w-5xl"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      const form = event.currentTarget;
                      const formData = new FormData(form);
                      const message = String(formData.get("message") || "").trim();

                      if (!message || !renderedConversation) {
                        return;
                      }

                      setOptimisticOutgoingMessage({
                        id: `optimistic:${renderedConversation.id}:${Date.now()}`,
                        conversationId: renderedConversation.id,
                        content: message,
                        direction: "OUTBOUND",
                        createdAt: new Date(),
                        authorType: "user",
                        outboundStatusLabel: "enviando",
                        type: "TEXT",
                        mediaUrl: null,
                        rawPayload: { optimistic: true },
                        isOptimistic: true,
                      });
                    }}
                  >
                    {composerHiddenFields.map((field) => (
                      <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                    ))}

                    <div className="flex items-end gap-2 md:gap-3">
                      <textarea
                        name="message"
                        rows={1}
                        placeholder={composer.placeholder || "Escribe un mensaje..."}
                        className="flex min-h-[44px] flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-3 py-2.5 text-[14px] text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[40px] md:py-2 md:text-sm"
                      />
                      <ComposerSendButton />
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[74vh] items-center justify-center px-6 py-10 text-center">
            <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-950">{emptySelectionTitle}</h3>
                <p className="text-sm leading-6 text-slate-600">
                  {emptySelectionDescription}
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>

    {renderedConversation?.contactId ? (
      <EditContactModal
        open={editContactOpen}
        onClose={handleCloseEditContact}
        contactId={renderedConversation.contactId}
        contactName={renderedConversation.contactName ?? renderedConversation.label}
      />
    ) : null}
    <EtiquetaModal
      open={etiquetaModalOpen}
      onClose={handleCloseEtiquetaModal}
      contactId={renderedConversation?.contactId}
    />
    </>
  );
}



