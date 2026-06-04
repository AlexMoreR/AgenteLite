"use client";

import * as React from "react";
import { MessageSquareText, Search, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { SidebarHeader, SidebarInput } from "@/components/ui/sidebar";
import { type SharedInboxConversationItem } from "./shared-inbox";
import { Label } from "../ui/label";
import { Switch } from "@base-ui/react";

type AppSidebarProps = {
  conversationItems: SharedInboxConversationItem[];
  selectedConversationId: string;
  searchAction: string;
  selectedConnectionKey?: string;
  searchInputValue: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  onSearchSubmit: () => void;
  hasMoreConversationItems?: boolean;
  isLoadingMoreConversationItems?: boolean;
  onLoadMoreConversationItems?: () => void | Promise<void>;
  mobileConversationActive?: boolean;
  emptyListTitle: string;
  emptyListDescription: string;
};

export function AppSidebar({
  conversationItems,
  selectedConversationId,
  searchAction,
  selectedConnectionKey = "",
  searchInputValue,
  searchInputRef,
  onSearchChange,
  onSearchClear,
  onSearchSubmit,
  hasMoreConversationItems = false,
  isLoadingMoreConversationItems = false,
  onLoadMoreConversationItems,
  mobileConversationActive = false,
  emptyListTitle,
  emptyListDescription,
}: AppSidebarProps) {
  const conversationListScrollRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <aside
      className={`${mobileConversationActive ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_100%)] px-3 py-2.5 backdrop-blur-sm md:px-3 md:py-3">
          <div className="flex items-center gap-2">
            <form
              className="relative flex-1"
              action={searchAction}
              onSubmit={(event) => {
                event.preventDefault();
                onSearchSubmit();
              }}
            >
              <input type="hidden" name="chatKey" value={selectedConversationId} />
              {selectedConnectionKey ? <input type="hidden" name="connection" value={selectedConnectionKey} /> : null}
              <SidebarInput
                ref={searchInputRef}
                type="text"
                name="q"
                value={searchInputValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar chats..."
                className=""
              />
              {searchInputValue ? (
                <button
                  type="button"
                  onClick={onSearchClear}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-400 transition hover:text-slate-600 focus:outline-none"
                  aria-label="Limpiar busqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </form>

          </div>
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
              hasMoreConversations={hasMoreConversationItems}
              isLoadingMoreConversations={isLoadingMoreConversationItems}
              onLoadMoreConversations={onLoadMoreConversationItems}
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
    </aside>
  );
}
