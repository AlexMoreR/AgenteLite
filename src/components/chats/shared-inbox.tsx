import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  Facebook,
  Instagram,
  MessageCircle,
  MessageSquareText,
  Search,
  SendHorizonal,
  UserRound,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { Card } from "@/components/ui/card";

export type SharedInboxConversationItem = {
  id: string;
  label: string;
  secondaryLabel: string;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
  avatarUrl?: string | null;
  lastMessage: string | null;
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
};

export type SharedInboxSelectedConversation = {
  id: string;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  messages: SharedInboxMessageItem[];
};

type SharedInboxProps = {
  searchAction: string;
  selectedConversationId: string;
  searchQuery: string;
  conversations: SharedInboxConversationItem[];
  selectedConversation: SharedInboxSelectedConversation | null;
  backHref: string;
  headerBadge?: ReactNode;
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

function renderChannelIcon(channelType?: SharedInboxConversationItem["channelType"]) {
  if (channelType === "whatsapp_official") {
    return <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  }
  if (channelType === "instagram") {
    return <Instagram className="h-3.5 w-3.5 shrink-0 text-pink-600" />;
  }
  if (channelType === "facebook") {
    return <Facebook className="h-3.5 w-3.5 shrink-0 text-blue-600" />;
  }
  if (channelType === "whatsapp") {
    return <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  }
  return null;
}

export function SharedInbox({
  searchAction,
  selectedConversationId,
  searchQuery,
  conversations,
  selectedConversation,
  backHref,
  headerBadge,
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

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-1 flex-col gap-0 md:min-h-0 md:grid md:grid-cols-[380px_minmax(0,1fr)]">
      <Card
        className={`${hasMobileSelection ? "hidden md:flex" : "flex"} min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[72vh] md:flex-none`}
      >
        <div className="flex min-h-0 w-full flex-col">
          <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-white px-3 py-3">
            <form className="relative" action={searchAction}>
              <input type="hidden" name="conversationId" value={selectedConversationId} />
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="Buscar chat..."
                className="h-10 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:bg-white"
              />
            </form>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[rgba(148,163,184,0.12)]">
            {conversations.length > 0 ? (
              conversations.map((conversation) => {
                const isSelected = selectedConversation?.id === conversation.id;
                const isInbound = conversation.lastMessageDirection === "INBOUND";
                return (
                  <Link
                    key={conversation.id}
                    href={conversation.href}
                    className={`group relative grid w-full grid-cols-[44px_minmax(0,1fr)] items-start gap-3 overflow-hidden px-3 py-3 transition ${
                      isSelected ? "bg-[color-mix(in_srgb,var(--primary)_6%,white)]" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <span
                      className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
                        isSelected ? "bg-[var(--primary)]" : "bg-transparent"
                      }`}
                    />

                    {conversation.avatarUrl ? (
                      <Image
                        src={conversation.avatarUrl}
                        alt={conversation.label}
                        width={44}
                        height={44}
                        unoptimized
                        className="h-11 w-11 shrink-0 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                        {getInitials(conversation.label)}
                      </div>
                    )}

                    <div className="min-w-0 overflow-hidden space-y-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex flex-1 items-center gap-1.5">
                          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-950">{conversation.label}</p>
                          {renderChannelIcon(conversation.channelType)}
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {conversation.lastMessageAt
                            ? new Intl.DateTimeFormat("es-CO", {
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(conversation.lastMessageAt)
                            : ""}
                        </span>
                      </div>

                      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
                        {isInbound ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                        <p className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-slate-600">
                          {conversation.lastMessage || "Sin mensajes visibles aun."}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })
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
        className={`${hasMobileSelection || conversations.length === 0 ? "flex" : "hidden md:flex"} min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[72vh] md:flex-none`}
      >
        {selectedConversation ? (
          <div className="flex min-h-0 h-full w-full flex-1 flex-col">
            <div className="sticky top-0 z-10 shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-3 py-3 md:static md:px-[10px] md:py-[10px]">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
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
                    <h2 className="truncate text-sm font-semibold text-slate-950">
                      {selectedConversation.label}
                    </h2>
                    <p className="truncate text-xs text-slate-500">{selectedConversation.secondaryLabel}</p>
                  </div>
                </div>

                {headerBadge}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col bg-[#f3f4f6]">
              <div
                className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-24 md:px-5 md:py-5 md:pb-5"
                style={{
                  backgroundColor: "#f3f4f6",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23cbd5e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'%3E%3Ccircle cx='28' cy='24' r='10'/%3E%3Cpath d='M62 18l8 14 14 2-10 10 2 14-14-7-12 7 2-14-10-10 14-2z'/%3E%3Cpath d='M122 18c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M169 24l20 20M189 24l-20 20'/%3E%3Crect x='20' y='76' width='28' height='18' rx='6'/%3E%3Cpath d='M26 102c6-8 16-8 22 0'/%3E%3Cpath d='M76 74l10 18 20 3-14 14 3 20-19-10-18 10 3-20-14-14 20-3z'/%3E%3Cpath d='M130 78h28v18h-28z'/%3E%3Cpath d='M144 70v36M130 87h28'/%3E%3Cpath d='M176 76c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M24 142c6-8 18-8 24 0 6 8 18 8 24 0'/%3E%3Cpath d='M86 144c0-8 6-14 14-14s14 6 14 14-6 14-14 14-14-6-14-14z'/%3E%3Cpath d='M128 136l24 24M152 136l-24 24'/%3E%3Cpath d='M174 132h26v26h-26z'/%3E%3Cpath d='M182 124v42M174 145h26'/%3E%3Ccircle cx='42' cy='188' r='16'/%3E%3Cpath d='M36 188h12M42 182v12'/%3E%3Cpath d='M92 180c8-10 22-10 30 0-8 10-22 10-30 0z'/%3E%3Cpath d='M140 180l12 12 18-18'/%3E%3Cpath d='M178 184c6-8 16-8 22 0'/%3E%3C/g%3E%3C/svg%3E\")",
                  backgroundPosition: "center",
                  backgroundSize: "220px 220px",
                }}
              >
                <div className="space-y-3">
                  {selectedConversation.messages.map((message, index) => {
                    const outbound = message.direction === "OUTBOUND";
                    const previousMessage = selectedConversation.messages[index - 1];
                    const currentDateKey = new Intl.DateTimeFormat("en-CA").format(message.createdAt);
                    const previousDateKey = previousMessage
                      ? new Intl.DateTimeFormat("en-CA").format(previousMessage.createdAt)
                      : null;
                    const showDateDivider = currentDateKey !== previousDateKey;
                    return (
                      <div key={message.id} className="space-y-3">
                        {showDateDivider ? (
                          <div className="flex justify-center">
                            <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium capitalize text-slate-500 shadow-sm backdrop-blur">
                              {formatDateDivider(message.createdAt)}
                            </span>
                          </div>
                        ) : null}

                        <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[85%] rounded-[16px] px-[10px] py-[9px] text-[13px] leading-5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] md:max-w-[72%] ${
                              outbound
                                ? "bg-[var(--primary)] text-white"
                                : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                            }`}
                          >
                            <p>{message.content || "-"}</p>
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
                <div className="sticky bottom-0 z-10 shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 md:static md:px-2 md:py-2">
                  <form action={composer.action}>
                    {composer.hiddenFields.map((field) => (
                      <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                    ))}

                    <div className="flex items-end gap-2 md:gap-3">
                      <textarea
                        name="message"
                        rows={1}
                        placeholder={composer.placeholder || "Escribe un mensaje..."}
                        className="flex min-h-[46px] flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-3 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[40px] md:py-2"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] md:h-10 md:w-10"
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
