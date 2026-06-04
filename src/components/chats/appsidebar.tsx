"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquareText, Search, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { SidebarHeader, SidebarInput } from "@/components/ui/sidebar";
import { type AssignedFilter, type SharedInboxConversationItem } from "./shared-inbox";
import { Label } from "../ui/label";
import { Switch } from "@base-ui/react";

type AppSidebarProps = {
  conversationItems: SharedInboxConversationItem[];
  selectedConversationId: string;
  searchAction: string;
  selectedConnectionKey?: string;
  searchQuery?: string;
  assignedFilter?: AssignedFilter;
  isManager?: boolean;
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

const ASSIGNED_FILTER_TABS: Array<{ value: AssignedFilter; label: string; managerOnly?: boolean }> = [
  { value: "mine", label: "Mías" },
  { value: "unassigned", label: "Sin asignar" },
  { value: "all", label: "Todos", managerOnly: true },
];

export function AppSidebar({
  conversationItems,
  selectedConversationId,
  searchAction,
  selectedConnectionKey = "",
  searchQuery = "",
  assignedFilter = "all",
  isManager = false,
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

  const buildFilterHref = React.useCallback(
    (value: AssignedFilter) => {
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (value !== "all") params.set("assigned", value);
      const qs = params.toString();
      return qs ? `${searchAction}?${qs}` : searchAction;
    },
    [searchAction, selectedConnectionKey, searchQuery],
  );

  const visibleTabs = ASSIGNED_FILTER_TABS.filter((tab) => isManager || !tab.managerOnly);

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
              {assignedFilter !== "all" ? <input type="hidden" name="assigned" value={assignedFilter} /> : null}
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

          <div className="mt-2.5 flex items-center gap-1 rounded-xl bg-slate-100/80 p-0.5">
            {visibleTabs.map((tab) => {
              const isActive = assignedFilter === tab.value;
              return (
                <Link
                  key={tab.value}
                  href={buildFilterHref(tab.value)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-center text-[12px] font-medium transition ${
                    isActive
                      ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
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
