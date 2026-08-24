"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Plus } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { SidebarHeader } from "@/components/ui/sidebar";
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

/** Las que se ven sin abrir el modal, en este orden. */
const PASTILLAS_A_LA_VISTA = ["mine", "all"] as const;

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
  assignedFilter = "mine",
  statusFilter = "open",
  assignedCounts = null,
  isManager = false,
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
  const [draftAssigned, setDraftAssigned] = React.useState<AssignedFilter>(assignedFilter);

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

  /**
   * Los dos filtros se aplican JUNTOS, en un solo viaje.
   *
   * Antes habia un href por cada uno y cada uno arrastraba el valor actual del otro. Ahora que se
   * eligen en el mismo modal y se confirman con "Aplicar", mandarlos por separado significaria
   * dos navegaciones —y la segunda pisando a la primera.
   */
  const aplicarFiltros = React.useCallback(
    (asignacion: AssignedFilter, estado: StatusFilter) => {
      setFilterMenuOpen(false);
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      // Los valores por defecto no van en la direccion: una URL corta se lee y se comparte mejor.
      if (asignacion !== "mine") params.set("assigned", asignacion);
      if (estado !== "open") params.set("status", estado);
      const qs = params.toString();
      router.push(qs ? `${searchAction}?${qs}` : searchAction, { scroll: false });
    },
    [router, searchAction, selectedConnectionKey, searchQuery],
  );

  // El + se marca cuando NO estas en la vista por defecto: abiertas y sin filtro de asignacion.
  const filtersActive = statusFilter !== "open" || (isManager && assignedFilter !== "mine");

  const visibleTabs = ASSIGNED_FILTER_TABS.filter((tab) => isManager || !tab.managerOnly);

  return (
    <aside
      className={`${mobileConversationActive ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-border bg-card p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="relative z-30 shrink-0 border-b border-border bg-card px-3 py-2 backdrop-blur-sm md:px-3 md:py-2">
          {/*
            Solo el filtro PUESTO, y un + para cambiarlo.

            (La caja "Buscar chats..." tambien salio de aca: ahora se busca desde la lupa del
            encabezado, con Ctrl+K, que ademas cruza contactos y productos.)

            Antes estaban las tres pastillas siempre a la vista: en un celular no entraban y
            aparecia una barra de scroll horizontal sobre la lista, que es lo ultimo que uno espera
            tocar en una bandeja. Ahora la fila dice en que estas parado y nada mas; el resto vive
            en el modal, con sus conteos.
          */}
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {/*
                "Mias" y "Todas" a la vista, con Mias primero: el trabajo de una asesora empieza
                por lo suyo, y verlo requeria abrir el modal de filtros. La que esta activa va en
                azul de la marca; la otra en contorno, para que se lea cual estas mirando.

                "Sin asignar" sigue solo en el modal: es una vista de reparto, no del dia a dia.
              */}
              {(isManager ? PASTILLAS_A_LA_VISTA : (["mine"] as const)).map((valor) => {
                const activa = assignedFilter === valor;
                const tab = ASSIGNED_FILTER_TABS.find((item) => item.value === valor);
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => aplicarFiltros(valor, statusFilter)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition ${
                      activa
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span aria-hidden="true">{valor === "mine" ? "🙋" : "💬"}</span>
                    {tab?.label ?? "Todas"}
                    {assignedCounts ? (
                      <span className="text-[11px] font-semibold leading-none">
                        {assignedCounts[valor]}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {/* El estado solo aparece cuando NO es el de siempre (Abiertas): si no, seria una
                  pastilla que dice lo mismo todos los dias y no informa nada. */}
              {statusFilter !== "open" ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1 text-[13px] font-medium text-muted-foreground">
                  {STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label}
                </span>
              ) : null}
            </div>

            <div ref={filterMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDraftAssigned(assignedFilter);
                  setDraftStatus(statusFilter);
                  setFilterMenuOpen((open) => !open);
                }}
                aria-label="Cambiar filtro"
                aria-expanded={filterMenuOpen}
                aria-haspopup="dialog"
                title="Cambiar filtro"
                className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed transition hover:border-solid hover:bg-muted hover:text-foreground ${
                  filterMenuOpen || filtersActive
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              {filterMenuOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-3 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
                  <p className="mb-2 text-[13px] font-semibold text-foreground">Filtrar conversaciones</p>

                  {/* La asignacion se elige aca ahora que no esta a la vista. Cada opcion trae su
                      conteo: es la mitad del valor de este filtro —saber que hay 980 sin dueño
                      es la razon por la que uno lo abre. */}
                  {visibleTabs.length > 1 ? (
                    <>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Asignación
                      </p>
                      <div className="mb-3 space-y-0.5">
                        {visibleTabs.map((tab) => {
                          const elegida = draftAssigned === tab.value;
                          const count = assignedCounts ? assignedCounts[tab.value] : null;
                          return (
                            <button
                              key={tab.value}
                              type="button"
                              onClick={() => setDraftAssigned(tab.value)}
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition ${
                                elegida
                                  ? "bg-emerald-100 font-medium text-black"
                                  : "text-foreground hover:bg-muted"
                              }`}
                            >
                              <span>{tab.label}</span>
                              {count != null ? (
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {count}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

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
                      onClick={() => aplicarFiltros("mine", "open")}
                      className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={() => aplicarFiltros(draftAssigned, draftStatus)}
                      className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
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
