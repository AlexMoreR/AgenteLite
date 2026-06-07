"use client";

import * as React from "react";
import Link from "next/link";
import { ListFilter, MessageSquareText, Search, X } from "lucide-react";
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
  assignedCounts?: { mine: number; unassigned: number; all: number } | null;
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
  { value: "unassigned", label: "Sin asignar", managerOnly: true },
  { value: "all", label: "Todas", managerOnly: true },
];

export function AppSidebar({
  conversationItems,
  selectedConversationId,
  searchAction,
  selectedConnectionKey = "",
  searchQuery = "",
  assignedFilter = "all",
  assignedCounts = null,
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
  const [filtersOpen, setFiltersOpen] = React.useState(true);

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
      className={`${mobileConversationActive ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-border bg-card p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="shrink-0 border-b border-border bg-card px-3 py-2 backdrop-blur-sm md:px-3 md:py-2">
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
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition hover:text-muted-foreground focus:outline-none"
                  aria-label="Limpiar busqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </form>

            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-label="Filtrar"
              aria-pressed={filtersOpen}
              title="Filtrar"
              className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md transition hover:text-foreground ${
                filtersOpen ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" />
            </button>
          </div>

          {filtersOpen ? (
          <div className="mt-1 flex items-center gap-1 rounded-xl bg-muted p-0.5">
            {visibleTabs.map((tab) => {
              const isActive = assignedFilter === tab.value;
              const count = assignedCounts ? assignedCounts[tab.value] : null;
              const countLabel = count != null ? (count > 99 ? "99+" : String(count)) : null;
              return (
                <Link
                  key={tab.value}
                  href={buildFilterHref(tab.value)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-center text-[13px] font-medium transition ${
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {countLabel != null ? (
                    <span className="text-[10px] font-semibold leading-none text-foreground">
                      {countLabel}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
          ) : null}
        </div>

        <div
          ref={conversationListScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-border [-webkit-overflow-scrolling:touch]"
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
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">{emptyListTitle}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{emptyListDescription}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
