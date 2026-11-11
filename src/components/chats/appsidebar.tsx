"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, EyeOff, MessageSquareText, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { ConversationList } from "@/components/chats/conversation-list";
import { ChatsRecientes, MensajesEncontradosLista, type ChatParaAbrir } from "./buscador-de-chats-secciones";
import { useChatsRecientes } from "./busqueda-de-chats-store";
import type { MensajeEncontrado } from "./chat-inbox-types";
import { type AssignedFilter, type StatusFilter, type SharedInboxConversationItem } from "./shared-inbox";
import {
  FiltrosDeBandejaModal,
  queryDeFiltro,
  type ListaDeChats,
  type ModoDelFiltro,
} from "./filtros-de-bandeja-modal";
import { nombresDeLosCatalogos, useCatalogosDeFiltro } from "./catalogos-de-filtro";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getTagBadgeColors } from "@/lib/tag-badge";
import {
  firmaDeLaVista,
  hayFiltrosPuestos,
  listaQueSeEstaMirando,
  paramsDeFiltros,
  SIN_FILTROS,
  textoDeCondicion,
  type FiltrosDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import { filtroSinResponderPuesto } from "@/features/chats/domain/sin-responder";
import {
  ETIQUETAS_DE_PASTILLAS,
  SIN_PREFERENCIA,
  claveDeLista,
  esPastillaFija,
  idDeLista,
  limpiarPreferencia,
  movimientosPosibles,
  moverPastilla,
  mostrarPastilla,
  ocultarPastilla,
  pastillasDeLaFila,
  type ClaveDePastilla,
  type PastillaFija,
  type PreferenciaDePastillas,
} from "@/features/chats/domain/orden-de-las-pastillas";
import { hrefDeEsperando } from "./chat-inbox-conversation-utils";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import { iniciarMedicion, terminarMedicionAlPintar } from "@/lib/metricas-chats";
import { esArrastre, filaDesborda, movimientoDeLaRueda } from "./deslizar-fila-de-pastillas";
import { guardarFotoDeLaBandeja, hayFotoDeLaBandeja, quitarFotoDeLaBandeja } from "./guardado-local/foto-de-la-bandeja";
import { ALTO_DE_FILA } from "./ventana-de-la-lista";

type AppSidebarProps = {
  conversationItems: SharedInboxConversationItem[];
  selectedConversationId: string;
  searchAction: string;
  selectedConnectionKey?: string;
  searchQuery?: string;
  assignedFilter?: AssignedFilter;
  statusFilter?: StatusFilter;
  assignedCounts?: { mine: number; unassigned: number; all: number; sinResponder?: number; noLeido?: number } | null;
  /** La vista "Esperando" (`espera=1`) esta puesta. */
  enEspera?: boolean;
  /** `espera.mine` y `espera.all` del ultimo /counts. null = sin dato: la pastilla va sin numero. */
  numerosDeEspera?: { mine: number; all: number } | null;
  isManager?: boolean;
  filtros?: FiltrosDeBandeja;
  hasMoreConversationItems?: boolean;
  isLoadingMoreConversationItems?: boolean;
  onLoadMoreConversationItems?: () => void | Promise<void>;
  mobileConversationActive?: boolean;
  emptyListTitle: string;
  emptyListDescription: string;
  /**
   * Cambiar de pestaña o filtro SIN navegar: la bandeja pide solo la lista y actualiza la URL.
   * Sin esto se cae al router.push de antes (la pantalla entera).
   */
  alCambiarVista?: (href: string) => void;
  /** La lista que se ve es la del filtro anterior: va atenuada y con siluetas encima. */
  listaAtenuada?: boolean;
  /** Sube cada vez que la lista se reemplaza por un cambio de filtro (ver ConversationList). */
  versionDeVista?: number;
  /** El texto de la caja "Buscar chats" (solo chats; la lupa del encabezado es la busqueda general). */
  busqueda?: string;
  alBuscar?: (valor: string) => void;
  alBorrarBusqueda?: () => void;
  refBuscador?: React.RefObject<HTMLInputElement | null>;
  /** Seccion "Mensajes" del buscador: los mensajes que contienen lo escrito. */
  mensajesEncontrados?: MensajeEncontrado[];
  /** Abrir un chat desde el buscador (reciente o mensaje encontrado, con el mensaje al que ir). */
  alAbrirDesdeElBuscador?: (chat: ChatParaAbrir, messageId?: string) => void;
  /**
   * Las listas y el orden de la fila de esta persona, leidos por el SERVIDOR con la pagina: la fila
   * sale completa desde el primer pintado, sin esperar /filtros-guardados (2,5 s medido). Sin esto se
   * piden al montar, como antes.
   */
  pastillasIniciales?: { listas: ListaDeChats[]; preferencia: PreferenciaDePastillas } | null;
};

// En el celular la caja se esconde al bajar la lista y vuelve al subir, como en WhatsApp.
const MOVIL = "(max-width: 767px)";
const BAJADA_PARA_ESCONDER_PX = 8;
const ARRIBA_DEL_TODO_PX = 48;

/**
 * La caja "Buscar chats", arriba de las pastillas.
 *
 * Filtra al instante lo que ya esta cargado (nombre, numero y ultimo mensaje) y, tras una pausa,
 * pide al servidor los que no estan cargados o coinciden por un mensaje (ver shared-inbox). Esc
 * borra. El texto va a 16 px en el celular: con menos, iOS hace zoom al tocar la caja.
 */
function BuscadorDeChats({
  valor,
  alCambiar,
  alBorrar,
  refInput,
  alCambiarFoco,
}: {
  valor: string;
  alCambiar: (valor: string) => void;
  alBorrar: () => void;
  refInput?: React.RefObject<HTMLInputElement | null>;
  alCambiarFoco: (enfocado: boolean) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-full bg-muted px-3 text-muted-foreground focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/40">
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <input
        ref={refInput}
        type="search"
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Escape" && valor) {
            evento.preventDefault();
            alBorrar();
          }
        }}
        onFocus={() => alCambiarFoco(true)}
        onBlur={() => alCambiarFoco(false)}
        placeholder="Buscar chats"
        aria-label="Buscar chats"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {valor ? (
        <button
          type="button"
          onClick={alBorrar}
          aria-label="Borrar búsqueda"
          title="Borrar búsqueda"
          className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full transition hover:bg-black/10 hover:text-foreground dark:hover:bg-white/15"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const FILAS_EN_SILUETA = 6;

/*
  Las pastillas fijas, quien ve cual y su orden por defecto viven en
  features/chats/domain/orden-de-las-pastillas.ts (la asesora no ve Todas ni Sin asignar).
*/

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

/** Cuanto hay que mantener presionada una pastilla para que aparezca su menu. */
const TOQUE_LARGO_MS = 450;

/** Si el orden de la fila no llega en este tiempo, se dibuja la de por defecto. */
const TOPE_PARA_DIBUJAR_LA_FILA_MS = 1500;

/*
  Memorizada: la bandeja (shared-inbox) se re-dibuja con cada cosa del chat abierto -un mensaje que
  llega, el compositor, el estado de envio-, y sin memo eso re-dibujaba tambien toda la lista de
  chats aunque nada de la lista hubiera cambiado. Las props que recibe son estables.
*/
export const AppSidebar = React.memo(function AppSidebar({
  conversationItems,
  selectedConversationId,
  searchAction,
  selectedConnectionKey = "",
  searchQuery = "",
  assignedFilter = "all",
  statusFilter = "open",
  assignedCounts = null,
  enEspera = false,
  isManager = false,
  filtros = SIN_FILTROS,
  hasMoreConversationItems = false,
  isLoadingMoreConversationItems = false,
  onLoadMoreConversationItems,
  mobileConversationActive = false,
  emptyListTitle,
  emptyListDescription,
  alCambiarVista,
  listaAtenuada = false,
  versionDeVista = 0,
  busqueda = "",
  alBuscar,
  alBorrarBusqueda,
  refBuscador,
  mensajesEncontrados = [],
  alAbrirDesdeElBuscador,
  pastillasIniciales = null,
}: AppSidebarProps) {
  const conversationListScrollRef = React.useRef<HTMLDivElement | null>(null);

  /*
    Esconder la caja al bajar (solo celular). Se mira el scroll con un listener pasivo y un
    requestAnimationFrame para no trabar el desplazamiento, y el estado solo cambia cuando la caja
    cambia de verdad. Nunca se esconde con la caja enfocada: el teclado cambia el alto de la
    pantalla y la caja se iria de debajo del dedo.
  */
  const [buscadorEscondido, setBuscadorEscondido] = React.useState(false);
  const buscadorEnfocadoRef = React.useRef(false);
  React.useEffect(() => {
    const lista = conversationListScrollRef.current;
    if (!lista || typeof window === "undefined" || !window.matchMedia) return;
    const movil = window.matchMedia(MOVIL);
    let ultimoScroll = lista.scrollTop;
    let cuadro: number | null = null;

    const revisar = () => {
      cuadro = null;
      const actual = lista.scrollTop;
      const delta = actual - ultimoScroll;
      ultimoScroll = actual;
      if (!movil.matches || buscadorEnfocadoRef.current || actual < ARRIBA_DEL_TODO_PX) {
        setBuscadorEscondido(false);
      } else if (delta > BAJADA_PARA_ESCONDER_PX) {
        setBuscadorEscondido(true);
      } else if (delta < 0) {
        setBuscadorEscondido(false);
      }
    };
    const alDesplazar = () => {
      if (cuadro === null) cuadro = window.requestAnimationFrame(revisar);
    };
    const alCambiarPantalla = () => {
      if (!movil.matches) setBuscadorEscondido(false);
    };

    lista.addEventListener("scroll", alDesplazar, { passive: true });
    movil.addEventListener("change", alCambiarPantalla);
    return () => {
      lista.removeEventListener("scroll", alDesplazar);
      movil.removeEventListener("change", alCambiarPantalla);
      if (cuadro !== null) window.cancelAnimationFrame(cuadro);
    };
  }, []);
  /*
    Las busquedas recientes, como en WhatsApp: aparecen al tocar la caja (vacia) y se QUEDAN
    aunque se cierre el teclado. Con "enfocada" a secas, en el celular se iban apenas bajaba el
    teclado (Alex, 19-10-2026: "aparece pero se quita al rato"). Se van al abrir un chat, al
    escribir o al tocar la lista.
  */
  const [recientesDesde, setRecientesDesde] = React.useState<{ chat: string } | null>(null);
  const chatsRecientes = useChatsRecientes();
  const alCambiarFocoDelBuscador = React.useCallback(
    (enfocado: boolean) => {
      buscadorEnfocadoRef.current = enfocado;
      if (enfocado) {
        setBuscadorEscondido(false);
        setRecientesDesde({ chat: selectedConversationId ?? "" });
      }
    },
    [selectedConversationId],
  );
  const verRecientes =
    recientesDesde !== null &&
    // Abrir un chat (desde donde sea) las cierra.
    recientesDesde.chat === (selectedConversationId ?? "") &&
    !busqueda.trim() &&
    chatsRecientes.length > 0 &&
    Boolean(alAbrirDesdeElBuscador);
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
  const [listas, setListas] = React.useState<ListaDeChats[]>(() => pastillasIniciales?.listas ?? []);
  /*
    LA FILA DE PASTILLAS (Alex, 10-11-2026): las fijas (Todas, Mias, No leido, Sin responder, Sin
    asignar) y las listas en UNA sola fila que cada persona ordena y en la que oculta las fijas que no
    usa. El orden y las ocultas son de cada persona (AppSetting `chats:pastillas:<userId>`) y llegan
    en el mismo pedido que las listas. Las reglas: features/chats/domain/orden-de-las-pastillas.ts.

    La fila espera a ese pedido (con un tope corto) para no dibujarse en el orden por defecto y
    despues saltar al de la persona. El + queda siempre, asi el alto de la fila no cambia.
  */
  const [preferencia, setPreferencia] = React.useState<PreferenciaDePastillas>(
    () => pastillasIniciales?.preferencia ?? SIN_PREFERENCIA,
  );
  /*
    Sin brincos (Alex, 10-11-2026): la fila se dibuja SIEMPRE (con su ancho), pero invisible hasta
    que este completa. Con las pastillas del servidor se muestra antes del primer pintado del cliente,
    ya con los numeros guardados en el equipo (los pone la bandeja en su useLayoutEffect, ver
    conteos-guardados.ts): aparece una sola vez, completa, y despues solo cambian los numeros.
  */
  const [filaLista, setFilaLista] = React.useState(false);
  const pastillasDelServidor = pastillasIniciales !== null;
  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a proposito antes del primer pintado
    if (pastillasDelServidor) setFilaLista(true);
  }, [pastillasDelServidor]);
  const [menuDePastilla, setMenuDePastilla] = React.useState<ClaveDePastilla | null>(null);
  const [verOcultas, setVerOcultas] = React.useState(false);
  const toqueLargo = React.useRef<{ temporizador: number | null; disparo: boolean }>({ temporizador: null, disparo: false });

  /*
    DESLIZAR LA FILA CON EL MOUSE (Alex, 10-11-2026). En el celular se desliza con el dedo; en el
    computador la barra esta escondida y no habia como llegar a las pastillas que no caben. Ahora
    se arrastra (solo con el mouse: el dedo sigue con el scroll nativo) y la rueda la mueve de lado.
  */
  const filaRef = React.useRef<HTMLDivElement | null>(null);
  const arrastre = React.useRef<{
    inicioX: number;
    scrollInicial: number;
    arrastrando: boolean;
    /** El clic que suelta un arrastre no activa la pastilla. */
    tragarClic: boolean;
    soltar: (() => void) | null;
  }>({ inicioX: 0, scrollInicial: 0, arrastrando: false, tragarClic: false, soltar: null });
  const [arrastrandoFila, setArrastrandoFila] = React.useState(false);
  // Para la manito: solo si de verdad hay pastillas que no caben. Se mide al pasar el mouse.
  const [filaSeDesborda, setFilaSeDesborda] = React.useState(false);
  React.useEffect(() => {
    const fila = filaRef.current;
    if (!fila) return;
    // Nativo y no pasivo: el onWheel de React es pasivo y no deja frenar el scroll de la pagina.
    const alGirarLaRueda = (evento: WheelEvent) => {
      if (evento.ctrlKey) return; // Ctrl + rueda es el zoom del navegador.
      const { mover, frenarPagina } = movimientoDeLaRueda(evento, fila);
      if (!frenarPagina) return;
      evento.preventDefault();
      fila.scrollLeft += mover;
    };
    fila.addEventListener("wheel", alGirarLaRueda, { passive: false });
    const estado = arrastre.current;
    return () => {
      fila.removeEventListener("wheel", alGirarLaRueda);
      estado.soltar?.();
    };
  }, []);
  React.useEffect(() => {
    // Ya vinieron con la pagina: no se piden de nuevo (se vuelven a pedir al guardar o borrar una lista).
    if (pastillasDelServidor) return;
    let vigente = true;
    const tope = window.setTimeout(() => setFilaLista(true), TOPE_PARA_DIBUJAR_LA_FILA_MS);
    void fetch("/api/cliente/chats/filtros-guardados", { credentials: "same-origin" })
      .then((respuesta) => respuesta.json())
      .then((datos: { ok?: boolean; filtros?: ListaDeChats[]; pastillas?: unknown }) => {
        if (!vigente || !datos.ok || !Array.isArray(datos.filtros)) return;
        setListas(datos.filtros);
        // Lo que llega se limpia igual que en el servidor: datos raros caen al orden por defecto.
        setPreferencia(limpiarPreferencia(datos.pastillas ?? null, datos.filtros.map((lista) => lista.id)));
      })
      .catch(() => {
        // Sin listas la bandeja igual funciona, con el orden por defecto.
      })
      .finally(() => {
        window.clearTimeout(tope);
        if (vigente) setFilaLista(true);
      });
    return () => {
      vigente = false;
      window.clearTimeout(tope);
    };
  }, [pastillasDelServidor]);

  const contextoDeLaFila = React.useMemo(
    () => ({ isManager, idsDeListas: listas.map((lista) => lista.id) }),
    [isManager, listas],
  );
  const { visibles: pastillasVisibles, ocultas: pastillasOcultas } = React.useMemo(
    () => pastillasDeLaFila(preferencia, contextoDeLaFila),
    [preferencia, contextoDeLaFila],
  );

  /*
    LA FOTO DE LA BANDEJA (Alex, 11-11-2026: "que la copia guardada sea IDENTICA a la lista final").
    Ver guardado-local/foto-de-la-bandeja.ts.

    QUITARLA: al abrir, la foto tapa esta bandeja mientras se arma. Recien con la fila de pastillas
    completa (filaLista) y dos cuadros despues -cuando ya se aplicaron los fijados y los numeros
    guardados, que llegan en efectos de la bandeja- lo de abajo es igual a la foto y se saca.

    GUARDARLA: con la lista quieta (arriba del todo, sin buscar, sin atenuar), 1,5 s despues del
    ultimo cambio y cuando el navegador esta libre; y al esconder la app (cerrarla en el celular), que
    es justo lo que se va a ver al volver a abrirla.
  */
  const refDeLaBandeja = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!filaLista) return;
    let segundo = 0;
    const primero = window.requestAnimationFrame(() => {
      segundo = window.requestAnimationFrame(() => quitarFotoDeLaBandeja());
    });
    return () => {
      window.cancelAnimationFrame(primero);
      window.cancelAnimationFrame(segundo);
    };
  }, [filaLista]);

  const listaQuietaParaLaFoto = filaLista && !listaAtenuada && !busqueda.trim() && !buscadorEscondido && !mobileConversationActive;
  const tomarFotoRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    tomarFotoRef.current = () => {
      const bandeja = refDeLaBandeja.current;
      const lista = conversationListScrollRef.current;
      if (!listaQuietaParaLaFoto || !bandeja || !lista || lista.scrollTop > 1 || hayFotoDeLaBandeja()) return;
      guardarFotoDeLaBandeja(bandeja, lista, ALTO_DE_FILA);
    };
  });
  React.useEffect(() => {
    if (!listaQuietaParaLaFoto || conversationItems.length === 0) return;
    let idle: number | null = null;
    const espera = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(() => tomarFotoRef.current(), { timeout: 2000 });
      } else {
        tomarFotoRef.current();
      }
    }, 1500);
    return () => {
      window.clearTimeout(espera);
      if (idle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, [listaQuietaParaLaFoto, conversationItems, assignedCounts, pastillasVisibles, versionDeVista]);
  React.useEffect(() => {
    const alEsconder = () => {
      if (document.visibilityState === "hidden") tomarFotoRef.current();
    };
    document.addEventListener("visibilitychange", alEsconder);
    window.addEventListener("pagehide", alEsconder);
    return () => {
      document.removeEventListener("visibilitychange", alEsconder);
      window.removeEventListener("pagehide", alEsconder);
    };
  }, []);

  /** Se aplica en el acto y se guarda de fondo; si no se guarda, la proxima carga trae lo de antes. */
  const guardarPreferencia = React.useCallback((nueva: PreferenciaDePastillas) => {
    setPreferencia(nueva);
    void fetch("/api/cliente/chats/pastillas", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nueva),
    }).catch(() => null);
  }, []);

  // Los nombres (etiquetas, equipo, lineas) para las chapitas de las condiciones puestas.
  const catalogosDeFiltro = useCatalogosDeFiltro(hayFiltrosPuestos(filtros), isManager);
  const nombresDeFiltro = nombresDeLosCatalogos(catalogosDeFiltro);

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

  // Medicion: el filtro del servidor ya es el pedido, o sea la lista nueva llego y se pinta. Con
  // alCambiarVista la cierra la bandeja, cuando la lista nueva queda puesta (aca seria 0 ms).
  React.useEffect(() => {
    if (alCambiarVista) return;
    terminarMedicionAlPintar(`pestana:${assignedFilter}`, "cambiar_pestana", {
      filtro: assignedFilter.startsWith("user:") ? "asesora" : assignedFilter,
    });
  }, [assignedFilter, alCambiarVista]);

  /*
    Ir a una vista (pestaña, estado, filtros o lista guardada).

    Antes era router.push: el servidor rehacia la pantalla de Chats entera (4 a 9 pedidos, ~40-75
    consultas, 2-4 s en el celular sin ningun aviso). Ahora la bandeja pide solo la lista y cambia
    la URL sin navegar (ver alCambiarVista en shared-inbox).
  */
  const irA = React.useCallback(
    (href: string) => {
      if (alCambiarVista) {
        alCambiarVista(href);
        return;
      }
      router.push(href, { scroll: false });
    },
    [alCambiarVista, router],
  );

  // La lista guardada que se acaba de tocar (ver vistaActual, mas abajo).
  const [vistaPedida, setVistaPedida] = React.useState<{ firma: string; desde: string } | null>(null);

  const aplicarFiltros = React.useCallback(
    (asignacion: AssignedFilter, estado: StatusFilter, nuevos: FiltrosDeBandeja = filtros) => {
      // Medicion: toque en Todas/Mias -> lista pintada con el filtro nuevo (efecto de abajo).
      if (asignacion !== assignedFilter) {
        iniciarMedicion(`pestana:${asignacion}`);
      }
      setPedido({ para: asignacion, desde: assignedFilter });
      /*
        Tocar Todas/Mias o aplicar un filtro suelta la lista que se habia tocado. Si no, cuando la
        lista y la pestaña muestran lo mismo, la vista de ahora no cambia y la lista quedaba pegada
        en azul para siempre (13-10-2026).
      */
      setVistaPedida(null);
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
      irA(qs ? `${searchAction}?${qs}` : searchAction);
    },
    [assignedFilter, irA, searchAction, selectedConnectionKey, searchQuery, filtros],
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
  const firmaMostrada = vistaPedida && vistaPedida.desde === vistaActual ? vistaPedida.firma : vistaActual;
  // En "Esperando" no hay lista guardada abierta: la vista es otra aunque la pestaña coincida.
  const listaActiva = enEspera ? null : listaQueSeEstaMirando(listas, firmaMostrada);

  const aplicarGuardado = React.useCallback(
    (query: string) => {
      setFilterMenuOpen(false);
      setVistaPedida({ firma: firmaDeLaVista(query), desde: vistaActual });
      const params = new URLSearchParams(query);
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const qs = params.toString();
      irA(qs ? `${searchAction}?${qs}` : searchAction);
    },
    [irA, searchAction, selectedConnectionKey, searchQuery, vistaActual],
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
    setMenuDePastilla(null);
    // Sale tambien del orden de la fila: ordenCompleto solo deja las listas que existen.
    setListas((actuales) => actuales.filter((otra) => otra.id !== lista.id));
    if (listaActiva?.id === lista.id) aplicarFiltros("all", "open", SIN_FILTROS);
    await fetch(`/api/cliente/chats/filtros-guardados?id=${encodeURIComponent(lista.id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
  };

  /** Mover una pastilla (fija o lista) un lugar, saltando las ocultas. */
  const moverEnLaFila = (clave: ClaveDePastilla, hacia: -1 | 1) => {
    setMenuDePastilla(null);
    const nueva = moverPastilla(preferencia, contextoDeLaFila, clave, hacia);
    if (nueva) guardarPreferencia(nueva);
  };

  const ocultarDeLaFila = (clave: PastillaFija) => {
    setMenuDePastilla(null);
    guardarPreferencia(ocultarPastilla(preferencia, contextoDeLaFila, clave));
  };

  /** Volver a mostrar una oculta (o todas). Se cierra el cuadro cuando ya no queda ninguna. */
  const mostrarEnLaFila = (clave?: PastillaFija) => {
    const nueva = mostrarPastilla(preferencia, contextoDeLaFila, clave);
    guardarPreferencia(nueva);
    if (pastillasDeLaFila(nueva, contextoDeLaFila).ocultas.length === 0) setVerOcultas(false);
  };

  const soltarToqueLargo = () => {
    if (toqueLargo.current.temporizador) window.clearTimeout(toqueLargo.current.temporizador);
    toqueLargo.current.temporizador = null;
  };

  /** Mira si la fila tiene pastillas que no caben, para mostrar la manito. Solo con el mouse. */
  const medirLaFila = (evento: React.PointerEvent<HTMLDivElement>) => {
    if (evento.pointerType !== "mouse") return;
    setFilaSeDesborda(filaDesborda(evento.currentTarget));
  };

  /*
    Arrastrar la fila con el mouse. Se sigue el mouse en `window` (y no con setPointerCapture, que
    cambia a quien le llega el clic) para no perderlo si sale de la fila. Hasta pasar los 5 px no
    pasa nada: el clic y el toque largo de la pastilla siguen igual.
  */
  const empezarArrastre = (evento: React.PointerEvent<HTMLDivElement>) => {
    if (evento.pointerType !== "mouse" || evento.button !== 0) return;
    const fila = evento.currentTarget;
    const estado = arrastre.current;
    estado.soltar?.();
    estado.tragarClic = false;
    if (!filaDesborda(fila)) return;
    estado.inicioX = evento.clientX;
    estado.scrollInicial = fila.scrollLeft;
    estado.arrastrando = false;

    const alMover = (movimiento: PointerEvent) => {
      const desplazamiento = movimiento.clientX - estado.inicioX;
      if (!estado.arrastrando) {
        if (!esArrastre(desplazamiento)) return;
        estado.arrastrando = true;
        // Empezo un arrastre de verdad: ya no es mantener presionada la pastilla.
        soltarToqueLargo();
        setArrastrandoFila(true);
      }
      movimiento.preventDefault();
      fila.scrollLeft = estado.scrollInicial - desplazamiento;
    };
    const alSoltar = () => {
      const huboArrastre = estado.arrastrando;
      quitar();
      if (!huboArrastre) return;
      estado.tragarClic = true;
      // Si el clic no llega (se solto fuera de la fila), que no se coma el siguiente clic de verdad.
      window.setTimeout(() => {
        estado.tragarClic = false;
      }, 0);
    };
    const quitar = () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      window.removeEventListener("pointercancel", alSoltar);
      estado.soltar = null;
      estado.arrastrando = false;
      setArrastrandoFila(false);
    };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", alSoltar);
    estado.soltar = quitar;
  };

  /** El clic que suelta un arrastre no llega a la pastilla, ni al "+", ni a las chapitas. */
  const tragarClicDelArrastre = (evento: React.MouseEvent) => {
    if (!arrastre.current.tragarClic) return;
    arrastre.current.tragarClic = false;
    evento.preventDefault();
    evento.stopPropagation();
  };

  /** Tocar hace lo de la pastilla; mantener presionado (o clic derecho) abre su menu. */
  const toquesDePastilla = (clave: ClaveDePastilla, alTocar: () => void) => ({
    onPointerDown: (evento: React.PointerEvent) => {
      if (evento.button !== 0) return;
      toqueLargo.current.disparo = false;
      soltarToqueLargo();
      toqueLargo.current.temporizador = window.setTimeout(() => {
        toqueLargo.current.disparo = true;
        toqueLargo.current.temporizador = null;
        navigator.vibrate?.(15);
        setMenuDePastilla(clave);
      }, TOQUE_LARGO_MS);
    },
    onPointerUp: soltarToqueLargo,
    onPointerLeave: soltarToqueLargo,
    // Deslizar la fila de lado no es mantener presionado.
    onPointerCancel: soltarToqueLargo,
    onContextMenu: (evento: React.MouseEvent) => {
      evento.preventDefault();
      setMenuDePastilla(clave);
    },
    onClick: () => {
      if (toqueLargo.current.disparo) {
        toqueLargo.current.disparo = false;
        return;
      }
      alTocar();
    },
  });

  // La pastilla "Sin responder" va encendida si esta puesta la condicion `sin_responder:si`.
  const sinResponderPuesto = filtroSinResponderPuesto(filtros.condiciones);
  // Y "No leido", si esta puesta `no_leido:si`.
  const noLeidoPuesto = filtros.condiciones.some((condicion) => condicion.campo === "no_leido");

  /**
   * Prender o apagar una condicion de pastilla (`sin_responder:si` o `no_leido:si`) sobre lo que ya
   * hay: "Mias + Sin responder" muestra solo los mios. Con una lista abierta se suma a sus
   * condiciones y la lista deja de contar como abierta (cambia la firma de la vista).
   */
  const alternarCondicion = (campo: "sin_responder" | "no_leido", puesta: boolean) =>
    aplicarFiltros(assignedFilter, statusFilter, {
      condiciones: puesta
        ? filtros.condiciones.filter((condicion) => !(condicion.campo === campo && condicion.operador === "si"))
        : [
            // Una "sin_responder:no" se reemplaza: las dos juntas no darian nada.
            ...filtros.condiciones.filter((condicion) => condicion.campo !== campo),
            { campo, operador: "si" },
          ],
    });

  /*
    "ESPERANDO" (parte 4 de "Esperando respuesta"): un interruptor ENCIMA de Todas/Mias.

    - Tocarla pone `espera=1` con Todas o Mias y la linea. Desde "Sin asignar", "Por asesora", una
      lista guardada o con condiciones, las suelta y queda en Todas (o Mias, la asesora): asi el
      numero de la pastilla y la lista dicen lo mismo. Tocarla de nuevo la quita.
    - Estando en Esperando, Todas/Mias cambian de grupo sin salir; tocar el grupo en el que ya se
      esta (la asesora, Mias) sale de Esperando.
  */
  const irAEsperando = React.useCallback(
    (asignacion: "all" | "mine", espera: boolean) => {
      if (asignacion !== assignedFilter) {
        iniciarMedicion(`pestana:${asignacion}`);
        setPedido({ para: asignacion, desde: assignedFilter });
      }
      setVistaPedida(null);
      setFilterMenuOpen(false);
      irA(hrefDeEsperando({ searchAction, selectedConnectionKey, searchQuery, asignacion, espera }));
    },
    [assignedFilter, irA, searchAction, selectedConnectionKey, searchQuery],
  );

  const clasesDePastilla = (activa: boolean, grupoDeEsperando = false) =>
    `inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition [-webkit-touch-callout:none] ${
      grupoDeEsperando
        ? "border-primary text-primary hover:bg-primary/10"
        : activa
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
    }`;

  const numeroDePastilla = (numero: number | null | undefined) =>
    typeof numero === "number" ? <span className="text-[11px] font-semibold leading-none">{numero}</span> : null;

  /** Una pastilla fija. Con una lista abierta ninguna va pintada ni lleva numero (la pintada es la lista). */
  const pastillaFija = (clave: PastillaFija) => {
    const etiqueta = ETIQUETAS_DE_PASTILLAS[clave];
    const titulo = `${etiqueta} (mantén presionado para mover u ocultar)`;

    if (clave === "sin_responder" || clave === "no_leido") {
      /*
        "Sin responder" (lo ultimo lo escribio el cliente) y "No leido" (el cliente escribio y nadie
        abrio el chat): no son filtros nuevos, ponen o quitan su condicion sobre lo que ya hay.
        Llevan su numero de /counts (`sinResponder` y `noLeido`). Hasta el 10-11-2026 la de
        `sin_responder:si` se llamaba "No leido" por error: contaba casi lo mismo que Todas.
      */
      const puesta = clave === "sin_responder" ? sinResponderPuesto : noLeidoPuesto;
      const numero = clave === "sin_responder" ? assignedCounts?.sinResponder : assignedCounts?.noLeido;
      return (
        <button
          key={clave}
          type="button"
          aria-pressed={puesta}
          title={titulo}
          {...toquesDePastilla(clave, () => alternarCondicion(clave, puesta))}
          className={clasesDePastilla(puesta)}
        >
          {etiqueta}
          {!listaActiva ? numeroDePastilla(numero) : null}
        </button>
      );
    }

    // Todas, Mias y Sin asignar: la asignacion. Con una lista abierta, tocarla la cierra.
    const valor = clave === "todas" ? "all" : clave === "mias" ? "mine" : "unassigned";
    const activa = !listaActiva && filtroMostrado === valor;
    // En "Esperando" la pintada llena es Esperando; el grupo va con borde de la marca.
    const grupoDeEsperando = enEspera && activa;
    const alTocar =
      valor === "unassigned"
        ? // "Esperando" es solo de Todas o Mias: Sin asignar sale de ahi.
          () => (listaActiva ? aplicarFiltros(valor, "open", SIN_FILTROS) : aplicarFiltros(valor, statusFilter))
        : () =>
            enEspera
              ? irAEsperando(valor, filtroMostrado !== valor)
              : listaActiva
                ? aplicarFiltros(valor, "open", SIN_FILTROS)
                : aplicarFiltros(valor, statusFilter);
    return (
      <button
        key={clave}
        type="button"
        aria-pressed={activa}
        title={titulo}
        {...toquesDePastilla(clave, alTocar)}
        className={clasesDePastilla(activa, grupoDeEsperando)}
      >
        {etiqueta}
        {assignedCounts && !listaActiva ? numeroDePastilla(assignedCounts[valor]) : null}
      </button>
    );
  };

  /*
    Una lista de esta persona. La abierta va en azul y con su numero (el de los demas costaria una
    consulta por lista en cada recarga).
  */
  const pastillaDeLista = (lista: ListaDeChats) => {
    const activa = listaActiva?.id === lista.id;
    const asignadaDeLaLista = new URLSearchParams(lista.query).get("assigned") || "all";
    const cuenta =
      activa && assignedCounts && (asignadaDeLaLista === "all" || asignadaDeLaLista === "mine" || asignadaDeLaLista === "unassigned")
        ? assignedCounts[asignadaDeLaLista]
        : null;
    return (
      <button
        key={claveDeLista(lista.id)}
        type="button"
        {...toquesDePastilla(claveDeLista(lista.id), () => aplicarGuardado(lista.query))}
        title={`${lista.nombre} (mantén presionado para editar)`}
        className={`inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition [-webkit-touch-callout:none] ${
          activa
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-border text-foreground/80 hover:bg-muted"
        }`}
      >
        {lista.nombre}
        {numeroDePastilla(cuenta)}
      </button>
    );
  };

  // Lo que muestra el menu de la pastilla mantenida presionada.
  const listaDelMenu = menuDePastilla ? listas.find((lista) => lista.id === idDeLista(menuDePastilla)) ?? null : null;
  const fijaDelMenu = menuDePastilla && esPastillaFija(menuDePastilla) ? menuDePastilla : null;
  const movimientosDelMenu = menuDePastilla
    ? movimientosPosibles(pastillasVisibles, menuDePastilla)
    : { izquierda: false, derecha: false };

  return (
    <aside
      ref={refDeLaBandeja}
      className={`${mobileConversationActive ? "hidden md:flex" : "flex"} chat-inbox-sidebar min-h-0 flex-1 overflow-hidden border border-border bg-card p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="relative z-30 shrink-0 border-b border-border bg-card px-3 py-2 backdrop-blur-sm md:px-3 md:py-2">
          {/*
            La caja "Buscar chats" volvio (19-10-2026): busca SOLO en la bandeja, con la pestaña y
            los filtros puestos. La lupa del encabezado (Ctrl+K) sigue siendo la busqueda general,
            que ademas cruza contactos y productos.

            Al esconderse en el celular se cierra la fila de la grilla (0fr) en vez de quitarla: la
            altura baja de a poco y la lista no pega un salto.
          */}
          {alBuscar && alBorrarBusqueda ? (
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                buscadorEscondido ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
              }`}
              aria-hidden={buscadorEscondido || undefined}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="px-0.5 pb-2 pt-0.5">
                  <BuscadorDeChats
                    valor={busqueda}
                    alCambiar={alBuscar}
                    alBorrar={alBorrarBusqueda}
                    refInput={refBuscador}
                    alCambiarFoco={alCambiarFocoDelBuscador}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {/*
            Solo el filtro PUESTO, y un + para cambiarlo.

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
            <div
              ref={filaRef}
              onPointerEnter={medirLaFila}
              onPointerMove={medirLaFila}
              onPointerDown={empezarArrastre}
              onClickCapture={tragarClicDelArrastre}
              className={`flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                filaLista ? "" : "invisible"
              } ${arrastrandoFila ? "cursor-grabbing select-none [&_*]:cursor-grabbing" : filaSeDesborda ? "cursor-grab [&_*]:cursor-grab" : ""}`}
            >
              {/*
                LA FILA (Alex, 10-11-2026): las fijas y las listas de esta persona, en SU orden y sin
                las que oculto (ver contextoDeLaFila). Mantener presionada o clic derecho: mover, y
                en las fijas ocultar; en las listas, ademas, editar y borrar.

                La activa va en azul de la marca; las otras en contorno, para que se lea cual estas
                mirando. Sin emoticones: la palabra ya dice que es cada una, y los dibujos le robaban
                ancho al nombre y al conteo, que es lo unico que se mira de estas pastillas.
              */}
              {/* La pastilla "Esperando" se quitó a pedido de Alex (07-11-2026); la vista espera=1 sigue. */}
              {pastillasVisibles.map((clave) => {
                if (!esPastillaFija(clave)) {
                  const lista = listas.find((otra) => otra.id === idDeLista(clave));
                  return lista ? pastillaDeLista(lista) : null;
                }
                return pastillaFija(clave);
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

              {/* Solo si hay alguna oculta: abre el cuadro para volver a mostrarlas. */}
              {filaLista && pastillasOcultas.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setVerOcultas(true)}
                  aria-label="Mostrar pastillas ocultas"
                  title="Mostrar pastillas ocultas"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[12px] font-medium text-muted-foreground transition hover:bg-muted"
                >
                  <Eye className="size-3.5" />
                  {pastillasOcultas.length}
                </button>
              ) : null}

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
              {filtros.condiciones.map((condicion, indice) => {
                // Una etapa o una etiqueta sola se ve con sus colores; "no tiene" / "no es", en rojo.
                const negada = condicion.operador === "no_es" || condicion.operador === "no_tiene";
                const etapaSola = condicion.campo === "etapa" && condicion.valores.length === 1 && !negada ? CRM_STAGE_META[condicion.valores[0]] : null;
                const etiquetaSola =
                  condicion.campo === "etiquetas" && condicion.valores.length === 1 && !negada
                    ? catalogosDeFiltro.etiquetas.find((item) => item.id === condicion.valores[0])
                    : null;
                // "Sin responder: si" y "No leido" ya se ven en su pastilla, si esta a la vista (oculta,
                // va la chapita: un filtro puesto tiene que notarse). Se devuelve null en vez de
                // filtrar antes, para no correr los indices con los que se quitan las demas.
                if (condicion.campo === "sin_responder" && condicion.operador === "si" && pastillasVisibles.includes("sin_responder")) return null;
                if (condicion.campo === "no_leido" && pastillasVisibles.includes("no_leido")) return null;
                const texto = textoDeCondicion(condicion, nombresDeFiltro, new Date());
                return (
                  <ChapaDeFiltro
                    key={`${indice}-${texto}`}
                    className={
                      etapaSola
                        ? `${etapaSola.borderClassName} ${etapaSola.backgroundClassName} ${etapaSola.accentClassName}`
                        : etiquetaSola
                          ? "border-transparent uppercase tracking-wide"
                          : negada
                            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                            : "border-primary bg-primary/10 text-primary"
                    }
                    estilo={etiquetaSola ? getTagBadgeColors(etiquetaSola.color) : undefined}
                    alAbrir={() => abrirFiltro()}
                    alQuitar={() =>
                      aplicarFiltros(assignedFilter, statusFilter, {
                        condiciones: filtros.condiciones.filter((_, j) => j !== indice),
                      })
                    }
                    tituloQuitar={`Quitar el filtro ${texto}`}
                  >
                    {etiquetaSola ? etiquetaSola.name : texto}
                  </ChapaDeFiltro>
                );
              })}
              </>
              ) : null}
            </div>
          </div>

        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
        {/*
          Al tocar una pestaña o un filtro, EN EL MISMO TOQUE: la lista vieja se atenua (sin clics)
          y encima van siluetas de filas, como en la carga de la pantalla. Antes la lista de "Todas"
          seguia igual bajo la pastilla "Mias" durante segundos y parecia que no habia pasado nada.
        */}
        {listaAtenuada ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-card"
            aria-busy="true"
            aria-label="Cargando la lista"
          >
            {Array.from({ length: FILAS_EN_SILUETA }, (_, indice) => (
              <div key={indice} className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 border-b border-border px-3 py-3">
                <div className="flex justify-center">
                  <Skeleton className="size-12 rounded-full" />
                </div>
                <div className="flex min-w-0 flex-col gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="ml-auto h-3 w-10" />
                  </div>
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {verRecientes && alAbrirDesdeElBuscador ? (
          <ChatsRecientes recientes={chatsRecientes} alAbrir={(chat) => alAbrirDesdeElBuscador(chat)} />
        ) : null}
        <div
          // Tocar la lista cierra las busquedas recientes.
          onPointerDown={recientesDesde ? () => setRecientesDesde(null) : undefined}
          ref={conversationListScrollRef}
          // La foto de la bandeja busca aca las filas que se ven (guardado-local/foto-de-la-bandeja).
          data-lista-de-chats=""
          /*
            [overflow-anchor:none]: la lista recorta las filas que no se ven y cambia los espacios de
            arriba y abajo al bajar. Con el anclaje del navegador prendido, cada cambio "corregia" la
            posicion, eso movia el scroll otra vez y la pantalla temblaba o se pegaba (05-11-2026).
            La linea entre filas ya no la pone la caja: va en cada fila, que tiene alto fijo (ver conversation-list).
          */
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain transition-opacity duration-150 [-webkit-overflow-scrolling:touch] [overflow-anchor:none] ${
            listaAtenuada ? "pointer-events-none opacity-40" : ""
          }`}
        >
          {conversationItems.length > 0 ? (
            <ConversationList
              conversations={conversationItems}
              selectedConversationId={selectedConversationId}
              scrollContainerRef={conversationListScrollRef}
              // Buscando NO se cargan mas chats al bajar: los resultados ya vinieron enteros, y cada
              // pagina nueva empujaba la seccion "Mensajes" para abajo (en el celular "se quitaba").
              hasMoreConversations={busqueda.trim() ? false : hasMoreConversationItems}
              isLoadingMoreConversations={isLoadingMoreConversationItems}
              onLoadMoreConversations={onLoadMoreConversationItems}
              versionDeVista={versionDeVista}
              sinPrecarga={Boolean(busqueda.trim())}
            />
          ) : mensajesEncontrados.length > 0 ? null : (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  {/* En "Esperando" la lista vacia es una buena noticia: se dice asi. */}
                  <h3 className="text-base font-semibold text-foreground">
                    {enEspera && !busqueda.trim() ? "Nadie está esperando" : emptyListTitle}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {enEspera && !busqueda.trim()
                      ? "Todos los chats tienen respuesta de una persona. Toca Esperando para volver a la bandeja."
                      : emptyListDescription}
                  </p>
                </div>
              </div>
            </div>
          )}
          {mensajesEncontrados.length > 0 && alAbrirDesdeElBuscador ? (
            <MensajesEncontradosLista
              mensajes={mensajesEncontrados}
              buscado={busqueda}
              alAbrir={(chat, messageId) => alAbrirDesdeElBuscador(chat, messageId)}
            />
          ) : null}
        </div>
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

      {/*
        Lo que aparece al mantener presionada una pastilla, como en WhatsApp. Todas se mueven (sin la
        opcion que no aplica en los extremos); las fijas ademas se ocultan (no se borran); las
        listas ademas se editan y se borran.
      */}
      <Dialog open={menuDePastilla !== null} onOpenChange={(abierto) => !abierto && setMenuDePastilla(null)}>
        <DialogContent showCloseButton={false} className="gap-0 p-1.5 sm:max-w-xs">
          <DialogHeader className="px-3 pb-2 pt-2.5">
            <DialogTitle className="truncate text-[15px] font-semibold">
              {listaDelMenu?.nombre ?? (fijaDelMenu ? ETIQUETAS_DE_PASTILLAS[fijaDelMenu] : "")}
            </DialogTitle>
            <DialogDescription className="sr-only">{listaDelMenu ? "Opciones de la lista" : "Opciones de la pastilla"}</DialogDescription>
          </DialogHeader>
          {menuDePastilla && (listaDelMenu || fijaDelMenu) ? (
            <div className="flex flex-col">
              {[
                ...(listaDelMenu
                  ? [
                      {
                        icono: <Pencil className="size-4" />,
                        texto: "Editar",
                        alTocar: () => {
                          setMenuDePastilla(null);
                          abrirFiltro({ tipo: "editar", lista: listaDelMenu });
                        },
                      },
                    ]
                  : []),
                ...(movimientosDelMenu.izquierda
                  ? [{ icono: <ChevronLeft className="size-4" />, texto: "Mover a la izquierda", alTocar: () => moverEnLaFila(menuDePastilla, -1) }]
                  : []),
                ...(movimientosDelMenu.derecha
                  ? [{ icono: <ChevronRight className="size-4" />, texto: "Mover a la derecha", alTocar: () => moverEnLaFila(menuDePastilla, 1) }]
                  : []),
                ...(fijaDelMenu
                  ? [{ icono: <EyeOff className="size-4" />, texto: "Ocultar", alTocar: () => ocultarDeLaFila(fijaDelMenu) }]
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
              {listaDelMenu ? (
                <>
                  <div className="-mx-1.5 my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => void borrarLista(listaDelMenu)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <Trash2 className="size-4" />
                    Eliminar
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* "Mostrar pastillas ocultas": el mismo cuadro, con una opcion por cada fija oculta. */}
      <Dialog open={verOcultas && pastillasOcultas.length > 0} onOpenChange={(abierto) => !abierto && setVerOcultas(false)}>
        <DialogContent showCloseButton={false} className="gap-0 p-1.5 sm:max-w-xs">
          <DialogHeader className="px-3 pb-2 pt-2.5">
            <DialogTitle className="text-[15px] font-semibold">Pastillas ocultas</DialogTitle>
            <DialogDescription className="text-[13px]">Toca una para volver a mostrarla en la fila.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col">
            {pastillasOcultas.map((clave) => (
              <button
                key={clave}
                type="button"
                onClick={() => mostrarEnLaFila(clave)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] font-medium text-foreground transition hover:bg-muted"
              >
                <span className="text-foreground/80">
                  <Eye className="size-4" />
                </span>
                {ETIQUETAS_DE_PASTILLAS[clave]}
              </button>
            ))}
            {pastillasOcultas.length > 1 ? (
              <>
                <div className="-mx-1.5 my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => mostrarEnLaFila()}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] font-medium text-foreground transition hover:bg-muted"
                >
                  <span className="text-foreground/80">
                    <Eye className="size-4" />
                  </span>
                  Mostrar todas
                </button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
});
