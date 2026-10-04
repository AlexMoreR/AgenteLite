"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MessageSquareText, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { type AssignedFilter, type StatusFilter, type SharedInboxConversationItem } from "./shared-inbox";
import {
  FiltrosDeBandejaModal,
  queryDeFiltro,
  type ListaDeChats,
  type ModoDelFiltro,
} from "./filtros-de-bandeja-modal";
import { pedirEtiquetas } from "./chat-tags-control";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getTagBadgeColors } from "@/lib/tag-badge";
import type { EtiquetaItem } from "@/app/actions/chats-actions";
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
const PASTILLAS_A_LA_VISTA = ["all", "mine"] as const;

/**
 * La chapita de un filtro puesto: el nombre abre los filtros, solo la X lo quita.
 *
 * Antes toda la chapita era el boton de quitar: una asesora tocaba "Descartado" para ir a los
 * descartados y el filtro desaparecia. Quitar tiene que ser un gesto a proposito, sobre la X.
 */
function ChapaDeFiltro({
  children,
  className,
  alAbrir,
  alQuitar,
  tituloQuitar,
  estilo,
}: {
  children: React.ReactNode;
  className: string;
  alAbrir: () => void;
  alQuitar: () => void;
  tituloQuitar: string;
  /** Colores en linea (las etiquetas traen su propio color). */
  estilo?: React.CSSProperties;
}) {
  return (
    <span
      style={estilo}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border text-[13px] font-medium ${className}`}
    >
      <button type="button" onClick={alAbrir} className="py-1 pr-1 pl-3" title="Cambiar filtros">
        {children}
      </button>
      <button
        type="button"
        onClick={alQuitar}
        aria-label={tituloQuitar}
        title={tituloQuitar}
        className="mr-1 inline-flex size-5 items-center justify-center rounded-full opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Una vista como texto comparable: sin la conexion, la busqueda ni el chat abierto, y con los
 * parametros ordenados. Dos direcciones que muestran lo mismo dan la misma firma.
 */
function firmaDeLaVista(query: string) {
  const params = new URLSearchParams(query);
  for (const clave of ["connection", "q", "chatKey"]) params.delete(clave);
  return [...params.entries()]
    .map(([clave, valor]) => `${clave}=${valor.split(",").sort().join(",")}`)
    .sort()
    .join("&");
}

/** Cuanto hay que mantener presionada una lista para que aparezca su menu. */
const TOQUE_LARGO_MS = 450;

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
  const [modoDelFiltro, setModoDelFiltro] = React.useState<ModoDelFiltro>({ tipo: "filtrar" });
  const abrirFiltro = React.useCallback((modo: ModoDelFiltro = { tipo: "filtrar" }) => {
    setModoDelFiltro(modo);
    setFilterMenuOpen(true);
  }, []);

  /*
    LAS LISTAS, como en WhatsApp (Alex, 04-10-2026): filtros con nombre que quedan como pestañas
    arriba de los chats, se deslizan de lado, y manteniendolas presionadas se editan, se mueven o se
    borran. A diferencia de WhatsApp no se arman a mano: son filtros, se actualizan solas.
    Son de cada persona (las guarda /api/cliente/chats/filtros-guardados).
  */
  const [listas, setListas] = React.useState<ListaDeChats[]>([]);
  const [menuDeLista, setMenuDeLista] = React.useState<ListaDeChats | null>(null);
  const toqueLargo = React.useRef<{ temporizador: number | null; disparo: boolean }>({ temporizador: null, disparo: false });
  React.useEffect(() => {
    let vigente = true;
    void fetch("/api/cliente/chats/filtros-guardados", { credentials: "same-origin" })
      .then((respuesta) => respuesta.json())
      .then((datos: { ok?: boolean; filtros?: ListaDeChats[] }) => {
        if (vigente && datos.ok && Array.isArray(datos.filtros)) setListas(datos.filtros);
      })
      .catch(() => {
        // Sin listas la bandeja igual funciona.
      });
    return () => {
      vigente = false;
    };
  }, []);

  // Los nombres y colores de las etiquetas, para mostrar como chapita la que este filtrada.
  const [etiquetasDelNegocio, setEtiquetasDelNegocio] = React.useState<EtiquetaItem[]>([]);
  const hayEtiquetasFiltradas = filtros.etiquetas.length > 0;
  React.useEffect(() => {
    if (!hayEtiquetasFiltradas) return;
    let vigente = true;
    void pedirEtiquetas()
      .then((resultado) => {
        if (vigente) setEtiquetasDelNegocio(resultado.items ?? []);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [hayEtiquetasFiltradas]);

  /**
   * Los dos filtros se aplican JUNTOS, en un solo viaje.
   *
   * Antes habia un href por cada uno y cada uno arrastraba el valor actual del otro. Ahora que se
   * eligen en el mismo modal y se confirman con "Aplicar", mandarlos por separado significaria
   * dos navegaciones —y la segunda pisando a la primera.
   */
  /*
    La pastilla se pinta apenas la tocas, sin esperar al servidor.

    Cambiar de "Todas" a "Mias" es una navegacion: el servidor rehace la pantalla de Chats entera,
    que es la mas pesada que tenemos (1,4 s medidos en produccion). Hasta que volvia, la pastilla
    seguia pintada en la de antes y parecia que el toque no habia hecho nada, asi que se tocaba de
    nuevo (Alex, 28-09-2026).

    No se guarda un booleano sino DE DONDE se venia: cuando el prop del servidor deja de ser ese
    valor, la navegacion llego y la marca se descarta sola. Sin efectos y sin quedar pegada si la
    navegacion se cancela.
  */
  const [pedido, setPedido] = React.useState<{ para: AssignedFilter; desde: AssignedFilter } | null>(null);
  const filtroMostrado = pedido && pedido.desde === assignedFilter ? pedido.para : assignedFilter;

  const aplicarFiltros = React.useCallback(
    (asignacion: AssignedFilter, estado: StatusFilter, nuevos: FiltrosDeBandeja = filtros) => {
      setPedido({ para: asignacion, desde: assignedFilter });
      setFilterMenuOpen(false);
      const params = new URLSearchParams();
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      /*
        Los valores por defecto no van en la direccion: una URL corta se lee y se comparte mejor.

        El defecto es "all" desde el 15-sep-2026. Cuando era "mine", esta linea omitia justamente
        "mine" — y al invertir el defecto, tocar "Mias" dejaba de mandar nada y la bandeja volvia a
        "Todas": el chip parecia no funcionar.
      */
      if (asignacion !== "all") params.set("assigned", asignacion);
      if (estado !== "open") params.set("status", estado);
      for (const [clave, valor] of paramsDeFiltros(nuevos)) {
        params.set(clave, valor);
      }
      const qs = params.toString();
      router.push(qs ? `${searchAction}?${qs}` : searchAction, { scroll: false });
    },
    [assignedFilter, router, searchAction, selectedConnectionKey, searchQuery, filtros],
  );

  /**
   * Volver a un filtro guardado.
   *
   * Se guarda la direccion entera, asi que aplicarlo es ir a esa direccion: no se rearma campo por
   * campo. La conexion y la busqueda de ahora se conservan —uno guarda una forma de mirar, no el
   * canal en el que estaba parado ese dia.
   */
  /*
    La lista que se esta mirando: la que dice lo mismo que la direccion de ahora. Se pinta apenas se
    toca, sin esperar al servidor (la pantalla de Chats tarda en volver), igual que Todas/Mias.
  */
  const vistaActual = firmaDeLaVista(queryDeFiltro(assignedFilter, statusFilter, filtros));
  const [vistaPedida, setVistaPedida] = React.useState<{ firma: string; desde: string } | null>(null);
  const firmaMostrada = vistaPedida && vistaPedida.desde === vistaActual ? vistaPedida.firma : vistaActual;
  const listaActiva = listas.find((lista) => firmaDeLaVista(lista.query) === firmaMostrada) ?? null;

  const aplicarGuardado = React.useCallback(
    (query: string) => {
      setFilterMenuOpen(false);
      setVistaPedida({ firma: firmaDeLaVista(query), desde: vistaActual });
      const params = new URLSearchParams(query);
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const qs = params.toString();
      router.push(qs ? `${searchAction}?${qs}` : searchAction, { scroll: false });
    },
    [router, searchAction, selectedConnectionKey, searchQuery, vistaActual],
  );

  const guardarLista = React.useCallback(
    async (datos: { id?: string; nombre: string; query: string }): Promise<string | null> => {
      try {
        const respuesta = await fetch("/api/cliente/chats/filtros-guardados", {
          method: datos.id ? "PUT" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(datos),
        });
        const resultado = (await respuesta.json()) as { ok?: boolean; error?: string; filtros?: ListaDeChats[] };
        if (!resultado.ok) return resultado.error || "No se pudo guardar la lista";
        setListas(resultado.filtros ?? []);
        aplicarGuardado(datos.query);
        return null;
      } catch {
        return "No se pudo guardar la lista";
      }
    },
    [aplicarGuardado],
  );

  const borrarLista = async (lista: ListaDeChats) => {
    setMenuDeLista(null);
    setListas((actuales) => actuales.filter((otra) => otra.id !== lista.id));
    if (listaActiva?.id === lista.id) aplicarFiltros("all", "open", SIN_FILTROS);
    await fetch(`/api/cliente/chats/filtros-guardados?id=${encodeURIComponent(lista.id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
  };

  const moverLista = async (lista: ListaDeChats, hacia: -1 | 1) => {
    const indice = listas.findIndex((otra) => otra.id === lista.id);
    const destino = indice + hacia;
    if (indice < 0 || destino < 0 || destino >= listas.length) return;
    const nuevas = [...listas];
    [nuevas[indice], nuevas[destino]] = [nuevas[destino], nuevas[indice]];
    setListas(nuevas);
    setMenuDeLista(null);
    await fetch("/api/cliente/chats/filtros-guardados", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden: nuevas.map((otra) => otra.id) }),
    }).catch(() => null);
  };

  const soltarToqueLargo = () => {
    if (toqueLargo.current.temporizador) window.clearTimeout(toqueLargo.current.temporizador);
    toqueLargo.current.temporizador = null;
  };

  /** Tocar abre la lista; mantener presionado (o clic derecho) abre su menu. */
  const toquesDeLista = (lista: ListaDeChats) => ({
    onPointerDown: (evento: React.PointerEvent) => {
      if (evento.button !== 0) return;
      toqueLargo.current.disparo = false;
      soltarToqueLargo();
      toqueLargo.current.temporizador = window.setTimeout(() => {
        toqueLargo.current.disparo = true;
        toqueLargo.current.temporizador = null;
        navigator.vibrate?.(15);
        setMenuDeLista(lista);
      }, TOQUE_LARGO_MS);
    },
    onPointerUp: soltarToqueLargo,
    onPointerLeave: soltarToqueLargo,
    // Deslizar la fila de lado no es mantener presionado.
    onPointerCancel: soltarToqueLargo,
    onContextMenu: (evento: React.MouseEvent) => {
      evento.preventDefault();
      setMenuDeLista(lista);
    },
    onClick: () => {
      if (toqueLargo.current.disparo) {
        toqueLargo.current.disparo = false;
        return;
      }
      aplicarGuardado(lista.query);
    },
  });

  // El + se marca cuando NO estas en la vista por defecto: abiertas y sin filtro de asignacion.
  const filtersActive =
    statusFilter !== "open" ||
    (isManager && assignedFilter !== "all") ||
    filtros.etapas.length > 0 ||
    filtros.sinResponder ||
    filtros.etiquetas.length > 0;

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
            {/*
              Una sola fila que se desliza de lado, como las listas de WhatsApp (Alex, 04-10-2026),
              sin barra de scroll a la vista.
            */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/*
                "Todas" y "Mias" a la vista, sin abrir el modal. La que esta activa va en azul de
                la marca; la otra en contorno, para que se lea cual estas mirando.

                Todas primero, por pedido de Alex. Y sin emoticones: la palabra ya dice que es
                cada una, y los dibujos le robaban ancho al nombre y al conteo, que es lo unico
                que se mira de estas pastillas.

                "Sin asignar" sigue solo en el modal: es una vista de reparto, no del dia a dia.
              */}
              {(isManager ? PASTILLAS_A_LA_VISTA : (["mine"] as const)).map((valor) => {
                // Con una lista abierta, la pintada es la lista; volver a Todas/Mias la cierra.
                const activa = !listaActiva && filtroMostrado === valor;
                const tab = ASSIGNED_FILTER_TABS.find((item) => item.value === valor);
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() =>
                      listaActiva ? aplicarFiltros(valor, "open", SIN_FILTROS) : aplicarFiltros(valor, statusFilter)
                    }
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition ${
                      activa
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {tab?.label ?? "Todas"}
                    {assignedCounts && !listaActiva ? (
                      <span className="text-[11px] font-semibold leading-none">
                        {assignedCounts[valor]}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {/*
                Las listas de esta persona. La abierta va en azul y con su numero (el de los demas
                costaria una consulta por lista en cada recarga). Mantener presionada o clic derecho:
                editar, mover o borrar.
              */}
              {listas.map((lista) => {
                const activa = listaActiva?.id === lista.id;
                const asignadaDeLaLista = new URLSearchParams(lista.query).get("assigned") || "all";
                const cuenta =
                  activa && assignedCounts && (asignadaDeLaLista === "all" || asignadaDeLaLista === "mine" || asignadaDeLaLista === "unassigned")
                    ? assignedCounts[asignadaDeLaLista]
                    : null;
                return (
                  <button
                    key={lista.id}
                    type="button"
                    {...toquesDeLista(lista)}
                    title={`${lista.nombre} (mantén presionado para editar)`}
                    className={`inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition [-webkit-touch-callout:none] ${
                      activa
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border text-foreground/80 hover:bg-muted"
                    }`}
                  >
                    {lista.nombre}
                    {cuenta != null ? <span className="text-[11px] font-semibold leading-none">{cuenta}</span> : null}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => abrirFiltro({ tipo: "nueva" })}
                aria-label="Nueva lista"
                title="Nueva lista"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-foreground/80 transition hover:bg-muted"
              >
                <Plus className="size-4" />
              </button>

              {/* Lo filtrado a mano (sin lista) se ve como chapitas; con una lista abierta, la lista ya lo dice. */}
              {!listaActiva ? (
              <>
              {/* El estado solo aparece cuando NO es el de siempre (Abiertas): si no, seria una
                  pastilla que dice lo mismo todos los dias y no informa nada. */}
              {/*
                Se saca de un toque, como las etapas, y no dice "Todas".

                Era un texto quieto que decia "Todas" -el mismo nombre de la pastilla de asignacion-:
                una asesora lo tocaba creyendo que era esa pastilla y no pasaba nada. Ahora dice lo
                que es y al tocarlo vuelve a Abiertas.
              */}
              {statusFilter !== "open" ? (
                <ChapaDeFiltro
                  className="border-border text-muted-foreground"
                  alAbrir={() => abrirFiltro()}
                  alQuitar={() => aplicarFiltros(assignedFilter, "open")}
                  tituloQuitar="Volver a solo abiertas"
                >
                  {statusFilter === "all" ? "Abiertas y resueltas" : "Resueltas"}
                </ChapaDeFiltro>
              ) : null}

              {/*
                Lo que esta filtrado se VE, y se saca de un toque.

                Un filtro puesto que no se nota es la peor version de esto: la asesora ve pocos
                chats, no entiende por que, y termina pensando que se perdieron conversaciones.
              */}
              {filtros.etapas.map((etapa) => {
                const meta = CRM_STAGE_META[etapa];
                return (
                  <ChapaDeFiltro
                    key={etapa}
                    className={`${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
                    alAbrir={() => abrirFiltro()}
                    alQuitar={() =>
                      aplicarFiltros(assignedFilter, statusFilter, {
                        ...filtros,
                        etapas: filtros.etapas.filter((valor) => valor !== etapa),
                      })
                    }
                    tituloQuitar={`Quitar el filtro ${meta.label}`}
                  >
                    {meta.label}
                  </ChapaDeFiltro>
                );
              })}

              {filtros.sinResponder ? (
                <ChapaDeFiltro
                  className="border-primary bg-primary/10 text-primary"
                  alAbrir={() => abrirFiltro()}
                  alQuitar={() => aplicarFiltros(assignedFilter, statusFilter, { ...filtros, sinResponder: false })}
                  tituloQuitar="Quitar el filtro Sin responder"
                >
                  Sin responder
                </ChapaDeFiltro>
              ) : null}

              {filtros.etiquetas.map((id) => {
                const etiqueta = etiquetasDelNegocio.find((item) => item.id === id);
                return (
                  <ChapaDeFiltro
                    key={id}
                    className="border-transparent uppercase tracking-wide"
                    estilo={etiqueta ? getTagBadgeColors(etiqueta.color) : undefined}
                    alAbrir={() => abrirFiltro()}
                    alQuitar={() =>
                      aplicarFiltros(assignedFilter, statusFilter, {
                        ...filtros,
                        etiquetas: filtros.etiquetas.filter((valor) => valor !== id),
                      })
                    }
                    tituloQuitar={`Quitar la etiqueta ${etiqueta?.name ?? ""}`}
                  >
                    {etiqueta?.name ?? "Etiqueta"}
                  </ChapaDeFiltro>
                );
              })}
              </>
              ) : null}
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => abrirFiltro()}
                aria-label="Cambiar filtro"
                aria-expanded={filterMenuOpen}
                aria-haspopup="dialog"
                title="Cambiar filtro"
                /*
                  Un embudo, no un "+": el boton abre los filtros y un mas significa "agregar".
                  Se leia como "nueva conversacion" (Alex, 25-09-2026).
                */
                className={`relative inline-flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-muted hover:text-foreground ${
                  filterMenuOpen || filtersActive
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {filtersActive ? (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" />
                ) : null}
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
        modo={modoDelFiltro}
        isManager={isManager}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        filtros={filtros}
        assignedCounts={assignedCounts}
        alAplicar={aplicarFiltros}
        alGuardarLista={guardarLista}
      />

      {/* Lo que aparece al mantener presionada una lista, como en WhatsApp. */}
      <Dialog open={menuDeLista !== null} onOpenChange={(abierto) => !abierto && setMenuDeLista(null)}>
        <DialogContent showCloseButton={false} className="gap-0 p-1.5 sm:max-w-xs">
          <DialogHeader className="px-3 pb-2 pt-2.5">
            <DialogTitle className="truncate text-[15px] font-semibold">{menuDeLista?.nombre}</DialogTitle>
            <DialogDescription className="sr-only">Opciones de la lista</DialogDescription>
          </DialogHeader>
          {menuDeLista ? (
            <div className="flex flex-col">
              {[
                {
                  icono: <Pencil className="size-4" />,
                  texto: "Editar",
                  alTocar: () => {
                    const lista = menuDeLista;
                    setMenuDeLista(null);
                    abrirFiltro({ tipo: "editar", lista });
                  },
                },
                ...(listas.findIndex((otra) => otra.id === menuDeLista.id) > 0
                  ? [{ icono: <ChevronLeft className="size-4" />, texto: "Mover a la izquierda", alTocar: () => void moverLista(menuDeLista, -1) }]
                  : []),
                ...(listas.findIndex((otra) => otra.id === menuDeLista.id) < listas.length - 1
                  ? [{ icono: <ChevronRight className="size-4" />, texto: "Mover a la derecha", alTocar: () => void moverLista(menuDeLista, 1) }]
                  : []),
              ].map((opcion) => (
                <button
                  key={opcion.texto}
                  type="button"
                  onClick={opcion.alTocar}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] font-medium text-foreground transition hover:bg-muted"
                >
                  <span className="text-foreground/80">{opcion.icono}</span>
                  {opcion.texto}
                </button>
              ))}
              <div className="-mx-1.5 my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => void borrarLista(menuDeLista)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                <Trash2 className="size-4" />
                Eliminar
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
