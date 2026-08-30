"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Plus, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { type AssignedFilter, type StatusFilter, type SharedInboxConversationItem } from "./shared-inbox";
import { FiltrosDeBandejaModal } from "./filtros-de-bandeja-modal";
import {
  paramsDeFiltros,
  SIN_FILTROS,
  type FiltrosDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";

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
  filtros?: FiltrosDeBandeja;
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
  filtros = SIN_FILTROS,
  hasMoreConversationItems = false,
  isLoadingMoreConversationItems = false,
  onLoadMoreConversationItems,
  mobileConversationActive = false,
  emptyListTitle,
  emptyListDescription,
}: AppSidebarProps) {
  const conversationListScrollRef = React.useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);

  /**
   * Los dos filtros se aplican JUNTOS, en un solo viaje.
   *
   * Antes habia un href por cada uno y cada uno arrastraba el valor actual del otro. Ahora que se
   * eligen en el mismo modal y se confirman con "Aplicar", mandarlos por separado significaria
   * dos navegaciones —y la segunda pisando a la primera.
   */
  const aplicarFiltros = React.useCallback(
    (asignacion: AssignedFilter, estado: StatusFilter, nuevos: FiltrosDeBandeja = filtros) => {
      setFilterMenuOpen(false);
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      // Los valores por defecto no van en la direccion: una URL corta se lee y se comparte mejor.
      if (asignacion !== "mine") params.set("assigned", asignacion);
      if (estado !== "open") params.set("status", estado);
      for (const [clave, valor] of paramsDeFiltros(nuevos)) {
        params.set(clave, valor);
      }
      const qs = params.toString();
      router.push(qs ? `${searchAction}?${qs}` : searchAction, { scroll: false });
    },
    [router, searchAction, selectedConnectionKey, searchQuery, filtros],
  );

  /**
   * Volver a un filtro guardado.
   *
   * Se guarda la direccion entera, asi que aplicarlo es ir a esa direccion: no se rearma campo por
   * campo. La conexion y la busqueda de ahora se conservan —uno guarda una forma de mirar, no el
   * canal en el que estaba parado ese dia.
   */
  const aplicarGuardado = React.useCallback(
    (query: string) => {
      setFilterMenuOpen(false);
      const params = new URLSearchParams(query);
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const qs = params.toString();
      router.push(qs ? `${searchAction}?${qs}` : searchAction, { scroll: false });
    },
    [router, searchAction, selectedConnectionKey, searchQuery],
  );

  // El + se marca cuando NO estas en la vista por defecto: abiertas y sin filtro de asignacion.
  const filtersActive =
    statusFilter !== "open" ||
    (isManager && assignedFilter !== "mine") ||
    filtros.etapas.length > 0 ||
    filtros.sinResponder;

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

              {/*
                Lo que esta filtrado se VE, y se saca de un toque.

                Un filtro puesto que no se nota es la peor version de esto: la asesora ve pocos
                chats, no entiende por que, y termina pensando que se perdieron conversaciones.
              */}
              {filtros.etapas.map((etapa) => {
                const meta = CRM_STAGE_META[etapa];
                return (
                  <button
                    key={etapa}
                    type="button"
                    onClick={() =>
                      aplicarFiltros(assignedFilter, statusFilter, {
                        ...filtros,
                        etapas: filtros.etapas.filter((valor) => valor !== etapa),
                      })
                    }
                    title={`Quitar el filtro ${meta.label}`}
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
                  >
                    {meta.label}
                    <X className="h-3 w-3 opacity-60" />
                  </button>
                );
              })}

              {filtros.sinResponder ? (
                <button
                  type="button"
                  onClick={() =>
                    aplicarFiltros(assignedFilter, statusFilter, { ...filtros, sinResponder: false })
                  }
                  title="Quitar el filtro Sin responder"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary bg-primary/10 px-3 py-1 text-[13px] font-medium text-primary"
                >
                  Sin responder
                  <X className="h-3 w-3 opacity-60" />
                </button>
              ) : null}
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setFilterMenuOpen(true)}
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

      <FiltrosDeBandejaModal
        abierto={filterMenuOpen}
        alCerrar={() => setFilterMenuOpen(false)}
        isManager={isManager}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        filtros={filtros}
        assignedCounts={assignedCounts}
        alAplicar={aplicarFiltros}
        alAplicarGuardado={aplicarGuardado}
      />
    </aside>
  );
}
