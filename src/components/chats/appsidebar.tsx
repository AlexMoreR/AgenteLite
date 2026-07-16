"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListFilter, MessageSquareText, Search, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { SidebarHeader, SidebarInput } from "@/components/ui/sidebar";
import { type AssignedFilter, type StatusFilter, type SharedInboxConversationItem } from "./shared-inbox";
import { Label } from "../ui/label";
import { Switch } from "@base-ui/react";

type AppSidebarProps = {
  conversationItems: SharedInboxConversationItem[];
  selectedConversationId: string;
  searchAction: string;
  selectedConnectionKey?: string;
  searchQuery?: string;
  assignedFilter?: AssignedFilter;
  statusFilter?: StatusFilter;
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

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "open", label: "Abiertas" },
  { value: "resolved", label: "Resueltas" },
];

export function AppSidebar({
  conversationItems,
  selectedConversationId,
  searchAction,
  selectedConnectionKey = "",
  searchQuery = "",
  assignedFilter = "all",
  statusFilter = "open",
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
  const router = useRouter();
  const filterMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);
  // Selección provisional del menú (se aplica con el botón "Aplicar").
  const [draftStatus, setDraftStatus] = React.useState<StatusFilter>(statusFilter);

  React.useEffect(() => {
    setDraftStatus(statusFilter);
  }, [statusFilter]);

  // Cerrar el menú al hacer clic fuera.
  React.useEffect(() => {
    if (!filterMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filterMenuOpen]);

  const buildFilterHref = React.useCallback(
    (value: AssignedFilter) => {
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (value !== "all") params.set("assigned", value);
      if (statusFilter !== "open") params.set("status", statusFilter);
      const qs = params.toString();
      return qs ? `${searchAction}?${qs}` : searchAction;
    },
    [searchAction, selectedConnectionKey, searchQuery, statusFilter],
  );

  const buildStatusHref = React.useCallback(
    (value: StatusFilter) => {
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (assignedFilter !== "all") params.set("assigned", assignedFilter);
      // "open" es el estado por defecto (oculta resueltas) → no necesita parámetro.
      if (value !== "open") params.set("status", value);
      const qs = params.toString();
      return qs ? `${searchAction}?${qs}` : searchAction;
    },
    [searchAction, selectedConnectionKey, searchQuery, assignedFilter],
  );

  const applyStatusFilter = React.useCallback(
    (value: StatusFilter) => {
      setFilterMenuOpen(false);
      router.push(buildStatusHref(value), { scroll: false });
    },
    [buildStatusHref, router],
  );

  // El filtro "activo" (punto en el botón) es cuando NO estás en la vista por defecto (abiertas).
  const filtersActive = statusFilter !== "open";

  const visibleTabs = ASSIGNED_FILTER_TABS.filter((tab) => isManager || !tab.managerOnly);

  return (
    <aside
      className={`${mobileConversationActive ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-border bg-card p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="relative z-30 shrink-0 border-b border-border bg-card px-3 py-2 backdrop-blur-sm md:px-3 md:py-2">
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

            <div ref={filterMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterMenuOpen((open) => !open)}
                aria-label="Filtrar conversaciones"
                aria-expanded={filterMenuOpen}
                aria-haspopup="dialog"
                title="Filtrar"
                className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md transition hover:text-foreground ${
                  filterMenuOpen || filtersActive ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <ListFilter className="h-3.5 w-3.5" />
                {filtersActive ? (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
                ) : null}
              </button>

              {filterMenuOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-3 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
                  <p className="mb-2 text-[13px] font-semibold text-foreground">Filtrar conversaciones</p>

                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Estado</p>
                  <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
                    {STATUS_FILTER_OPTIONS.map((option) => {
                      const isActive = draftStatus === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDraftStatus(option.value)}
                          className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
                            isActive
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => applyStatusFilter("open")}
                      className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={() => applyStatusFilter(draftStatus)}
                      className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Filtros tipo WhatsApp: pildoras separadas, activa en verde y las
              inactivas con borde/texto gris. */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
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
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition ${
                    isActive
                      ? "border-transparent bg-emerald-100 text-emerald-700"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {countLabel != null ? (
                    <span
                      className={`text-[11px] font-semibold leading-none ${
                        isActive ? "text-emerald-700" : "text-muted-foreground"
                      }`}
                    >
                      {countLabel}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
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
