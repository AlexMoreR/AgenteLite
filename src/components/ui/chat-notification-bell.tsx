"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NotificationPermissionInline } from "@/components/chats/notification-permission-inline";

const POLL_INTERVAL_MS = 15000;
const MAX_VISIBLE_NOTIFICATIONS = 8;

type NotificationConversation = {
  key?: string;
  label?: string;
  avatarUrl?: string | null;
  incomingCount?: number | null;
  lastMessage?: string | null;
  lastMessageType?: string | null;
  lastMessageAt?: string | null;
};

type ConversationListResponse = {
  ok?: boolean;
  conversations?: NotificationConversation[];
};

function renderPreview(conversation: NotificationConversation) {
  const text = (conversation.lastMessage ?? "").trim();
  if (text) {
    return text;
  }

  switch (conversation.lastMessageType) {
    case "AUDIO":
      return "Audio";
    case "IMAGE":
      return "Foto";
    case "VIDEO":
      return "Video";
    case "STICKER":
      return "Sticker";
    case "DOCUMENT":
      return "Documento";
    default:
      return "Nuevo mensaje";
  }
}

function getInitial(label?: string) {
  const trimmed = (label ?? "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export function ChatNotificationBell({ className }: { className?: string }) {
  const [conversations, setConversations] = React.useState<NotificationConversation[]>([]);
  const [hasAccess, setHasAccess] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch("/api/cliente/chats/list?limit=40", {
          cache: "no-store",
        });

        // El usuario no tiene acceso a chats: ocultamos la campanita.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          if (!cancelled) setHasAccess(false);
          return;
        }

        const payload = (await response.json().catch(() => null)) as ConversationListResponse | null;
        if (!cancelled && payload?.ok && Array.isArray(payload.conversations)) {
          setConversations(payload.conversations);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const unreadConversations = React.useMemo(
    () =>
      conversations
        .filter((conversation) => (conversation.incomingCount ?? 0) > 0)
        .sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        }),
    [conversations],
  );

  const totalUnread = React.useMemo(
    () => unreadConversations.reduce((sum, conversation) => sum + (conversation.incomingCount ?? 0), 0),
    [unreadConversations],
  );

  if (!hasAccess) {
    return null;
  }

  const hasUnread = totalUnread > 0;
  const badgeLabel = totalUnread > 99 ? "99+" : String(totalUnread);
  const visibleConversations = unreadConversations.slice(0, MAX_VISIBLE_NOTIFICATIONS);
  const remaining = unreadConversations.length - visibleConversations.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("relative", className)}
            aria-label={hasUnread ? `${totalUnread} mensajes nuevos en chats` : "Notificaciones de chats"}
          />
        }
      >
        <Bell data-icon="inline-start" />
        {hasUnread ? (
          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 shadow-[0_1px_4px_rgba(15,23,42,0.18)]">
            <span className="text-[10px] font-semibold leading-none text-white">{badgeLabel}</span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-foreground">
          <span>Notificaciones</span>
          {hasUnread ? (
            <span className="rounded-full bg-[#ef4444]/10 px-2 py-0.5 text-[11px] font-semibold text-[#ef4444]">
              {badgeLabel}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />

        <NotificationPermissionInline />

        {visibleConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No tienes mensajes nuevos.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {visibleConversations.map((conversation) => {
              const count = conversation.incomingCount ?? 0;
              const countLabel = count > 99 ? "99+" : String(count);
              const href = conversation.key
                ? `/cliente/chats?chatKey=${encodeURIComponent(conversation.key)}`
                : "/cliente/chats";

              return (
                <DropdownMenuItem
                  key={conversation.key ?? conversation.label}
                  asChild
                  className="gap-2.5 px-3 py-2"
                >
                  <Link href={href}>
                    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[13px] font-semibold text-muted-foreground">
                      {conversation.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={conversation.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitial(conversation.label)
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {conversation.label?.trim() || "Sin nombre"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {renderPreview(conversation)}
                      </span>
                    </span>
                    <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#2563eb] px-1 text-[10px] font-semibold leading-none text-white">
                      {countLabel}
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}

        {remaining > 0 ? (
          <>
            <DropdownMenuSeparator className="mx-0 my-0" />
            <DropdownMenuItem asChild className="justify-center px-3 py-2 text-[13px] font-medium text-primary">
              <Link href="/cliente/chats">Ver todos los chats</Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
