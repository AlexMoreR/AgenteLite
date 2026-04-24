import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  ChevronRight,
  Facebook,
  MessageCircle,
  MessageSquareText,
  Search,
  SendHorizonal,
  UserRound,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { ConversationList } from "@/components/chats/conversation-list";
import { Card } from "@/components/ui/card";

export type SharedInboxConversationItem = {
  id: string;
  label: string;
  secondaryLabel: string;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
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
  avatarUrl?: string | null;
  messages: SharedInboxMessageItem[];
  automationPaused?: boolean;
};

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
};

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

function formatDateDivider(date: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function isVisualMessage(message: SharedInboxMessageItem) {
  return Boolean(message.mediaUrl) && (message.type === "IMAGE" || (!message.type && message.mediaUrl));
}

function isAudioMessage(message: SharedInboxMessageItem) {
  return Boolean(message.mediaUrl) && message.type === "AUDIO";
}

function isVideoMessage(message: SharedInboxMessageItem) {
  return Boolean(message.mediaUrl) && message.type === "VIDEO";
}

function isDocumentMessage(message: SharedInboxMessageItem) {
  return Boolean(message.mediaUrl) && message.type === "DOCUMENT";
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

      {content?.trim() ? <p>{content}</p> : null}
    </div>
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
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (Array.isArray(value)) {
    const bytes = value.filter((item): item is number => typeof item === "number");
    return bytes.length > 0 ? Buffer.from(bytes).toString("base64") : null;
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  const numericEntries = Object.entries(value)
    .filter(([key, entryValue]) => /^\d+$/.test(key) && typeof entryValue === "number")
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, entryValue]) => entryValue as number);

  return numericEntries.length > 0 ? Buffer.from(numericEntries).toString("base64") : null;
}

function extractImagePreviewUrl(message: SharedInboxMessageItem) {
  if (message.mediaUrl && !message.mediaUrl.includes("mmg.whatsapp.net") && !message.mediaUrl.includes(".enc")) {
    return message.mediaUrl;
  }

  const rootPayload = getNestedRecord(message.rawPayload, "evolution") ?? (isObjectRecord(message.rawPayload) ? message.rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(rootPayload, "message");
  const imageMessage = getNestedRecord(messageData, "imageMessage");

  const thumbnailBytes =
    getNestedValue(imageMessage, "jpegThumbnail") ??
    getNestedValue(imageMessage, "thumbnail") ??
    getNestedValue(getNestedRecord(getNestedRecord(data, "contextInfo"), "externalAdReply"), "thumbnail");

  const base64 = bytesLikeToBase64(thumbnailBytes);

  return base64 ? `data:image/jpeg;base64,${base64}` : message.mediaUrl || null;
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
}: SharedInboxProps) {
  const explicitSelectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) || null;
  const hasMobileSelection = Boolean(explicitSelectedConversation);
  const selectedConversationScrollKey = selectedConversation
    ? `${selectedConversation.id}:${selectedConversation.messages.length}:${selectedConversation.messages.at(-1)?.id ?? ""}`
    : "empty";
  const hasSidebar = sidebarItems.length > 0;

  return (
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
            <form className="relative" action={searchAction}>
              <input type="hidden" name="chatKey" value={selectedConversationId} />
              {selectedConnectionKey ? <input type="hidden" name="connection" value={selectedConnectionKey} /> : null}
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="Buscar chat..."
                className="h-10 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-3 text-[14px] text-slate-700 outline-none transition focus:border-[var(--primary)] focus:bg-white md:text-sm"
              />
            </form>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-[rgba(148,163,184,0.12)] [-webkit-overflow-scrolling:touch]">
            {conversations.length > 0 ? (
              <ConversationList conversations={conversations} selectedConversationId={selectedConversationId} />
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
        className={`${hasMobileSelection || conversations.length === 0 ? "flex" : "hidden md:flex"} chat-inbox-panel min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
      >
        {selectedConversation ? (
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
                  {selectedConversation.avatarUrl ? (
                    <Image
                      src={selectedConversation.avatarUrl}
                      alt={selectedConversation.label}
                      width={40}
                      height={40}
                      unoptimized
                      className="h-10 w-10 shrink-0 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                      {getInitials(selectedConversation.label)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate text-[13px] font-semibold text-slate-950 md:text-sm">
                      {selectedConversation.label}
                    </h2>
                    <p className="truncate text-xs text-slate-500">{selectedConversation.secondaryLabel}</p>
                  </div>
                </div>

                {headerActions || headerBadge ? (
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    {headerActions}
                    {headerBadge}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col bg-[#f3f4f6]">
              <div
                className="chat-messages-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
                style={{
                  backgroundColor: "#f3f4f6",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23cbd5e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'%3E%3Ccircle cx='28' cy='24' r='10'/%3E%3Cpath d='M62 18l8 14 14 2-10 10 2 14-14-7-12 7 2-14-10-10 14-2z'/%3E%3Cpath d='M122 18c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M169 24l20 20M189 24l-20 20'/%3E%3Crect x='20' y='76' width='28' height='18' rx='6'/%3E%3Cpath d='M26 102c6-8 16-8 22 0'/%3E%3Cpath d='M76 74l10 18 20 3-14 14 3 20-19-10-18 10 3-20-14-14 20-3z'/%3E%3Cpath d='M130 78h28v18h-28z'/%3E%3Cpath d='M144 70v36M130 87h28'/%3E%3Cpath d='M176 76c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M24 142c6-8 18-8 24 0 6 8 18 8 24 0'/%3E%3Cpath d='M86 144c0-8 6-14 14-14s14 6 14 14-6 14-14 14-14-6-14-14z'/%3E%3Cpath d='M128 136l24 24M152 136l-24 24'/%3E%3Cpath d='M174 132h26v26h-26z'/%3E%3Cpath d='M182 124v42M174 145h26'/%3E%3Ccircle cx='42' cy='188' r='16'/%3E%3Cpath d='M36 188h12M42 182v12'/%3E%3Cpath d='M92 180c8-10 22-10 30 0-8 10-22 10-30 0z'/%3E%3Cpath d='M140 180l12 12 18-18'/%3E%3Cpath d='M178 184c6-8 16-8 22 0'/%3E%3C/g%3E%3C/svg%3E\")",
                  backgroundPosition: "center",
                  backgroundSize: "220px 220px",
                }}
              >
                <div className="space-y-2.5 md:space-y-3">
                  {selectedConversation.messages.map((message, index) => {
                    const outbound = message.direction === "OUTBOUND";
                    const previousMessage = selectedConversation.messages[index - 1];
                    const currentDateKey = new Intl.DateTimeFormat("en-CA").format(message.createdAt);
                    const previousDateKey = previousMessage
                      ? new Intl.DateTimeFormat("en-CA").format(previousMessage.createdAt)
                      : null;
                    const showDateDivider = currentDateKey !== previousDateKey;
                    const adPreview = extractChatAdPreview(message.rawPayload);
                    return (
                      <div key={message.id} className="space-y-2.5 md:space-y-3">
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
                            }`}
                          >
                            {adPreview ? (
                              <div className="space-y-3">
                                <div
                                  className={`overflow-hidden rounded-[14px] border ${
                                    outbound
                                      ? "border-white/20 bg-white/10"
                                      : "border-[rgba(148,163,184,0.16)] bg-slate-50"
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
                                {message.content?.trim() ? <p>{message.content}</p> : null}
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
                                {message.content?.trim() ? <p>{message.content}</p> : null}
                              </div>
                            ) : isVideoMessage(message) ? (
                              <div className="space-y-2">
                                <video
                                  src={message.mediaUrl || ""}
                                  controls
                                  preload="metadata"
                                  className="max-h-[320px] w-full rounded-xl bg-black"
                                />
                                {message.content?.trim() ? <p>{message.content}</p> : null}
                              </div>
                            ) : isAudioMessage(message) ? (
                              message.mediaUrl ? (
                                <AudioMessageCard
                                  mediaUrl={message.mediaUrl}
                                  content={message.content}
                                  outbound={outbound}
                                />
                              ) : (
                                <p>{message.content || "Audio no disponible"}</p>
                              )
                            ) : isDocumentMessage(message) ? (
                              <div className="space-y-2">
                                <a
                                  href={message.mediaUrl || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium underline-offset-2 transition hover:underline ${
                                    outbound ? "bg-white/14 text-white" : "bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  Abrir documento
                                </a>
                                {message.content?.trim() ? <p>{message.content}</p> : null}
                              </div>
                            ) : (
                              <p>{message.content || "-"}</p>
                            )}
                            <div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
                              {message.authorType === "bot" ? (
                                <Bot className="h-3 w-3" />
                              ) : (
                                <UserRound className="h-3 w-3" />
                              )}
                              <span>
                                {new Intl.DateTimeFormat("es-CO", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                }).format(message.createdAt)}
                              </span>
                              {outbound && message.outboundStatusLabel ? <span className="ml-1">{message.outboundStatusLabel}</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} />
                </div>
              </div>

              {composer ? (
                <div className="chat-composer z-20 shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_28px_-24px_rgba(15,23,42,0.2)] backdrop-blur md:border-t md:bg-white md:px-2 md:py-2 md:shadow-none md:backdrop-blur-0">
                  <form action={composer.action} className="mx-auto w-full max-w-5xl">
                    {composer.hiddenFields.map((field) => (
                      <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                    ))}

                    <div className="flex items-end gap-2 md:gap-3">
                      <textarea
                        name="message"
                        rows={1}
                        placeholder={composer.placeholder || "Escribe un mensaje..."}
                        className="flex min-h-[44px] flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-3 py-2.5 text-[14px] text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[40px] md:py-2 md:text-sm"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] md:h-10 md:w-10"
                        aria-label="Enviar mensaje"
                      >
                        <SendHorizonal className="h-5 w-5" />
                      </button>
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
  );
}
