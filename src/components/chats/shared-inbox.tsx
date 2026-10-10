"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, ChevronRight, MessageCircle, MessageSquareText } from "lucide-react";
import {
  mergeConversationSnapshots,
  readConversationFromCache,
  saveConversationToCache,
} from "@/components/chats/chat-history-cache";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import {
  resetConversationSelection,
  useOpenChatKey,
  usePendingConversationSelection,
  type PendingChatSelection,
} from "./chat-selection-store";
import { deleteChatMessageAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { AppSidebar } from "./appsidebar";
import {
  leerFiltrosDeBandeja,
  paramsDeFiltros,
  type EtapaCrm,
} from "@/features/chats/domain/filtros-de-bandeja";
import type {
  SharedInboxConversationItem,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
  OptimisticDraftMessage,
  ComposerReplyTarget,
  ConversationContactUpdateDetail,
  ConversationTagsUpdateDetail,
  SharedInboxProps,
  ChatStatusChangedDetail,
  SharedInboxConversationItemLike,
  AssignedFilter,
  StatusFilter,
} from "./chat-inbox-types";
import { CHAT_SNOOZED_EVENT, CHAT_STATUS_CHANGED_EVENT, type ChatSnoozedDetail } from "./chat-inbox-types";

export type {
  SharedInboxConversationItem,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
  SharedInboxSidebarItem,
  AssignedFilter,
  StatusFilter,
} from "./chat-inbox-types";
import { normalizeChatSearchText, getMediaPreviewLabel } from "./chat-inbox-format";
import {
  normalizeLiveConversationSnapshot,
  normalizeLiveConversationListSnapshot,
  normalizeConversationItems,
  buildConversationItemHrefFromParams,
  extractConversationIdFromKey,
  conversationIdMatchesKey,
  findConversationItemBySnapshotId,
  buildConversationItemFromSnapshot,
  buildConversationItemFromListSnapshot,
  sortConversationItems,
  updateConversationItemInSortedList,
  mergeConversationListItem,
  areTagListsEqual,
  areConversationListItemsEqual,
  mergeConversationSnapshotIfChanged,
  updateConversationItemByContact,
} from "./chat-inbox-conversation-utils";
import { ConversationPanel } from "./chat-conversation-panel";
import { BarraDeAccionesDelChat, BarraDeAccionesEnSilueta, ChatHeaderActions } from "./chat-header-actions";
import { MenuDelContacto } from "./menu-del-contacto";
import { AssignChatControl } from "./assign-chat-control";
import { inicializarFijados, useChatsFijados } from "./chats-fijados-store";
import { inicializarPermisosDeLaBandeja } from "./permisos-de-la-bandeja-store";
import type { CrmStage } from "@/features/crm/types";
import { resolveCallTarget } from "@/lib/whatsapp-lid";
import { iniciarMedicion, terminarMedicion, terminarMedicionAlPintar } from "@/lib/metricas-chats";
import { aplicarFirmaDelChat } from "@/lib/firma-del-chat";
import {
  agregarFallido,
  estadoCargaDelChat,
  fallidosDelChat,
  LIMITE_CARGA_CHAT_MS,
  quitarFallido,
  resolverDestinoDelEnvio,
  textoCoincideConGuardado,
} from "@/lib/chat-envio-seguro";

const CONVERSATION_LIST_LOAD_BATCH_SIZE = 10;
// Logs de depuración de la lista desactivados (ensuciaban la consola en desarrollo).
const CHAT_LIST_DEBUG = false;

function debugConversationList(...args: unknown[]) {
  if (!CHAT_LIST_DEBUG) {
    return;
  }

  console.log("[SharedInbox][list]", ...args);
}

/** Pestaña y estado que dice la URL, con las mismas reglas que page.tsx y /list. */
function vistaDeLaUrl(
  params: { get: (clave: string) => string | null },
  puedeVerEquipo: boolean,
): { assignedFilter: AssignedFilter; statusFilter: StatusFilter } {
  const asignada = params.get("assigned")?.trim() ?? "";
  const estado = params.get("status")?.trim() ?? "";
  const assignedFilter: AssignedFilter = !puedeVerEquipo
    ? "mine"
    : asignada === "mine" || asignada === "unassigned" || /^user:[a-z0-9]+(,[a-z0-9]+)*$/i.test(asignada)
      ? (asignada as AssignedFilter)
      : "all";
  const statusFilter: StatusFilter = estado === "all" || estado === "resolved" ? estado : "open";
  return { assignedFilter, statusFilter };
}

function claveDeVista(q: string, conexion: string, asignada: string, estado: string, filtros: string) {
  return [q.trim(), conexion.trim(), asignada, estado, filtros].join("::");
}

/*
  LAS ULTIMAS LISTAS, en memoria (maximo 5, una por vista).

  Volver a un filtro que se miro hace menos de 30 s no pide nada: se muestra la guardada. Entre 30
  y 60 s se muestra la guardada y se pide UNA vez para refrescarla (el mismo pedido de siempre, no
  uno de mas). Mas de 60 s: se descarta. Cualquier aviso de la lista (mensaje entrante o propio,
  resolver, posponer) las borra todas: solo el servidor sabe si un chat sigue en un filtro.
*/
type ListaGuardada = {
  items: SharedInboxConversationItem[];
  hasMore: boolean;
  offset: number;
  cursor: string | null;
  at: number;
};
const LISTA_FRESCA_MS = 30_000;
const LISTA_VIGENTE_MS = 60_000;
const listasRecientes = new Map<string, ListaGuardada>();

function guardarListaReciente(clave: string, lista: ListaGuardada) {
  listasRecientes.delete(clave);
  listasRecientes.set(clave, lista);
  while (listasRecientes.size > 5) {
    const masVieja = listasRecientes.keys().next().value;
    if (masVieja === undefined) break;
    listasRecientes.delete(masVieja);
  }
}

function olvidarListasRecientes() {
  listasRecientes.clear();
}

function buildPendingConversationPreview(
  pendingConversation: PendingChatSelection,
): SharedInboxSelectedConversation {
  const lastMessage =
    pendingConversation.lastMessage?.trim() ||
    getMediaPreviewLabel(pendingConversation.lastMessageType) ||
    "";
  const direction = pendingConversation.lastMessageDirection || "INBOUND";
  const createdAt = pendingConversation.lastMessageAt ? new Date(pendingConversation.lastMessageAt) : new Date();
  const previewMessages = lastMessage
    ? [
        {
          id: `${pendingConversation.cacheKey ?? pendingConversation.id}:preview`,
          content: lastMessage,
          direction,
          createdAt,
          authorType: direction === "OUTBOUND" ? "bot" : "user",
          type: pendingConversation.lastMessageType ?? "TEXT",
        } satisfies SharedInboxMessageItem,
      ]
    : [];

  return {
    id: pendingConversation.id,
    label: pendingConversation.label,
    secondaryLabel: pendingConversation.secondaryLabel,
    avatarUrl: pendingConversation.avatarUrl ?? null,
    tags: pendingConversation.tags ?? [],
    contactId: null,
    contactName: null,
    messages: previewMessages,
    cacheKey: pendingConversation.cacheKey ?? pendingConversation.id,
    isPreview: true,
  };
}

/**
 * Campos ocultos del formulario de envio, apuntados al chat abierto.
 *
 * OJO con `conversationId`: va el id PELADO ("cmxxx"), NO la clave del chat ("agent:cmxxx"). La
 * accion de envio hace `WHERE c."id" = conversationId` (chats-actions.ts:732), asi que con la
 * clave no encuentra la conversacion y el mensaje falla con "No se envió".
 *
 * Esta funcion recibia la seleccion pendiente y escribia su `.id`, que es la CLAVE: estaba mal
 * desde siempre, pero nunca se noto porque una comparacion rota mas abajo hacia que jamas se
 * ejecutara. Al arreglar esa comparacion se activo este camino y rompio el envio en produccion.
 * Por eso ahora recibe el id ya resuelto del chat cargado en vez de derivarlo de la clave.
 */
/** Los campos de texto de un formulario de envio, para poder repetirlo tal cual (Reintentar). */
function camposDelFormulario(formData: FormData): Array<[string, string]> {
  const campos: Array<[string, string]> = [];
  formData.forEach((valor, nombre) => {
    if (typeof valor === "string") {
      campos.push([nombre, valor]);
    }
  });
  return campos;
}

function buildComposerHiddenFields(
  baseFields: Array<{ name: string; value: string }>,
  selectedConversation: { conversationId: string; source: "agent" | "official"; agentId: string | null } | null,
) {
  if (!selectedConversation) {
    return baseFields;
  }

  const nextFields = [...baseFields];
  const upsertField = (name: string, value: string) => {
    const index = nextFields.findIndex((field) => field.name === name);
    if (index >= 0) {
      nextFields[index] = { name, value };
      return;
    }

    nextFields.push({ name, value });
  };

  upsertField("source", selectedConversation.source || "agent");
  upsertField("conversationId", selectedConversation.conversationId);
  upsertField("agentId", selectedConversation.source === "agent" ? (selectedConversation.agentId ?? "") : "");

  return nextFields;
}

export function SharedInbox({
  searchAction,
  selectedConversationId: selectedConversationIdFromUrl,
  // mobileConversationActive del servidor ya no se usa: se deriva abajo del chat abierto, porque
  // el valor del servidor se congela al no navegar (era la causa de que en movil el chat no se
  // abriera al hacer click y si al recargar).
  searchQuery,
  selectedConnectionKey = "",
  // Lo que el SERVIDOR uso para armar `conversations`. La vista que se ve sale de la URL del
  // navegador (abajo): cambiar de filtro ya no navega.
  assignedFilter: assignedFilterDelServidor = "all",
  statusFilter: statusFilterDelServidor = "open",
  filtrosDelServidor = "",
  isManager = false,
  veTodoElEquipo = false,
  chatsFijados,
  puedeBloquear = false,
  chatSignature = "",
  conversationListApiPath = "/api/cliente/chats/list",
  initialConversationBatchSize = 20,
  initialHasMoreConversations,
  initialConversationOffset,
  sidebarItems = [],
  conversations,
  selectedConversation,
  selectedConversationTags = [],
  backHref,
  headerBadge,
  headerActions,
  headerBar,
  contactPanelActions,
  contactPanelHeaderActions,
  composer,
  emptyListTitle,
  emptyListDescription,
  emptySelectionTitle,
  emptySelectionDescription,
  messageScrollBehavior = "bottom",
}: SharedInboxProps) {
  const [conversationItems, setConversationItems] = useState<SharedInboxConversationItem[]>(() =>
    normalizeConversationItems(conversations, (item) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilterDelServidor, statusFilterDelServidor),
    ),
  );
  const [hasMoreConversationItems, setHasMoreConversationItems] = useState(
    initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize,
  );
  const [isLoadingMoreConversationItems, setIsLoadingMoreConversationItems] = useState(false);
  // Por donde sigue la lista. Va en un ref y no en el largo de conversationItems porque son dos
  // numeros distintos: el servidor lee 40 filas y puede mostrar 36 (los pospuestos no van a la
  // bandeja). Pidiendo desde 36 la pagina siguiente repite cuatro chats que ya estaban, y al
  // deduplicarlos la lista no crece: para el scroll es exactamente igual que si no hubiera nada
  // mas, y deja de cargar.
  const conversationOffsetRef = useRef(initialConversationOffset ?? conversations.length);
  // El cursor de la pagina siguiente (ver lib/cursor-de-bandeja). Si el servidor lo manda se pagina
  // con el; si no (la primera pagina armada por la pantalla, o un servidor viejo durante un
  // despliegue), se sigue con el offset de arriba, que se mantiene siempre al dia.
  const conversationCursorRef = useRef<string | null>(null);
  /**
   * Los filtros nuevos (etapa del embudo, sin responder), leidos de la direccion.
   *
   * Tienen que viajar en TODOS los pedidos que refrescan la bandeja sola, no solo en el primero.
   * Si faltan en uno, la asesora filtra, ve la lista corta un segundo y despues se le vuelve a
   * llenar de todo: es exactamente lo que paso con el estado y con la asignacion.
   */
  const parametrosDeLaUrl = useSearchParams();
  const etapasEnLaUrl = parametrosDeLaUrl.get("stage") ?? "";
  const sinResponderEnLaUrl = parametrosDeLaUrl.get("pending") === "1";
  const etiquetasEnLaUrl = parametrosDeLaUrl.get("tag") ?? "";
  const ponerFiltrosNuevos = useCallback(
    (params: URLSearchParams) => {
      if (etapasEnLaUrl) params.set("stage", etapasEnLaUrl);
      if (sinResponderEnLaUrl) params.set("pending", "1");
      if (etiquetasEnLaUrl) params.set("tag", etiquetasEnLaUrl);
    },
    [etapasEnLaUrl, sinResponderEnLaUrl, etiquetasEnLaUrl],
  );

  /*
    LA VISTA (pestaña + estado + filtros) SALE DE LA URL DEL NAVEGADOR.

    Cambiar de filtro ya no navega: la bandeja pide solo /list y cambia la URL con pushState, que
    Next sincroniza con useSearchParams sin pedir nada (igual que abrir un chat). Atras/adelante
    tambien: la URL vuelve y la vista con ella. Las reglas son las MISMAS que las del servidor
    (page.tsx): quien no ve al equipo queda siempre en "Mias".
  */
  const { assignedFilter, statusFilter } = vistaDeLaUrl(parametrosDeLaUrl, isManager || veTodoElEquipo);
  const paresDeFiltros = useMemo(
    () => paramsDeFiltros(leerFiltrosDeBandeja((clave) => parametrosDeLaUrl.get(clave))),
    [parametrosDeLaUrl],
  );
  const vistaKey = claveDeVista(
    searchQuery,
    selectedConnectionKey,
    assignedFilter,
    statusFilter,
    paresDeFiltros.map(([clave, valor]) => `${clave}=${valor}`).join("&"),
  );
  const vistaDelServidorKey = claveDeVista(
    searchQuery,
    selectedConnectionKey,
    assignedFilterDelServidor,
    statusFilterDelServidor,
    filtrosDelServidor,
  );
  // El enlace de cada fila lleva la vista de AHORA (con los filtros nuevos tambien).
  const hrefDeFila = useCallback(
    (item: SharedInboxConversationItemLike, q: string = searchQuery) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, q, item, assignedFilter, statusFilter, paresDeFiltros),
    [searchAction, selectedConnectionKey, searchQuery, assignedFilter, statusFilter, paresDeFiltros],
  );
  /*
    "Volver a la lista" lleva a la vista de AHORA. El `backHref` del servidor se arma con los filtros
    con los que cargo la pagina: cambiado el filtro en el navegador, volver desde un chat devolvia
    la bandeja al filtro viejo.
  */
  const backHrefDelServidor = backHref;
  const backHrefActual = useMemo(() => {
    const params = new URLSearchParams(parametrosDeLaUrl.toString());
    if (!params.toString()) {
      return backHrefDelServidor;
    }
    for (const clave of ["chatKey", "messagePage", "ok", "error", "scroll"]) params.delete(clave);
    const qs = params.toString();
    return qs ? `${searchAction}?${qs}` : searchAction;
  }, [backHrefDelServidor, parametrosDeLaUrl, searchAction]);
  // La lista que se ve es de otra vista y esta llegando la nueva: atenuada y con siluetas.
  const [vistaEnCurso, setVistaEnCurso] = useState(false);
  // Sube cada vez que la lista se reemplaza por un cambio de vista (ver ConversationList).
  const [versionDeVista, setVersionDeVista] = useState(0);
  // Red de contencion: la lista nunca queda atenuada para siempre (sin pedir nada).
  useEffect(() => {
    if (!vistaEnCurso) return;
    const temporizador = window.setTimeout(() => setVistaEnCurso(false), 10_000);
    return () => window.clearTimeout(temporizador);
  }, [vistaEnCurso]);

  const [assignedCounts, setAssignedCounts] = useState<{ mine: number; unassigned: number; all: number } | null>(null);
  // Se sube cada vez que alguien resuelve o reabre: vuelve a pedir los numeros de las pestañas en
  // el acto, en vez de esperar la vuelta de 15 s.
  const [pedidoDeConteos, setPedidoDeConteos] = useState(0);
  /*
    Se sube para volver a pedir la lista al servidor, con todos los filtros puestos.

    Lo usa el tiempo real (ver handleListUpdate): su aviso no trae de quien es el chat, ni su etapa,
    ni si esta resuelto, asi que la fila completa -y la decision de si entra- la da el servidor.
  */
  const [pedidoDeLista, setPedidoDeLista] = useState(0);
  const esperaDelPedidoDeListaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
    Los chats que se resolvieron mientras la bandeja estaba abierta, con la hora de su ultimo
    mensaje en ese momento.

    Hace falta porque varias cosas vuelven a meter filas SIN decir su estado (el chat abierto que la
    pagina agrega siempre, el tiempo real), y una fila sin estado pasa el filtro. Si despues el
    cliente escribe, el ultimo mensaje es mas nuevo que el guardado y el chat vuelve: esta vivo.
  */
  const [resueltasAca, setResueltasAca] = useState<ReadonlyMap<string, number>>(() => new Map());
  const conversationItemsRef = useRef<SharedInboxConversationItem[]>([]);
  const [optimisticConversation, setOptimisticConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [liveConversation, setLiveConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [optimisticOutgoingMessage, setOptimisticOutgoingMessage] = useState<OptimisticDraftMessage | null>(null);
  /*
    Textos que NO salieron, de todos los chats. Antes habia un solo espacio (el optimista): el
    siguiente mensaje borraba la burbuja fallida con su "Reintentar" y el texto se perdia (el
    cuadro ya se habia vaciado). Viven aca y no en el panel, que se rearma al cambiar de chat.
  */
  const [mensajesFallidos, setMensajesFallidos] = useState<OptimisticDraftMessage[]>([]);
  const mensajesFallidosRef = useRef(mensajesFallidos);
  mensajesFallidosRef.current = mensajesFallidos;
  /** Envios de texto en camino, por id optimista: el resultado se resuelve contra ESTE registro. */
  const enviosEnCursoRef = useRef<Map<string, OptimisticDraftMessage>>(new Map());
  /* Carga del chat abierto: fallo /live, o cuando empezo a cargar (para el limite de espera). */
  const [falloCargaDelChat, setFalloCargaDelChat] = useState<string | null>(null);
  const [reintentoCargaDelChat, setReintentoCargaDelChat] = useState(0);
  const [replyTarget, setReplyTarget] = useState<ComposerReplyTarget | null>(null);
  const [deletedMessageIds, setDeletedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const handleOpenEditContact = useCallback(() => setEditContactOpen(true), []);
  const [, startSelectionTransition] = useTransition();
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollKeyRef = useRef("");
  const lastScrollTopRef = useRef(0);
  const historyLoadArmedRef = useRef(false);
  const historyLoadConsumedRef = useRef(false);
  const loadMoreHistoryInFlightRef = useRef(false);
  const loadMoreHistoryRestoreRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  // Mientras un chat recién se abre, los ajustes programáticos de scroll (pin al fondo)
  // disparan el listener de scroll y podrían "armar"/lanzar la carga de mensajes anteriores,
  // que ancla la vista arriba. Suprimimos esa carga hasta este timestamp tras abrir.
  const suppressHistoryLoadUntilRef = useRef(0);
  // "Cargar mensajes anteriores" agranda el contenido, y agrandar el contenido es justo lo que
  // despierta al observador que mantiene el chat pegado abajo. Resultado: la asesora pedia el
  // historial y el chat se le iba al fondo, o sea lo contrario de lo que pidio. Mientras dure la
  // carga y un momento despues, ese pegado queda en pausa para que la vista se quede donde estaba.
  const historyRestoreGuardUntilRef = useRef(0);
  const selectedConversationDetailFollowUpTimerRef = useRef<number | null>(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Boton flotante para volver al ultimo mensaje (estilo WhatsApp). Se guarda tambien en un ref
  // para no llamar a setState en cada evento de scroll: solo cuando el boton cambia de estado.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const showJumpToBottomRef = useRef(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedConversationDetailInFlightRef = useRef<string | null>(null);
  // Ref sincronizada en cada render: permite leer el valor actual dentro de event
  // listeners sin declararlos como dependencia (evita re-registro en cada mensaje).
  const selectedConversationRef = useRef(selectedConversation);
  const router = useRouter();
  const [searchInputValue, setSearchInputValue] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ids de chats que coinciden con la búsqueda por CONTENIDO de mensaje (no por nombre/
  // teléfono/último mensaje visible). Vienen del fetch aumentativo al API de lista; sirven
  // para que esos chats aparezcan aunque el texto buscado no esté en los campos visibles.
  const [searchMatchIds, setSearchMatchIds] = useState<ReadonlySet<string> | null>(null);
  const searchAugmentAbortRef = useRef<AbortController | null>(null);
  // Arranca distinta a proposito: la primera corrida del efecto de `conversations` arma la lista.
  const listQueryKeyRef = useRef(`${searchQuery.trim()}::${selectedConnectionKey.trim()}::${assignedFilterDelServidor}`);

  useEffect(() => {
    if (searchInputRef.current && document.activeElement === searchInputRef.current) {
      return;
    }

    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Resolver un chat tiene que sacarlo de la bandeja EN EL ACTO. La lista solo hace upsert
  // (nunca quita), asi que el chat resuelto se quedaba a la vista hasta recargar la pagina:
  // la asesora le daba a "Resolver", veia el aviso verde, y el chat seguia ahi.
  useEffect(() => {
    const handleStatusChanged = (event: Event) => {
      const detail = (event as CustomEvent<ChatStatusChangedDetail>).detail;
      if (!detail?.conversationId) {
        return;
      }

      const itemId = `${detail.source ?? "agent"}:${detail.conversationId}`;
      setPedidoDeConteos((actual) => actual + 1);
      setResueltasAca((actual) => {
        const siguiente = new Map(actual);
        if (detail.resolved) {
          const fila = conversationItemsRef.current.find((item) => item.id === itemId);
          siguiente.set(itemId, fila?.lastMessageAt ? new Date(fila.lastMessageAt).getTime() : 0);
        } else {
          siguiente.delete(itemId);
        }
        return siguiente;
      });

      const yaNoCorresponde =
        statusFilter === "open" ? detail.resolved : statusFilter === "resolved" ? !detail.resolved : false;
      if (!yaNoCorresponde) {
        return;
      }

      setConversationItems((current) => current.filter((item) => item.id !== itemId));
    };

    window.addEventListener(CHAT_STATUS_CHANGED_EVENT, handleStatusChanged);
    return () => window.removeEventListener(CHAT_STATUS_CHANGED_EVENT, handleStatusChanged);
  }, [statusFilter]);

  // Posponer tambien tiene que sacarlo EN EL ACTO, con cualquier filtro puesto: la asesora lo
  // pospone justo para dejar de verlo, y que siguiera ahi hasta el proximo refresco la confundia
  // ("¿lo pospuse o no?").
  useEffect(() => {
    const handleSnoozed = (event: Event) => {
      const detail = (event as CustomEvent<ChatSnoozedDetail>).detail;
      if (!detail?.conversationId) {
        return;
      }
      const itemId = `${detail.source ?? "agent"}:${detail.conversationId}`;
      setConversationItems((current) => current.filter((item) => item.id !== itemId));
    };

    window.addEventListener(CHAT_SNOOZED_EVENT, handleSnoozed);
    return () => window.removeEventListener(CHAT_SNOOZED_EVENT, handleSnoozed);
  }, []);

  // Conteos por filtro (Mías / Sin asignar / Todas) para mostrarlos junto a cada pestaña.
  useEffect(() => {
    const countsApiPath = conversationListApiPath.replace(/\/list$/, "/counts");
    if (countsApiPath === conversationListApiPath) {
      return;
    }

    /*
      Cada 60 s (antes 15 s) y en pausa mientras la pestaña no se ve: son consultas pesadas.
      Un mensaje entrante NO pide los numeros (antes cada asesora conectada pedia /counts 2 s
      despues de cada rafaga); se actualizan en el siguiente ciclo de 60 s. Resolver o reabrir
      los pide en el acto (pedidoDeConteos).
    */
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pendienteAlVolver = false;

    const programarSiguiente = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!cancelled) {
        timeoutId = setTimeout(fetchCounts, 60_000);
      }
    };

    const fetchCounts = async () => {
      if (cancelled) {
        return;
      }
      if (document.hidden) {
        // Se retoma al volver a la pestaña (alCambiarVisibilidad).
        pendienteAlVolver = true;
        return;
      }
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        // El contador tiene que contar lo mismo que se ve en la lista: si estas en "Resueltas",
        // el numero de al lado de la pestaña es el de las resueltas.
        if (statusFilter !== "open") params.set("status", statusFilter);
        ponerFiltrosNuevos(params);
        const qs = params.toString();

        const response = await fetch(`${countsApiPath}${qs ? `?${qs}` : ""}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; counts?: { mine: number; unassigned: number; all: number } }
          | null;
        if (!cancelled && payload?.ok && payload.counts) {
          setAssignedCounts(payload.counts);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        programarSiguiente();
      }
    };

    const alCambiarVisibilidad = () => {
      if (!document.hidden && pendienteAlVolver) {
        pendienteAlVolver = false;
        void fetchCounts();
      }
    };

    void fetchCounts();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [conversationListApiPath, searchQuery, selectedConnectionKey, statusFilter, ponerFiltrosNuevos, pedidoDeConteos]);

  useEffect(() => {
    conversationItemsRef.current = conversationItems;
  }, [conversationItems]);

  // La vista cuyos chats estan HOY en conversationItems, y la ultima que mando el servidor.
  const vistaCargadaRef = useRef(vistaDelServidorKey);
  const vistaDelServidorRef = useRef(vistaDelServidorKey);
  const hasMoreConversationItemsRef = useRef(hasMoreConversationItems);
  hasMoreConversationItemsRef.current = hasMoreConversationItems;

  // Cualquier aviso de la lista deja viejas las listas guardadas de OTRAS vistas: solo el servidor
  // sabe si ese chat entra o sale de cada filtro (ver listasRecientes).
  useEffect(() => {
    const olvidar = () => olvidarListasRecientes();
    window.addEventListener("chat-list-update", olvidar);
    window.addEventListener(CHAT_STATUS_CHANGED_EVENT, olvidar);
    window.addEventListener(CHAT_SNOOZED_EVENT, olvidar);
    return () => {
      window.removeEventListener("chat-list-update", olvidar);
      window.removeEventListener(CHAT_STATUS_CHANGED_EVENT, olvidar);
      window.removeEventListener(CHAT_SNOOZED_EVENT, olvidar);
    };
  }, []);

  /*
    Tocar una pestaña, un filtro o una lista guardada (ver AppSidebar).

    Antes era router.push: el servidor rehacia la pantalla entera y la bandeja se volvia a montar
    (4 a 9 pedidos, ~40-75 consultas, 2-4 s en el celular sin aviso). Ahora, en el mismo toque, la
    lista se atenua con siluetas y la URL cambia sin navegar; el efecto de abajo trae la lista.
  */
  const alCambiarVista = useCallback(
    (href: string) => {
      const destino = new URL(href, window.location.href);
      const { assignedFilter: asignadaDestino, statusFilter: estadoDestino } = vistaDeLaUrl(
        destino.searchParams,
        isManager || veTodoElEquipo,
      );
      // La linea y la busqueda no cambian con un filtro: se comparan con las mismas de vistaKey.
      const claveDestino = claveDeVista(
        searchQuery,
        selectedConnectionKey,
        asignadaDestino,
        estadoDestino,
        paramsDeFiltros(leerFiltrosDeBandeja((clave) => destino.searchParams.get(clave)))
          .map(([clave, valor]) => `${clave}=${valor}`)
          .join("&"),
      );
      if (claveDestino === vistaKey) {
        return;
      }
      setVistaEnCurso(true);
      window.history.pushState(null, "", `${destino.pathname}${destino.search}`);
    },
    [isManager, veTodoElEquipo, vistaKey, searchQuery, selectedConnectionKey],
  );

  // Al montar / cambiar de conexión o filtros, refresca la lista base desde el servidor
  // (fetch directo, cache: no-store) y hace upsert. Evita depender del RSC cacheado en
  // navegación: una conversación nueva que llegó mientras no estabas en esta vista aparece
  // de una, sin recargar la página. Es un fetch único por cambio de deps (no un polling).
  const primeraListaRef = useRef(true);
  useEffect(() => {
    let cancelled = false;

    // La pagina volvio a armarse en el servidor con ESTA vista (recarga, router.refresh): la
    // lista ya llego por ahi (la pone el efecto que sigue a `conversations`). No se pide de nuevo.
    const servidorCambio = vistaDelServidorRef.current !== vistaDelServidorKey;
    vistaDelServidorRef.current = vistaDelServidorKey;
    if (servidorCambio && vistaDelServidorKey === vistaKey) {
      vistaCargadaRef.current = vistaKey;
      setVistaEnCurso(false);
      return () => {
        cancelled = true;
      };
    }

    const armarParams = () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
      // Siempre se manda: la ruta lee la ausencia como "mine", asi que omitirlo
      // estando en "Todas" hacia que el refresco de la lista la pasara sola a "Mias".
      params.set("assigned", assignedFilter);
      if (statusFilter !== "open") params.set("status", statusFilter);
      ponerFiltrosNuevos(params);
      return params;
    };

    /*
      CAMBIO DE VISTA: la lista se REEMPLAZA (la de antes solo agregaba y nunca quitaba).

      Un solo pedido, /list con los chats de la API oficial (incluirOficial=1), y nada mas: ni
      conteos (no dependen de la pestaña), ni la lista repetida, ni filtros guardados (la bandeja
      no se vuelve a montar), ni precarga. Si la vista se miro hace poco, sale de la memoria.
    */
    if (vistaCargadaRef.current !== vistaKey) {
      const anterior = vistaCargadaRef.current;
      guardarListaReciente(anterior, {
        items: conversationItemsRef.current,
        hasMore: hasMoreConversationItemsRef.current,
        offset: conversationOffsetRef.current,
        cursor: conversationCursorRef.current,
        at: Date.now(),
      });

      const medir = (deMemoria: boolean) =>
        terminarMedicionAlPintar(`pestana:${assignedFilter}`, "cambiar_pestana", {
          filtro: assignedFilter.startsWith("user:") ? "asesora" : assignedFilter,
          memoria: deMemoria,
        });
      const poner = (lista: Omit<ListaGuardada, "at">) => {
        vistaCargadaRef.current = vistaKey;
        conversationOffsetRef.current = lista.offset;
        conversationCursorRef.current = lista.cursor;
        setHasMoreConversationItems(lista.hasMore);
        setConversationItems(lista.items);
        setVersionDeVista((actual) => actual + 1);
        setVistaEnCurso(false);
      };

      const guardada = listasRecientes.get(vistaKey);
      const edad = guardada ? Date.now() - guardada.at : Number.POSITIVE_INFINITY;
      if (guardada && edad < LISTA_VIGENTE_MS) {
        poner(guardada);
        medir(true);
        if (edad < LISTA_FRESCA_MS) {
          // 0 pedidos.
          return () => {
            cancelled = true;
          };
        }
      } else {
        setVistaEnCurso(true);
      }

      (async () => {
        try {
          const params = armarParams();
          params.set("limit", String(Math.min(40, Math.max(1, initialConversationBatchSize))));
          params.set("incluirOficial", "1");
          const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
          const payload = response.ok
            ? ((await response.json().catch(() => null)) as
                | {
                    ok?: boolean;
                    conversations?: SharedInboxConversationItem[];
                    hasMore?: boolean;
                    nextOffset?: number;
                    nextCursor?: string | null;
                  }
                | null)
            : null;
          if (cancelled) {
            return;
          }
          if (!payload?.ok || !Array.isArray(payload.conversations)) {
            throw new Error("lista");
          }
          const items = sortConversationItems(
            normalizeConversationItems(payload.conversations, (item) => hrefDeFila(item)),
          );
          const lista = {
            items,
            hasMore: Boolean(payload.hasMore),
            offset: typeof payload.nextOffset === "number" ? payload.nextOffset : items.length,
            cursor: typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
          };
          poner(lista);
          guardarListaReciente(vistaKey, { ...lista, at: Date.now() });
          if (!guardada || edad >= LISTA_VIGENTE_MS) {
            medir(false);
          }
        } catch {
          if (cancelled) {
            return;
          }
          // Sin la lista nueva no se deja la vieja bajo la pastilla nueva: se arma como antes.
          setVistaEnCurso(false);
          router.refresh();
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    /*
      Recien cargada la pagina, la lista YA vino del servidor: no se pide de nuevo.

      Se pedia dos veces seguidas -el servidor la arma para pintar la pagina y apenas montaba se
      volvia a pedir igual-: 250 de las 571 listas de una hora (05-10-2026). Pesa sobre todo despues
      de un despliegue, cuando todas las pestañas recargan a la vez. Solo se salta la PRIMERA vez y
      solo si la pagina se cargo hace menos de 15 s (recargar o entrar desde afuera): al volver con
      el boton de atras, o al cambiar filtros o linea, se pide como siempre.
    */
    const esLaPrimera = primeraListaRef.current;
    primeraListaRef.current = false;
    if (esLaPrimera && typeof performance !== "undefined" && performance.now() < 15_000) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const params = armarParams();

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;
        if (cancelled || !payload?.ok || !Array.isArray(payload.conversations)) {
          return;
        }

        const fresh = normalizeConversationItems(payload.conversations, (item) => hrefDeFila(item));

        setConversationItems((current) => {
          let next = current;
          for (const item of fresh) {
            if (!item.id) continue;
            next = updateConversationItemInSortedList(next, item.id, item);
          }
          return next;
        });
      } catch {
        // Ignoramos errores de red.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Las demas entradas (filtros, hrefDeFila) cambian siempre JUNTO con vistaKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationListApiPath, vistaKey, vistaDelServidorKey, pedidoDeLista]);

  /*
    LOS CHATS FIJADOS (ver lib/chats-fijados).

    El servidor manda la lista de quien mira; la bandeja la pone en el almacen compartido, que es de
    donde la leen la lista (para subirlos) y el menu de cada fila (para fijar y desfijar).
  */
  const firmaDeFijados = (chatsFijados ?? []).join(",");
  useEffect(() => {
    inicializarFijados(firmaDeFijados ? firmaDeFijados.split(",") : []);
  }, [firmaDeFijados]);

  useEffect(() => {
    inicializarPermisosDeLaBandeja({ puedeBloquear });
  }, [puedeBloquear]);

  /*
    Un fijado que no vino en la primera pagina -un chat viejo, que la bandeja carga de a 20- se pide
    aparte, con los MISMOS filtros: si no cumple el filtro puesto, el servidor no lo devuelve y no
    aparece, igual que cualquier otro chat. Solo los del canal viejo: /list no trae los de la API
    oficial, que igual casi siempre estan entre los recientes.
  */
  const fijadosEnVivo = useChatsFijados();
  const fijadosYaPedidosRef = useRef(new Set<string>());
  useEffect(() => {
    const faltan = fijadosEnVivo.filter(
      (clave) => clave.startsWith("agent:") && !conversationItemsRef.current.some((item) => item.id === clave),
    );
    if (faltan.length === 0) {
      return;
    }
    // Una vez por combinacion de fijados y filtros: si el servidor no lo devolvio, no se insiste.
    const firma = [faltan.join(","), assignedFilter, statusFilter, selectedConnectionKey, searchQuery].join("|");
    if (fijadosYaPedidosRef.current.has(firma)) {
      return;
    }
    fijadosYaPedidosRef.current.add(firma);

    let cancelado = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        params.set("ids", faltan.join(","));
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        params.set("assigned", assignedFilter);
        if (statusFilter !== "open") params.set("status", statusFilter);
        ponerFiltrosNuevos(params);

        const respuesta = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const datos = (await respuesta.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;
        if (cancelado || !datos?.ok || !Array.isArray(datos.conversations)) {
          return;
        }
        const filas = normalizeConversationItems(datos.conversations, (item) =>
          hrefDeFila(item),
        );
        setConversationItems((current) => {
          let next = current;
          for (const item of filas) {
            if (item.id) next = updateConversationItemInSortedList(next, item.id, item);
          }
          return next;
        });
      } catch {
        // Sin los fijados viejos la bandeja sirve igual.
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [fijadosEnVivo, assignedFilter, statusFilter, selectedConnectionKey, searchQuery, ponerFiltrosNuevos, conversationListApiPath, searchAction, hrefDeFila]);

  // Búsqueda aumentativa: trae del servidor los chats que coinciden por contenido de
  // mensaje o que están más allá de lo ya cargado, y los AGREGA (nunca quita) a la lista.
  // No navega ni reemplaza la lista: así borrar el buscador siempre restaura todos los
  // chats al instante (la lista base nunca se encoge por la búsqueda).
  const runSearchAugmentation = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      searchAugmentAbortRef.current?.abort();

      if (!q) {
        searchAugmentAbortRef.current = null;
        setSearchMatchIds(null);
        return;
      }

      const controller = new AbortController();
      searchAugmentAbortRef.current = controller;

      try {
        const params = new URLSearchParams();
        params.set("q", q);
        params.set("limit", "40");
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        // Siempre se manda: la ruta lee la ausencia como "mine", asi que omitirlo
        // estando en "Todas" hacia que el refresco de la lista la pasara sola a "Mias".
        params.set("assigned", assignedFilter);
        if (statusFilter !== "open") params.set("status", statusFilter);
        ponerFiltrosNuevos(params);

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;

        if (!payload?.ok || !Array.isArray(payload.conversations)) {
          return;
        }

        const normalized = normalizeConversationItems(payload.conversations, (item) =>
          hrefDeFila(item, q),
        );

        setConversationItems((current) => {
          const currentIds = new Set(current.map((item) => item.id));
          const additions = normalized.filter((item) => item.id && !currentIds.has(item.id));
          return additions.length === 0 ? current : sortConversationItems([...current, ...additions]);
        });
        setSearchMatchIds(new Set(normalized.map((item) => item.id)));
      } catch {
        // Abort o fallo de red: la búsqueda local sobre lo ya cargado sigue funcionando.
      } finally {
        if (searchAugmentAbortRef.current === controller) {
          searchAugmentAbortRef.current = null;
        }
      }
    },
    [conversationListApiPath, selectedConnectionKey, assignedFilter, statusFilter, ponerFiltrosNuevos, hrefDeFila],
  );

  // Si la URL tiene `q` (p.ej. se buscó y luego se abrió un chat: el href del chat arrastra el `q`),
  // la lista base viene FILTRADA del servidor. Al borrar el buscador hay que quitar `q` de la URL
  // para que el servidor devuelva la lista COMPLETA otra vez; si no, el input queda vacío pero la
  // lista sigue mostrando solo los resultados de la búsqueda anterior (y "Todas" no coincide).
  const clearSearchUrlParam = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("q")) return;
    url.searchParams.delete("q");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      // Se vació el buscador (borrando a mano): restaurar la lista completa quitando `q` de la URL.
      if (!value.trim()) {
        clearSearchUrlParam();
      }
      searchDebounceRef.current = setTimeout(() => {
        void runSearchAugmentation(value);
      }, 250);
    },
    [runSearchAugmentation, clearSearchUrlParam],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAugmentAbortRef.current?.abort();
    searchAugmentAbortRef.current = null;
    setSearchMatchIds(null);
    clearSearchUrlParam();
    searchInputRef.current?.focus();
  }, [clearSearchUrlParam]);

  // Lista que se muestra: filtrado LOCAL e instantáneo de los chats ya cargados por nombre,
  // teléfono o último mensaje (sin tildes/mayúsculas), más los que el servidor marcó como
  // coincidencia por contenido de mensaje. Sin texto → se muestran todos. Esto hace que
  // escribir filtre al instante y que borrar restaure la lista completa de inmediato.
  const displayedConversationItems = useMemo(() => {
    /*
      Un chat resuelto no vuelve a la bandeja de "abiertas", lo actualice quien lo actualice.

      La lista se refresca haciendo upsert: agrega y actualiza, nunca quita. Y resolver ESCRIBE un
      mensaje en la conversacion -"Fulano resolvio la conversacion"-, asi que el propio acto de
      resolver la devolvia a la lista un segundo despues de haberla sacado. La asesora resolvia, la
      veia desaparecer y reaparecer.

      Se filtra aca, en un solo lugar, y no en cada camino que mete items: son varios (el refresco,
      el scroll infinito, el tiempo real) y alcanza con que uno se olvide para que vuelva el
      problema. Los items sin estado conocido se dejan pasar: no se puede decidir sobre lo que no
      se sabe.
    */
    const porEstado = conversationItems.filter((item) => {
      const resueltaAca = statusFilter === "open" ? resueltasAca.get(item.id) : undefined;
      if (resueltaAca !== undefined) {
        const ultimo = item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : 0;
        if (ultimo <= resueltaAca) {
          return false;
        }
      }
      if (!item.status) {
        return true;
      }
      const cerrada = item.status === "CLOSED" || item.status === "ARCHIVED";
      return statusFilter === "open" ? !cerrada : statusFilter === "resolved" ? cerrada : true;
    });

    const normalizedQuery = normalizeChatSearchText(searchInputValue.trim());
    if (!normalizedQuery) {
      return porEstado;
    }

    return porEstado.filter((item) => {
      if (searchMatchIds?.has(item.id)) {
        return true;
      }

      return (
        normalizeChatSearchText(item.label).includes(normalizedQuery) ||
        normalizeChatSearchText(item.secondaryLabel).includes(normalizedQuery) ||
        normalizeChatSearchText(item.lastMessage ?? "").includes(normalizedQuery)
      );
    });
  }, [conversationItems, resueltasAca, searchInputValue, searchMatchIds, statusFilter]);

  const loadMoreConversationItems = useCallback(async () => {
    if (isLoadingMoreConversationItems || !hasMoreConversationItems) {
      return;
    }

    const offset = conversationOffsetRef.current;
    if (offset <= 0) {
      return;
    }

    debugConversationList("loadMore start", {
      offset,
      currentCount: conversationItems.length,
      hasMoreConversationItems,
      searchQuery: searchQuery.trim(),
      selectedConnectionKey: selectedConnectionKey.trim(),
    });

    setIsLoadingMoreConversationItems(true);

    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      // Si hay cursor el servidor lo usa y no recorre las filas de antes; el offset va igual, para
      // un servidor que todavia no entiende el cursor.
      const cursor = conversationCursorRef.current;
      if (cursor) {
        params.set("cursor", cursor);
      }
      params.set("limit", String(CONVERSATION_LIST_LOAD_BATCH_SIZE));

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      if (selectedConnectionKey.trim()) {
        params.set("connection", selectedConnectionKey.trim());
      }

      // Siempre se manda: ver arriba. La ausencia significa "mine" del lado de la ruta.
      params.set("assigned", assignedFilter);

      if (statusFilter !== "open") {
        params.set("status", statusFilter);
      }
      ponerFiltrosNuevos(params);

      const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        debugConversationList("loadMore response not ok", {
          status: response.status,
          offset,
        });
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            conversations?: SharedInboxConversationItem[];
            hasMore?: boolean;
            nextOffset?: number;
            nextCursor?: string | null;
          }
        | null;

      if (!payload?.ok || !Array.isArray(payload.conversations)) {
        debugConversationList("loadMore invalid payload", {
          offset,
          payloadKeys: payload ? Object.keys(payload) : null,
        });
        return;
      }

      const normalizedPayloadConversations = normalizeConversationItems(payload.conversations, (item) =>
        hrefDeFila(item),
      );
      debugConversationList("loadMore payload", {
        offset,
        received: normalizedPayloadConversations.length,
        hasMore: payload.hasMore,
      });

      setConversationItems((current) => {
        const currentById = new Map(current.map((item) => [item.id, item]));
        const merged = [
          ...current,
          ...normalizedPayloadConversations.map((conversation) =>
            mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
          ),
        ];
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        const sorted = sortConversationItems(deduped);

        if (
          current.length === sorted.length &&
          current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
        ) {
          return current;
        }

        return sorted;
      });

      // El servidor dice donde quedo. El fallback avanza el lote completo igual: si el offset no
      // se mueve, la proxima pagina vuelve a traer lo mismo y la lista se traba.
      conversationOffsetRef.current =
        typeof payload.nextOffset === "number" && payload.nextOffset > offset
          ? payload.nextOffset
          : offset + CONVERSATION_LIST_LOAD_BATCH_SIZE;
      // Sin cursor en la respuesta (servidor viejo) se vuelve al offset: nunca un cursor viejo.
      conversationCursorRef.current =
        typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      setHasMoreConversationItems(Boolean(payload.hasMore));
      debugConversationList("loadMore applied", {
        offset,
        nextOffset: conversationOffsetRef.current,
        nextHasMore: Boolean(payload.hasMore),
      });
    } catch {
      // Background pagination is opportunistic; failures should not block the UI.
      debugConversationList("loadMore failed", { offset });
    } finally {
      setIsLoadingMoreConversationItems(false);
    }
  }, [
    hrefDeFila,
    conversationItems.length,
    conversationListApiPath,
    hasMoreConversationItems,
    isLoadingMoreConversationItems,

    searchQuery,
    selectedConnectionKey,
    assignedFilter,
    statusFilter,
    ponerFiltrosNuevos,
  ]);

  const pendingConversation = usePendingConversationSelection();

  // Chat abierto: UNICA fuente de verdad para todo el componente (ver useOpenChatKey). Todo lo
  // que necesite saber "que chat esta abierto" lee de aca. Va ANTES de cualquier uso: hay
  // efectos mas abajo que dependen de esto.
  //
  // `selectedConversationId` SOMBREA al prop de la URL a proposito: abrir un chat ya no navega,
  // asi que el prop se congela en el chat con el que cargo la pagina. Los ~15 usos que quedaban
  // leyendolo crudo apuntarian al chat viejo; sombreandolo pasan todos a la fuente unica.
  const selectedConversationKey = useOpenChatKey(selectedConversationIdFromUrl);
  const selectedConversationId = selectedConversationKey;

  /*
    Abrir un chat apaga su aviso en la campanita, en el acto.

    La campanita vive en el encabezado de la app y pregunta por su cuenta cada minuto, asi que
    despues de leer un chat seguia mostrando el 1 hasta un minuto entero: uno entraba, veia el
    mensaje, volvia, y el numero seguia ahi. Parecia que la app no se habia enterado.

    No alcanza con que la campanita vuelva a preguntar al navegar: el servidor marca los mensajes
    como leidos DESPUES de responder (va en un after(), para no demorar la pantalla), asi que una
    consulta inmediata todavia los contaria. Por eso el aviso viaja de aca: quien abrio el chat es
    esta pantalla, y lo sabe antes que la base. La proxima consulta confirma o corrige.
  */
  useEffect(() => {
    if (!selectedConversationKey) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("chat-conversation-read", { detail: { key: selectedConversationKey } }),
    );
  }, [selectedConversationKey]);
  // En movil la lista y el chat son dos vistas y esta bandera decide cual se ve. Sale del chat
  // abierto (misma fuente unica), no del servidor: hay chat abierto => se ve el chat.
  const mobileConversationActive = Boolean(selectedConversationKey);

  useEffect(() => {
    if (selectedConversation && !selectedConversation.isPreview) {
      saveConversationToCache(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    // Solo cuando el SERVIDOR manda otra lista (recarga, router.refresh, otra linea). Cambiar de
    // filtro en el navegador no pasa por aca: lo hace el efecto de la vista, con /list.
    const nextListQueryKey = vistaDelServidorKey;
    const assignedFilter = assignedFilterDelServidor;
    const statusFilter = statusFilterDelServidor;
    const queryChanged = listQueryKeyRef.current !== nextListQueryKey;
    listQueryKeyRef.current = nextListQueryKey;

    if (queryChanged) {
      // Otro filtro es otra lista: la paginacion arranca de cero, si no la segunda pagina se pide
      // desde donde iba la lista anterior y se saltea la mitad de los chats del filtro nuevo.
      conversationOffsetRef.current = initialConversationOffset ?? conversations.length;
      // La primera pagina la armo la pantalla y no trae cursor: la siguiente va por offset.
      conversationCursorRef.current = null;
      setHasMoreConversationItems(initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize);
      setConversationItems(
        normalizeConversationItems(conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
        ),
      );
      return;
    }

    setConversationItems((current) => {
      if (current.length === 0) {
        return sortConversationItems(
          normalizeConversationItems(conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
          ),
        );
      }

      const currentById = new Map(current.map((item) => [item.id, item]));
      const frescos = normalizeConversationItems(conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
      ).map((conversation) =>
        mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
      );

      /*
        Lo que se cargo bajando NO se tira en el proximo refresco.

        El servidor manda siempre la primera tanda -los mas recientes-, y esta lista se rearmaba
        solo con eso. Todo lo que uno habia cargado al bajar desaparecia un segundo despues, en el
        refresco automatico que corre cada pocos segundos. Desde afuera se veia como que la lista
        "no baja": uno llega al fondo, se cargan veinte, y se borran antes de que alcance a verlos.

        Medido el 9-sep-2026: la segunda pagina traia 20 chats que NO estaban en pantalla, el
        navegador los pedia, los recibia, y la lista seguia teniendo exactamente los mismos 56.

        Los que ya no correspondan salen por su propio camino -resolver, posponer, cambiar de
        filtro-, que es donde se sabe de verdad que hay que sacarlos.
      */
      const idsFrescos = new Set(frescos.map((item) => item.id));
      const cargadosAlBajar = current.filter((item) => !idsFrescos.has(item.id));
      const sorted = sortConversationItems([...frescos, ...cargadosAlBajar]);

      if (
        current.length === sorted.length &&
        current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
      ) {
        return current;
      }

      return sorted;
    });
  }, [conversations, initialConversationBatchSize, initialConversationOffset, initialHasMoreConversations, searchAction, searchQuery, selectedConnectionKey, assignedFilterDelServidor, statusFilterDelServidor, vistaDelServidorKey]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    if (liveConversation && !conversationIdMatchesKey(selectedConversationId, liveConversation.id)) {
      setLiveConversation(null);
    }
  }, [liveConversation, pendingConversation?.id, selectedConversationId]);

  // Al salir de la bandeja se RESETEA (no se "cierra"): el store es de modulo y sobrevive al
  // desmontaje. Marcarlo como cerrado haria que al volver por un link con ?chatKey= ese chat
  // se ignore.
  useEffect(() => {
    return () => {
      resetConversationSelection();
    };
  }, []);

  // Clave efectiva del chat activo. Sirve para sincronizar el panel y para
  // evitar que el listado se reordene cuando el evento pertenece al chat abierto.
  const selectedConversationCache = useMemo(
    () =>
      hasHydrated && selectedConversationKey
        ? readConversationFromCache(selectedConversationKey, { ignoreFreshness: true })
        : null,
    [hasHydrated, selectedConversationKey],
  );
  const selectedConversationMatchesCurrentKey =
    Boolean(selectedConversation && conversationIdMatchesKey(selectedConversationKey, selectedConversation.id));
  const currentSelectedConversation = selectedConversationMatchesCurrentKey ? selectedConversation : null;
  const currentSelectedConversationHasContent = Boolean(currentSelectedConversation?.messages.length && !currentSelectedConversation?.isPreview);
  const currentSelectedConversationHasContentRef = useRef(currentSelectedConversationHasContent);
  currentSelectedConversationHasContentRef.current = currentSelectedConversationHasContent;
  const cachedConversationForCurrentSelection =
    selectedConversationCache && conversationIdMatchesKey(selectedConversationKey, selectedConversationCache.id)
      ? selectedConversationCache
      : null;
  useEffect(() => {
    if (!pendingConversation?.id) {
      return;
    }

    const cacheKey = pendingConversation.cacheKey || pendingConversation.id;
    const rawCachedConversation = readConversationFromCache(cacheKey, { ignoreFreshness: true });

    // La caché se consulta con varias formas de la clave (con y sin prefijo "agent:"), asi
    // que puede devolver una conversacion que NO es la que se esta abriendo. Sin esta
    // comprobacion se pintaba el historial de OTRO contacto por un instante, hasta que
    // llegaba el real (se veia al recargar o al abrir un chat desde el buscador).
    // La otra lectura de cache, la del chat ya seleccionado, si valida asi.
    const cachedConversation =
      rawCachedConversation && conversationIdMatchesKey(cacheKey, rawCachedConversation.id)
        ? rawCachedConversation
        : null;

    startSelectionTransition(() => {
      setLiveConversation(null);
      setOptimisticConversation(
        cachedConversation
          ? {
              ...cachedConversation,
              tags: cachedConversation.tags?.length ? cachedConversation.tags : pendingConversation.tags ?? [],
            }
          : buildPendingConversationPreview(pendingConversation),
      );
    });
  }, [pendingConversation, startSelectionTransition]);

  // Los snapshots de realtime (chat-live-update / chat-list-update) llegan con el id crudo
  // de la conversación (sin prefijo "agent:"/"official:") y sin href. Si la conversación es
  // nueva (no estaba en el SSR), el item insertado quedaría con id sin prefijo y href "".
  // Al hacer click, router.push("") navega a la URL ACTUAL (no abre el chat nuevo: parece
  // que "entra y vuelve al chat anterior") y además el efecto que carga el historial se
  // salta el item por no empezar con "agent:". Normalizamos id (a chatKey) y href aquí para
  // que un chat recién llegado sea clickeable al primer intento.
  const normalizeRealtimeConversationItem = useCallback(
    (item: SharedInboxConversationItem): SharedInboxConversationItem => {
      if (item.href.trim() && item.id.includes(":")) {
        return item;
      }

      const chatKey = item.id.includes(":")
        ? item.id
        : `${item.source === "official" ? "official" : "agent"}:${item.id}`;
      const withKey = chatKey === item.id ? item : { ...item, id: chatKey };
      const href = hrefDeFila(withKey);

      return href === withKey.href ? withKey : { ...withKey, href };
    },
    [hrefDeFila],
  );

  const refreshSelectedConversationFromServer = useCallback(async () => {
    const chatKey = selectedConversationKey;
    if (!chatKey.startsWith("agent:")) {
      return;
    }

    try {
      const [liveResponse, summaryResponse] = await Promise.all([
        fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        }),
        fetch(`/api/cliente/chats/summary?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        }),
      ]);

      if (liveResponse.ok) {
        const livePayload = (await liveResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;
        const liveConversationSnapshot = normalizeLiveConversationSnapshot(livePayload?.conversation);
        if (livePayload?.ok && liveConversationSnapshot) {
          window.dispatchEvent(
            new CustomEvent("chat-live-update", {
              detail: {
                conversation: liveConversationSnapshot,
                chatKey,
              },
            }),
          );
        }
      }

      if (summaryResponse.ok) {
        const summaryPayload = (await summaryResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;
        const summaryConversationSnapshot = normalizeLiveConversationListSnapshot(summaryPayload?.conversation);
        if (summaryPayload?.ok && summaryConversationSnapshot) {
          window.dispatchEvent(
            new CustomEvent("chat-list-update", {
              detail: {
                conversation: summaryConversationSnapshot,
              },
            }),
          );
        }
      }
    } catch {
      // Si falla este respaldo, el polling/realtime siguiente vuelve a intentar.
    }
  }, [selectedConversationKey]);

  /*
    Un solo refresco de respaldo despues de enviar, a los 1,5 s (antes eran tres: 0,7 / 1,8 / 3,6 s,
    cada uno con /live + /summary). El mensaje real llega igual por el altavoz; esto solo cubre un
    aviso perdido.
  */
  const scheduleConversationRefreshAfterSend = useCallback(() => {
    window.setTimeout(() => {
      void refreshSelectedConversationFromServer();
    }, 1500);
  }, [refreshSelectedConversationFromServer]);

  // Mientras hay busqueda activa, los resultados se CONGELAN: el realtime no debe mutar la
  // lista. El filtro de busqueda incluye por ULTIMO MENSAJE, asi que un mensaje nuevo
  // cambiaba el preview/orden del resultado "como fantasma". El detalle del chat abierto SI
  // se sigue actualizando. Al limpiar la busqueda, el servidor devuelve la lista fresca.
  const isSearchActiveRef = useRef(false);
  useEffect(() => {
    isSearchActiveRef.current = Boolean(searchInputValue.trim());
  }, [searchInputValue]);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationSnapshot(customEvent.detail?.conversation);
      const effectiveSelectedKey = selectedConversationKey;

      if (!snapshot || !conversationIdMatchesKey(effectiveSelectedKey, snapshot.id)) {
        return;
      }
      // Medicion: mensaje entrante (aviso del altavoz) hasta pintado en el chat abierto.
      terminarMedicionAlPintar(`entrante:${extractConversationIdFromKey(snapshot.id)}`, "entrante_pintado", {
        chatAbierto: true,
      });

      setLiveConversation((current) => {
        // Si current pertenece a una conversación diferente (liveConversation nunca se
        // resetea al navegar), usarlo como base haría que mergeCachedMessages concatene
        // mensajes de dos chats distintos. Solo se usa una base cuyo id COINCIDA con el snapshot;
        // el fallback también se valida (antes caía en la conversación anterior → mismo cruce).
        const base = (current && current.id === snapshot.id)
          ? current
          : (selectedConversationRef.current && selectedConversationRef.current.id === snapshot.id
              ? selectedConversationRef.current
              : null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
      // El detalle (setLiveConversation, arriba) SI se actualiza aunque haya busqueda; solo
      // la LISTA se congela para que el resultado no cambie de preview/orden en vivo.
      if (!isSearchActiveRef.current) {
        setConversationItems((current) => {
          const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
          const updatedItem = normalizeRealtimeConversationItem(buildConversationItemFromSnapshot(snapshot, currentItem));
          return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
        });
      }
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [normalizeRealtimeConversationItem, selectedConversationKey]);

  // Canal que se esta viendo (filtro "connection"). Vacio = bandeja unificada.
  const selectedChannelIdFilter = selectedConnectionKey.trim().startsWith("channel:")
    ? selectedConnectionKey.trim().slice("channel:".length)
    : "";

  useEffect(() => {
    function handleListUpdate(event: Event) {
      // Busqueda activa: resultados congelados (el filtro mira el ultimo mensaje y un
      // mensaje nuevo cambiaba el preview/orden "como fantasma").
      if (isSearchActiveRef.current) {
        return;
      }

      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationListSnapshot(customEvent.detail?.conversation);
      if (!snapshot) {
        return;
      }

      // El realtime escucha TODAS las instancias del workspace, asi que aqui pueden caer
      // chats de otro canal. Si estamos filtrando por una conexion, no deben entrar en la
      // lista (si no, viendo un canal aparecen chats del otro).
      if (selectedChannelIdFilter && snapshot.channelId && snapshot.channelId !== selectedChannelIdFilter) {
        return;
      }

      /*
        EL AVISO EN TIEMPO REAL NO SABE DE QUIEN ES EL CHAT.

        Trae el ultimo mensaje y poco mas: ni la asesora, ni la etapa, ni si esta resuelto. Con eso
        pasaban dos cosas (Alex, 30-09-2026, mirando la pantalla de Sthefany):
         - Un chat que no estaba en la lista entraba igual, aunque no cumpliera el filtro: con los
           chats de Camila filtrados, llegaba un mensaje de un chat de Ingrid y aparecia arriba, y
           parecia que el filtro se habia quitado solo.
         - Entraba con la asesora vacia ("---") aunque tuviera dueña, y un chat que ya estaba en la
           lista se quedaba con la asesora vieja cuando lo asignaban.

        Por eso, un aviso de un chat que NO esta en la lista pide la lista de nuevo al servidor -una
        sola vez aunque lleguen varios seguidos-, que devuelve la fila completa y aplica todos los
        filtros: entra por ahi, no a ciegas.

        El que YA estaba se mueve arriba en el acto con lo que trae el aviso, y no pide la lista
        entera (plan "Chats instantaneo", fase 1): cada mensaje, cada visto y cada envio propio
        pedian /list completo. Lo que el aviso no trae (dueña, etapa) lo corrigen la ficha del chat
        y el refresco de respaldo de la pagina.

        Los avisos locales (detail.local: la fila optimista de un envio propio) nunca piden la lista:
        no traen nada que el servidor sepa y la bandeja no tenga.
      */
      const yaEstaEnLaLista = Boolean(findConversationItemBySnapshotId(conversationItemsRef.current, snapshot.id));
      const esAvisoLocal = (customEvent.detail as { local?: boolean } | undefined)?.local === true;
      if (!yaEstaEnLaLista && !esAvisoLocal) {
        if (esperaDelPedidoDeListaRef.current) {
          clearTimeout(esperaDelPedidoDeListaRef.current);
        }
        esperaDelPedidoDeListaRef.current = setTimeout(() => {
          esperaDelPedidoDeListaRef.current = null;
          setPedidoDeLista((actual) => actual + 1);
        }, 800);
      }

      if (!yaEstaEnLaLista) {
        return;
      }
      // Medicion: mensaje entrante (aviso del altavoz) hasta pintado en la fila de la lista.
      terminarMedicionAlPintar(`entrante:${extractConversationIdFromKey(snapshot.id)}`, "entrante_pintado", {
        chatAbierto: false,
      });

      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const baseItem = buildConversationItemFromListSnapshot(snapshot, currentItem);
        const mergedItem = mergeConversationListItem(baseItem, currentItem);
        const effectiveSelectedKey = selectedConversationKey;
        const updatedItem = normalizeRealtimeConversationItem(
          conversationIdMatchesKey(effectiveSelectedKey, snapshot.id)
            ? { ...mergedItem, incomingCount: 0 }
            : mergedItem,
        );
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
  }, [normalizeRealtimeConversationItem, selectedConversationKey, selectedChannelIdFilter]);

  useEffect(() => {
    function handleContactUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationContactUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId || !detail.name?.trim()) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          const nextLabel = detail.name.trim();
          if (item.label === nextLabel) {
            return item;
          }

          return {
            ...item,
            label: nextLabel,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });
    }

    window.addEventListener("chat-contact-updated", handleContactUpdate as EventListener);
    return () => window.removeEventListener("chat-contact-updated", handleContactUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleTagsUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationTagsUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          if (areTagListsEqual(item.tags ?? [], detail.tags)) {
            return item;
          }

          return {
            ...item,
            tags: detail.tags,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          tags: detail.tags,
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          tags: detail.tags,
        };
      });
    }

    window.addEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
  }, []);

  /*
    Segundo /live a los 2,5 s, SOLO cuando hace falta.

    Su unico fin es recoger los medios que el primero dejo resolviendose en segundo plano. Antes
    salia SIEMPRE, en cada apertura (otras ~6-8 consultas, y a veces reacomodaba la pantalla).
    Ahora sale si el primero dijo `mediosPendientes`, si fallo, o si no hubo primero (el chat vino
    pintado por el servidor en la carga de la pagina), que es lo que pasaba antes en ese caso.
    No pide la llamada: ya llego con el primero.
  */
  const programarSegundoLive = useCallback((chatKey: string) => {
    if (selectedConversationDetailFollowUpTimerRef.current !== null) {
      window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
    }

    selectedConversationDetailFollowUpTimerRef.current = window.setTimeout(() => {
      selectedConversationDetailFollowUpTimerRef.current = null;
      void fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json().catch(() => null) : null))
        .then((payload) => {
          const snapshot = normalizeLiveConversationSnapshot((payload as { conversation?: unknown } | null)?.conversation);
          if (!snapshot) {
            return;
          }

          setLiveConversation((current) => {
            // La base para mergear el snapshot de /live SOLO puede ser una conversación cuyo id
            // COINCIDA con el snapshot. Si ni la actual ni la seleccionada coinciden, la base es
            // `null` (arranca limpio con solo el snapshot). Antes caía en
            // `selectedConversationRef.current` (la conversación ANTERIOR) y le mergeaba el snapshot
            // nuevo encima → los mensajes del chat viejo quedaban bajo el chat nuevo (el cruce real:
            // mis-amores bajo Vanessa/Karen). El servidor devolvía bien; el mix era este merge.
            const base = current && conversationIdMatchesKey(current.id, snapshot.id)
              ? current
              : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                  ? selectedConversationRef.current
                  : null);
            return mergeConversationSnapshotIfChanged(base, snapshot);
          });
        })
        .catch(() => null);
    }, 2500);
  }, []);

  useEffect(() => {
    const normalizedSelectedConversationId = selectedConversationKey;

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    const cancelarSegundoLive = () => {
      if (selectedConversationDetailFollowUpTimerRef.current !== null) {
        window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
        selectedConversationDetailFollowUpTimerRef.current = null;
      }
    };

    if (currentSelectedConversationHasContentRef.current) {
      // Sin primer /live (lo pinto el servidor): queda el refresco de siempre a los 2,5 s.
      programarSegundoLive(normalizedSelectedConversationId);
      return cancelarSegundoLive;
    }

    if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
      // Ya habia uno en camino para este chat (no lo controla esta corrida): queda el refresco de
      // siempre para no perder la carga.
      programarSegundoLive(normalizedSelectedConversationId);
      return cancelarSegundoLive;
    }

    selectedConversationDetailInFlightRef.current = normalizedSelectedConversationId;

    const controller = new AbortController();
    let cancelled = false;

    async function loadSelectedConversationDetail() {
      let necesitaSegundo = true;
      let cargo = false;
      try {
        // conLlamada=1: la ultima llamada viaja en esta misma respuesta (ver live/route.ts).
        const response = await fetch(
          `/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}&conLlamada=1`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown; mediosPendientes?: boolean }
          | null;

        if (!payload?.ok || !payload.conversation || cancelled) {
          return;
        }

        const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
        if (!snapshot || cancelled) {
          return;
        }

        necesitaSegundo = Boolean(payload.mediosPendientes);
        cargo = true;

        setLiveConversation((current) => {
          // Base = solo una conversación cuyo id coincide con el snapshot; si no, `null` (limpio).
          // Antes caía en la conversación anterior y le mergeaba el snapshot nuevo → cruce.
          const base = current && conversationIdMatchesKey(current.id, snapshot.id)
            ? current
            : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                ? selectedConversationRef.current
                : null);
          return mergeConversationSnapshotIfChanged(base, snapshot);
        });
      } catch {
        // Si falla, la vista cacheada/preview sigue siendo usable; abajo se marca el fallo.
      } finally {
        if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
          selectedConversationDetailInFlightRef.current = null;
        }
        // Antes un fallo aca era silencioso y, si no habia cache, la ruedita giraba sin fin. Ahora
        // se marca y el panel muestra "No se pudo abrir el chat" con Reintentar (si el chat sigue
        // en vista previa; si ya tenia contenido, no se molesta a nadie).
        if (!cancelled) {
          setFalloCargaDelChat(cargo ? null : normalizedSelectedConversationId);
        }
        // Fallo o quedaron medios pendientes: un solo reintento a los 2,5 s, como antes.
        if (!cancelled && necesitaSegundo) {
          programarSegundoLive(normalizedSelectedConversationId);
        }
      }
    }

    void loadSelectedConversationDetail();

    return () => {
      cancelled = true;
      controller.abort();
      cancelarSegundoLive();
    };
    // Dependemos solo de la clave efectiva (selectedConversationKey), no de
    // pendingConversation.chatKey y selectedConversationId por separado. Si dependiera de
    // ambos, cuando router.push actualiza selectedConversationId para "alcanzar" la
    // selección pendiente, el efecto se re-ejecutaría con la MISMA clave efectiva: el
    // cleanup abortaría el fetch en curso y la nueva corrida saldría por el guard de
    // in-flight, dejando el historial sin cargar hasta un segundo click.
    // (programarSegundoLive es estable: no vuelve a correr el efecto.)
    // reintentoCargaDelChat solo cambia cuando la asesora toca "Reintentar" en un chat que no cargo.
  }, [selectedConversationKey, programarSegundoLive, reintentoCargaDelChat]);

  const effectiveLiveConversation =
    liveConversation && conversationIdMatchesKey(selectedConversationId, liveConversation.id) ? liveConversation : null;
  const liveOrCachedConversation = useMemo(
    () =>
      mergeConversationSnapshots(
        currentSelectedConversation ?? null,
        // OJO: se usa `cachedConversationForCurrentSelection` (el cache VALIDADO por id), NO
        // `selectedConversationCache` a secas. El `readConversationFromCache(selectedKey)` hace un
        // lookup laxo (con y sin prefijo "agent:") y PUEDE devolver otra conversación; usarlo sin
        // validar acá era el cruce real: al cambiar de chat con clic, el cuerpo quedaba con los
        // mensajes del chat anterior (mis-amores bajo Karen/Vanessa). La versión validada es null
        // cuando el cache no corresponde al chat seleccionado.
        effectiveLiveConversation ?? cachedConversationForCurrentSelection,
      ),
    [cachedConversationForCurrentSelection, currentSelectedConversation, effectiveLiveConversation],
  );
  const hasLoadedSelectedConversationContent = Boolean(
    liveOrCachedConversation &&
      conversationIdMatchesKey(selectedConversationId, liveOrCachedConversation.id) &&
      liveOrCachedConversation.messages.length > 0,
  );
  const pendingConversationPreview = useMemo(
    () => {
      if (!pendingConversation) {
        return null;
      }

      if (optimisticConversation && conversationIdMatchesKey(pendingConversation.id, optimisticConversation.id)) {
        return optimisticConversation;
      }

      return buildPendingConversationPreview(pendingConversation);
    },
    [optimisticConversation, pendingConversation],
  );

  const computedRenderedConversation = useMemo(() => {
    // Si hay contenido en vivo o en caché para este chat (con mensajes), es la fuente
    // completa: mostrarlo de inmediato. La caché hace que reabrir un chat sea instantáneo.
    if (
      liveOrCachedConversation &&
      liveOrCachedConversation.messages.length > 0 &&
      // Comparar con conversationIdMatchesKey y NO con ===: los dos ids tienen formato distinto.
      // El del preview es la CLAVE del chat ("agent:cmxxx") y el del contenido real es el id
      // pelado ("cmxxx"), asi que === nunca daba verdadero. Antes no se notaba porque la
      // seleccion pendiente se borraba al completarse la navegacion y entonces mandaba el
      // "!pendingConversationPreview". Al pasar la seleccion a ser la fuente de verdad (ya no se
      // borra), esta comparacion rota quedaba siempre en falso: el chat se quedaba en preview
      // con el spinner "Cargando conversacion" para siempre, aunque /live ya hubiera respondido.
      (!pendingConversationPreview ||
        conversationIdMatchesKey(pendingConversationPreview.id, liveOrCachedConversation.id))
    ) {
      return liveOrCachedConversation;
    }

    // Sin caché todavía: mostramos el preview (último mensaje) mientras llega el historial.
    return pendingConversationPreview ?? liveOrCachedConversation;
  }, [liveOrCachedConversation, pendingConversationPreview]);

  // Anti-parpadeo: al cambiar de chat, el contenido pasa por estados intermedios
  // (preview → live/cache que momentáneamente llega sin mensajes → completo). Para no
  // mostrar un frame "vacío", si la versión calculada queda sin mensajes mantenemos la
  // última versión CON mensajes de la MISMA conversación (incluido el preview).
  const stickyRenderedConversationRef = useRef<SharedInboxSelectedConversation | null>(null);
  const renderedConversation = useMemo(() => {
    const computed = computedRenderedConversation;
    // INVARIANTE: solo se muestra contenido del chat SELECCIONADO. Sin esto, al cambiar de chat con
    // clic (sin recargar) quedaban pegados los mensajes del chat anterior: el `computed` seguía
    // siendo la conversación previa (con mensajes) y se devolvía tal cual, mientras el encabezado ya
    // mostraba el chat nuevo. Reproducido: mis-amores → clic Karen mostraba los mensajes de mis-amores.
    const matchesSelection = (conversation: SharedInboxSelectedConversation | null) =>
      Boolean(conversation && conversationIdMatchesKey(selectedConversationKey, conversation.id));

    if (computed && matchesSelection(computed) && computed.messages.length > 0) {
      stickyRenderedConversationRef.current = computed;
      return computed;
    }

    // Anti-parpadeo, pero SOLO dentro de la MISMA conversación seleccionada.
    const sticky = stickyRenderedConversationRef.current;
    if (sticky && conversationIdMatchesKey(selectedConversationKey, sticky.id)) {
      return sticky;
    }

    // Si el `computed` es de OTRA conversación (contenido pegado del chat anterior), no se muestra:
    // se deja vacío/cargando hasta que llegue el contenido del chat correcto.
    return matchesSelection(computed) ? computed : null;
  }, [computedRenderedConversation, selectedConversationKey]);

  // Medicion: toque en la fila (conversation-list) hasta que se pintan los mensajes del chat.
  // "cache" = salio de la cache del navegador; "servidor" = hubo que esperar a /live.
  useEffect(() => {
    if (
      !selectedConversationKey ||
      !renderedConversation ||
      renderedConversation.isPreview ||
      renderedConversation.messages.length === 0 ||
      !conversationIdMatchesKey(selectedConversationKey, renderedConversation.id)
    ) {
      return;
    }
    terminarMedicionAlPintar(`abrir:${selectedConversationKey}`, "abrir_chat", {
      origen: effectiveLiveConversation ? "servidor" : "cache",
    });
  }, [effectiveLiveConversation, renderedConversation, selectedConversationKey]);

  // Cuando el chat abierto ya tiene su contenido real, reiniciamos el estado de scroll/historial
  // y soltamos el preview optimista.
  //
  // Antes esto se disparaba con `pendingConversation.id === selectedConversationId`, o sea
  // "la navegacion alcanzo a la seleccion", y ahi ADEMAS borraba la seleccion para pasarle la
  // posta a la URL. Ese relevo ya no existe: abrir un chat no navega, asi que la seleccion ES
  // el chat abierto y borrarla lo cerraria. Peor: con el id sombreado la comparacion daria
  // siempre verdadera y lo cerraria apenas se abre. Ahora depende de que el contenido cargo,
  // que es lo que de verdad importaba, y NO toca la seleccion.
  useEffect(() => {
    if (!selectedConversationKey) {
      return;
    }

    historyLoadArmedRef.current = false;
    lastScrollTopRef.current = 0;
    setIsLoadingOlderMessages(false);

    if (hasLoadedSelectedConversationContent) {
      setOptimisticConversation(null);
    }
  }, [hasLoadedSelectedConversationContent, selectedConversationKey]);

  // Red de seguridad: si una seleccion pendiente nunca llega a resolverse (p. ej. el
  // servidor no devuelve el chat porque ya no esta asignado a este usuario), el overlay
  // "Historial" quedaria girando indefinidamente y confunde al empleado. Tras un tiempo
  // prudente sin resolver, limpiamos la seleccion para volver al estado vacio en vez de
  // dejar el spinner colgado.
  //
  // 10-10-2026: antes, a los 10 s cerraba el chat EN SILENCIO (el chat desaparecia y la asesora no
  // sabia por que) y, si habia cache de la fila, ni eso: la ruedita giraba sin fin. Ahora, pasado
  // el limite, se marca el fallo y el panel muestra "No se pudo abrir el chat · Reintentar". El
  // chat no se cierra solo: la asesora decide si reintenta o vuelve a la lista.
  useEffect(() => {
    if (!selectedConversationKey || hasLoadedSelectedConversationContent) {
      return;
    }

    const chatQueCarga = selectedConversationKey;
    const timer = window.setTimeout(() => {
      setFalloCargaDelChat(chatQueCarga);
    }, LIMITE_CARGA_CHAT_MS);

    return () => window.clearTimeout(timer);
  }, [hasLoadedSelectedConversationContent, reintentoCargaDelChat, selectedConversationKey]);

  const reintentarCargaDelChat = useCallback(() => {
    setFalloCargaDelChat(null);
    // Si el pedido anterior quedo colgado, no debe frenar el nuevo (ver el guard de in-flight).
    selectedConversationDetailInFlightRef.current = null;
    setReintentoCargaDelChat((actual) => actual + 1);
  }, []);

  useEffect(() => {
    if (!renderedConversation || renderedConversation.isPreview) {
      return;
    }

    saveConversationToCache(renderedConversation);
  }, [renderedConversation]);

  const loadOlderMessages = useCallback(async () => {
    const conversation = renderedConversation;
    const loadMoreCursor = conversation?.loadMoreCursor?.trim() || "";
    const chatKey = conversation?.cacheKey?.trim() || selectedConversationId.trim();
    let shouldRestoreScroll = false;

    if (
      !conversation ||
      !chatKey ||
      !loadMoreCursor ||
      !conversation.hasMoreMessages ||
      loadMoreHistoryInFlightRef.current
    ) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    loadMoreHistoryInFlightRef.current = true;
    setIsLoadingOlderMessages(true);
    historyRestoreGuardUntilRef.current = Date.now() + 4000;
    loadMoreHistoryRestoreRef.current = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };

    try {
      const response = await fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}&beforeMessageId=${encodeURIComponent(loadMoreCursor)}&batchSize=30`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; conversation?: unknown }
        | null;

      if (!payload?.ok || !payload.conversation) {
        return;
      }

      const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
      if (!snapshot) {
        return;
      }

      shouldRestoreScroll = true;
      setLiveConversation((current) => {
        // Base = solo una conversación cuyo id coincide con el snapshot; si no, `null` (no mergear
        // sobre la conversación anterior, que era el cruce).
        const base = current && conversationIdMatchesKey(current.id, snapshot.id)
          ? current
          : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
              ? selectedConversationRef.current
              : null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
    } catch {
      // Ignore loading failures so scroll never gets blocked.
    } finally {
      if (!shouldRestoreScroll) {
        loadMoreHistoryRestoreRef.current = null;
      }
      loadMoreHistoryInFlightRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [renderedConversation, selectedConversation, selectedConversationId]);

  // El mensaje optimista lleva el texto que la persona escribio; el persistido puede tener la
  // firma del usuario agregada ARRIBA en el servidor (prependUserChatSignature). Por eso no se
  // comparan por igualdad exacta —quedarian como dos mensajes distintos y se veria duplicado
  // hasta recargar— sino aceptando que el real TERMINE con el texto optimista.
  // Normaliza para comparar: colapsa saltos de linea/espacios a uno solo. La firma se une
  // con "\n" en el servidor y el texto optimista puede tener otros espacios, asi que sin
  // esto el endsWith fallaba por un salto de linea y el mensaje se veia DUPLICADO hasta
  // recargar (la burbuja optimista no se reemplazaba por la real).
  const normalizeForOutgoingMatch = (value: string) => value.replace(/\s+/g, " ").trim();
  const optimisticOutgoingContent = normalizeForOutgoingMatch(
    optimisticOutgoingMessage?.matchContent ?? optimisticOutgoingMessage?.content ?? "",
  );
  const persistedMatchesOptimisticContent = (persisted: string | null | undefined) => {
    if (!optimisticOutgoingContent) {
      return false;
    }
    const value = normalizeForOutgoingMatch(persisted ?? "");
    return value === optimisticOutgoingContent || value.endsWith(optimisticOutgoingContent);
  };
  const optimisticDraftMatchesLatestMessage =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.at(-1)?.direction === "OUTBOUND" &&
        persistedMatchesOptimisticContent(renderedConversation.messages.at(-1)?.content),
    );
  const optimisticDraftHasPersistedMatch =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.some((message) =>
          message.direction === "OUTBOUND" &&
          message.type === optimisticOutgoingMessage.type &&
          persistedMatchesOptimisticContent(message.content) &&
          Math.abs(message.createdAt.getTime() - optimisticOutgoingMessage.createdAt.getTime()) < 120_000,
        ),
    );
  /*
    Los "No se envió" de este chat, al final. Si el mismo texto ya aparece guardado despues (la
    asesora lo mando de nuevo a mano), la burbuja fallida se oculta: ya salio.
  */
  const fallidosVisibles = useMemo(() => {
    if (!renderedConversation || renderedConversation.isPreview) {
      return [];
    }
    return fallidosDelChat(mensajesFallidos, renderedConversation.id).filter(
      (fallido) =>
        !renderedConversation.messages.some(
          (message) =>
            message.direction === "OUTBOUND" &&
            message.createdAt.getTime() >= fallido.createdAt.getTime() - 5_000 &&
            textoCoincideConGuardado(message.content, fallido.matchContent ?? fallido.content),
        ),
    );
  }, [mensajesFallidos, renderedConversation]);
  const baseRenderedMessages = useMemo(() => {
    const guardados = renderedConversation?.messages ?? [];
    // Lo que no salio va en su hora entre lo guardado (sort estable); al final el texto en camino.
    const base =
      fallidosVisibles.length > 0
        ? [...guardados, ...fallidosVisibles].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        : guardados;
    return renderedConversation &&
      optimisticOutgoingMessage &&
      renderedConversation.id === optimisticOutgoingMessage.conversationId &&
      !optimisticDraftMatchesLatestMessage &&
      !optimisticDraftHasPersistedMatch
      ? [...base, optimisticOutgoingMessage]
      : base;
  }, [fallidosVisibles, optimisticDraftHasPersistedMatch, optimisticDraftMatchesLatestMessage, optimisticOutgoingMessage, renderedConversation]);
  // Aplica borrados optimistas: marca como eliminado al instante mientras el
  // servidor confirma (si falla, se revierte el id en deletedMessageIds).
  const renderedMessages = useMemo(
    () =>
      deletedMessageIds.size === 0
        ? baseRenderedMessages
        : baseRenderedMessages.map((message) =>
            deletedMessageIds.has(message.id) && !message.deletedAt
              ? { ...message, deletedAt: new Date() }
              : message,
          ),
    [baseRenderedMessages, deletedMessageIds],
  );
  // Ref para leer el último mensaje dentro de efectos sin meter el array en deps
  // (un array en deps cambia de tamaño y React lanza error).
  const renderedMessagesRef = useRef(renderedMessages);
  renderedMessagesRef.current = renderedMessages;

  useEffect(() => {
    if (!optimisticOutgoingMessage || !renderedConversation) {
      return;
    }

    if (renderedConversation.id !== optimisticOutgoingMessage.conversationId) {
      return;
    }

    if (!optimisticDraftHasPersistedMatch) {
      return;
    }

    setOptimisticOutgoingMessage(null);
  }, [optimisticDraftHasPersistedMatch, optimisticOutgoingMessage, renderedConversation]);

  // Resuelve la burbuja optimista segun el resultado de la accion de envio:
  // - result null  -> la accion lanzo excepcion -> marcar "error" (+ Reintentar)
  // - result.ok === false -> error de validacion interna -> marcar "error"
  // - result.suppressOptimistic -> se disparo un flujo -> quitar la burbuja del texto
  // - ok (o void) -> dejar la burbuja; el sync en tiempo real la reemplaza por el real
  const finalizeOptimisticSend = useCallback(
    (optimisticId: string, result: { ok?: boolean; suppressOptimistic?: boolean; error?: string } | null) => {
      terminarMedicion(`envio:${optimisticId}`, "enviar_ok", {
        ok: Boolean(result && result.ok !== false),
        suprimido: Boolean(result?.suppressOptimistic),
      });
      // Se resuelve contra el registro del envio y NO contra el espacio optimista: si la asesora ya
      // mando otro texto (en otro chat), el espacio es de ese otro y antes la falla se perdia.
      const enviado = enviosEnCursoRef.current.get(optimisticId) ?? null;
      enviosEnCursoRef.current.delete(optimisticId);

      if (!result || result.ok === false) {
        const errorMessage = result?.error?.trim() || "No se pudo enviar el mensaje";
        console.error("[SharedInbox] send failed", { optimisticId, error: errorMessage });
        toast.error(errorMessage);
        if (enviado) {
          // Queda guardado como "No se envió" con Reintentar y Copiar; el siguiente mensaje ya no lo borra.
          setMensajesFallidos((lista) =>
            agregarFallido(lista, { ...enviado, outboundStatusLabel: "error", errorDetail: errorMessage }),
          );
        }
        setOptimisticOutgoingMessage((current) => (current && current.id === optimisticId ? null : current));
      } else if (result.suppressOptimistic) {
        setOptimisticOutgoingMessage((current) => (current && current.id === optimisticId ? null : current));
      }

      if (result?.ok && !result.suppressOptimistic) {
        scheduleConversationRefreshAfterSend();
      }
    },
    [scheduleConversationRefreshAfterSend],
  );

  /*
    Anti doble envio: mientras un texto de un chat va en camino, ese chat no acepta otro submit.
    Si el envio tardaba, la asesora volvia a darle enviar y el cliente recibia el mismo texto varias
    veces. El ref corta al instante (doble clic); el estado deshabilita el boton.
  */
  const textoEnCursoRef = useRef<Set<string>>(new Set());
  const [chatsConTextoEnCurso, setChatsConTextoEnCurso] = useState<string[]>([]);

  const handleComposerDraft = useCallback(
    (message: string, formData: FormData): boolean => {
      if (!renderedConversation || !composer) {
        return false;
      }
      /*
        Nunca al chat equivocado. Mientras el chat abierto es la vista previa de la lista, los
        campos ocultos del formulario siguen apuntando al chat con el que cargo la pagina: escribir
        rapido apenas abierto un chat le mandaba el texto AL CLIENTE ANTERIOR. Ahora solo se envia
        si el chat cargado en pantalla es el abierto, y el destino se fija aca (no se confia en los
        campos ocultos). El texto se queda en el cuadro.
      */
      const destino = resolverDestinoDelEnvio({
        chatAbiertoKey: selectedConversationKey,
        chatCargado: renderedConversation,
      });
      if (!destino.ok) {
        toast.info(destino.mensaje);
        return false;
      }
      formData.set("conversationId", destino.conversationId);
      formData.set("source", selectedConversationKey.startsWith("official:") ? "official" : "agent");
      // El servidor verifica que el destino sea este chat (ver verificarDestinoDelEnvio).
      formData.set("chatEsperado", destino.chatEsperado);

      const chatDelEnvio = selectedConversationId;
      if (textoEnCursoRef.current.has(chatDelEnvio)) {
        return false;
      }
      textoEnCursoRef.current.add(chatDelEnvio);
      setChatsConTextoEnCurso((actual) => [...actual, chatDelEnvio]);
      const liberar = () => {
        textoEnCursoRef.current.delete(chatDelEnvio);
        setChatsConTextoEnCurso((actual) => actual.filter((chat) => chat !== chatDelEnvio));
      };

      const now = new Date();
      const optimisticId = `optimistic:${renderedConversation.id}:${Date.now()}`;
      // Misma regla de firma que el servidor (src/lib/firma-del-chat.ts): la burbuja y la fila
      // salen ya firmadas y no "saltan" cuando llega el mensaje real. La conciliacion se sigue
      // haciendo con `message` (sin firma), ver persistedMatchesOptimisticContent.
      const mensajeVisible =
        formData.get("skipSignature") === "1" ? message : aplicarFirmaDelChat(message, chatSignature);
      // Medicion: enviar -> burbuja pintada y enviar -> ok del servidor.
      iniciarMedicion(`burbuja:${optimisticId}`);
      iniciarMedicion(`envio:${optimisticId}`);
      const optimisticListSnapshot = {
        id: renderedConversation.id,
        label: renderedConversation.label,
        secondaryLabel: renderedConversation.secondaryLabel,
        tags: renderedConversation.tags ?? [],
        avatarUrl: renderedConversation.avatarUrl ?? null,
        incomingCount: 0,
        lastMessage: mensajeVisible,
        lastMessageType: "TEXT" as const,
        lastMessageDirection: "OUTBOUND" as const,
        lastMessageAt: now,
        channelType: selectedConversationId.startsWith("official:") ? "whatsapp_official" : "whatsapp",
      };

      // La burbuja aparece al instante y se ve como un mensaje ya enviado
      // (sin etiqueta "enviando" ni atenuado). Si falla, se marca "error" despues.
      const burbuja: OptimisticDraftMessage = {
        id: optimisticId,
        conversationId: renderedConversation.id,
        content: mensajeVisible,
        matchContent: message,
        direction: "OUTBOUND",
        createdAt: now,
        authorType: "user",
        outboundStatusLabel: null,
        type: "TEXT",
        mediaUrl: null,
        rawPayload: replyTarget
          ? {
              optimistic: true,
              replyTo: {
                content: replyTarget.content,
                direction: replyTarget.direction,
                type: replyTarget.type,
              },
            }
          : { optimistic: true },
        isOptimistic: true,
      };
      setOptimisticOutgoingMessage(burbuja);
      terminarMedicionAlPintar(`burbuja:${optimisticId}`, "enviar_burbuja");
      window.requestAnimationFrame(() => {
        const container = messagesScrollRef.current;
        if (!container) {
          return;
        }

        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        isNearBottomRef.current = true;
        setUnreadCount(0);
      });

      window.dispatchEvent(
        new CustomEvent("chat-list-update", {
          detail: {
            conversation: optimisticListSnapshot,
            // Fila optimista armada aca: no debe pedir /list al servidor (ver handleListUpdate).
            local: true,
          },
        }),
      );

      // Cita (Responder): mandamos el id (para citar en WhatsApp) y el preview
      // (texto + dirección) para que la cita se guarde y se vea siempre.
      if (replyTarget) {
        formData.set("quotedMessageId", replyTarget.id);
        formData.set("quotedContent", replyTarget.content);
        formData.set("quotedDirection", replyTarget.direction);
        setReplyTarget(null);
      }

      // Registro del envio: si falla, de aca sale la burbuja "No se envió" y su Reintentar.
      enviosEnCursoRef.current.set(optimisticId, {
        ...burbuja,
        envio: { chatKey: chatDelEnvio, campos: camposDelFormulario(formData) },
      });

      // Envio sin navegacion: la accion valida internamente y devuelve un resultado.
      void Promise.resolve(composer.action(formData))
        .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
        .catch(() => finalizeOptimisticSend(optimisticId, null))
        .finally(liberar);
      return true;
    },
    [renderedConversation, selectedConversationId, selectedConversationKey, composer, finalizeOptimisticSend, replyTarget, chatSignature],
  );

  const handleReplyToMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const typeLabels: Record<string, string> = {
      IMAGE: "Imagen",
      AUDIO: "Audio",
      VIDEO: "Video",
      STICKER: "Sticker",
      DOCUMENT: "Documento",
    };
    const previewText = (target.content ?? "").trim() || typeLabels[target.type ?? "TEXT"] || "Mensaje";
    setReplyTarget({
      id: target.id,
      content: previewText,
      type: target.type ?? "TEXT",
      direction: target.direction,
    });
  }, []);

  const handleCancelReply = useCallback(() => setReplyTarget(null), []);

  const handleDeleteMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const isOutbound = target.direction === "OUTBOUND";
    const confirmText = isOutbound
      ? "¿Eliminar este mensaje? Se borrará también en el WhatsApp del cliente."
      : "¿Eliminar este mensaje de la bandeja? (Seguirá en el WhatsApp del cliente.)";
    if (typeof window !== "undefined" && !window.confirm(confirmText)) {
      return;
    }

    // Borrado optimista: se marca "eliminado" al instante. Si falla, se revierte.
    setDeletedMessageIds((current) => {
      const next = new Set(current);
      next.add(target.id);
      return next;
    });

    const formData = new FormData();
    formData.set("messageId", target.id);
    void Promise.resolve(deleteChatMessageAction(formData))
      .then((result) => {
        if (!result?.ok) {
          setDeletedMessageIds((current) => {
            const next = new Set(current);
            next.delete(target.id);
            return next;
          });
          toast.error(result?.error || "No se pudo eliminar el mensaje");
        }
      })
      .catch(() => {
        setDeletedMessageIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
        toast.error("No se pudo eliminar el mensaje");
      });
  }, []);

  useEffect(() => {
    setReplyTarget(null);
  }, [selectedConversationId]);
  // El envio de AUDIO y de ARCHIVOS no usa los campos ocultos del formulario: lleva su propio
  // conversationId dentro de composer.audio / composer.media, que arma el servidor para el chat
  // que venia en la URL. Sin navegacion ese id queda congelado, asi que mandar una nota de voz o
  // una foto desde un chat abierto con click se la enviaria AL CLIENTE EQUIVOCADO. Se reapunta al
  // chat cargado, igual que los campos ocultos.
  const effectiveComposer = useMemo(() => {
    if (!composer) {
      return composer;
    }

    const targetId = renderedConversation && !renderedConversation.isPreview ? renderedConversation.id : null;
    // El servidor manda audio/media SIEMPRE como plantilla (ver page.tsx). Aca se apunta al chat
    // abierto: hace falta un chat cargado de verdad (no el preview).
    if (!targetId) {
      return { ...composer, audio: undefined, media: undefined };
    }

    // Y se marca a QUE canal va, para que la accion de envio use Meta o Evolution segun el chat.
    // Antes en los chats de la API oficial se apagaban del todo: por eso ahi no aparecia el "+"
    // y no se podia mandar una foto ni el catalogo en PDF.
    const source = selectedConversationId.startsWith("official:") ? "official" : "agent";

    return {
      ...composer,
      audio: composer.audio ? { ...composer.audio, conversationId: targetId, source } : undefined,
      media: composer.media ? { ...composer.media, conversationId: targetId, source } : undefined,
    };
  }, [composer, renderedConversation, selectedConversationId]);

  // Controles de la cabecera (etapa del CRM, pausar la IA, resolver, importar historial) armados
  // en el CLIENTE con los datos que trae /live.
  //
  // El servidor tambien los manda (prop headerActions), pero los arma para el chat que venia en
  // la URL al cargar la pagina. Como abrir un chat ya no navega, ese elemento queda congelado en
  // el chat viejo —o es null si se entro por la lista—, y la vendedora se quedaba sin los botones
  // que mas usa. Se prefiere la version del cliente cuando hay datos frescos y se cae al prop del
  // servidor mientras no los haya (primer render por deep link).
  const clientHeaderActions = useMemo(() => {
    const conversation = renderedConversation;
    if (
      !conversation ||
      conversation.isPreview ||
      !selectedConversationKey.startsWith("agent:") ||
      !conversation.contactId ||
      !conversation.crmStage
    ) {
      return null;
    }

    return (
      <ChatHeaderActions
        key={`header-actions:${conversation.id}:${conversation.status ?? "OPEN"}`}
        contactId={conversation.contactId}
        stage={conversation.crmStage as CrmStage}
        /*
          Se pasa el DESTINO de la llamada, que puede ser un telefono o el identificador oculto de
          WhatsApp. A los leads de anuncios -que llegan sin telefono- ahora tambien se les puede
          llamar: probado el 25-09-2026 y el boton ya no se apaga con ellos.
        */
        telefono={resolveCallTarget({ phoneNumber: conversation.secondaryLabel })}
        nombreContacto={conversation.label}
        channelId={conversation.channelId ?? null}
        avatarUrl={conversation.avatarUrl ?? null}
        conversationId={conversation.id}
        automationPaused={Boolean(conversation.automationPaused)}
        status={conversation.status ?? "OPEN"}
        returnTo={typeof window === "undefined" ? "" : window.location.pathname + window.location.search}
        toggleAutomationAction={toggleConversationAutomationAction}
      />
    );
  }, [renderedConversation, selectedConversationKey]);

  /*
    La fila de la lista del chat abierto. Ya trae etapa, asignada, agente y estado (misma consulta
    de la lista): con eso la barra se dibuja AL TOCAR, sin esperar a /live, que despues la corrige
    si algo cambio. 0 pedidos mas.
  */
  const filaDelChatAbierto = useMemo(
    () =>
      selectedConversationKey.startsWith("agent:")
        ? conversationItems.find((item) => item.id === selectedConversationKey) ?? null
        : null,
    [conversationItems, selectedConversationKey],
  );

  // La barra de abajo de la cabecera angosta, con los mismos datos frescos que la cabecera.
  // Mientras llega /live se arma con la fila; si a la fila le falta algo, siluetas del mismo alto.
  const { clientHeaderBar, barraAnticipada } = useMemo(() => {
    const conversation = renderedConversation;
    if (!conversation || !selectedConversationKey.startsWith("agent:")) {
      return { clientHeaderBar: null, barraAnticipada: false };
    }

    const conversationId = extractConversationIdFromKey(selectedConversationKey);
    const returnTo = typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
    const datosDeLive = !conversation.isPreview && conversation.contactId && conversation.crmStage;

    if (datosDeLive) {
      return {
        barraAnticipada: false,
        clientHeaderBar: (
          <BarraDeAccionesDelChat
            key={`header-bar:${conversationId}:${conversation.status ?? "OPEN"}`}
            contactId={conversation.contactId ?? null}
            stage={conversation.crmStage as CrmStage}
            conversationId={conversation.id}
            automationPaused={Boolean(conversation.automationPaused)}
            status={conversation.status ?? "OPEN"}
            returnTo={returnTo}
            toggleAutomationAction={toggleConversationAutomationAction}
            assignee={conversation.assignedTo ? { ...conversation.assignedTo, email: conversation.assignedTo.email ?? "" } : null}
          />
        ),
      };
    }

    // Ya asentado pero sin ficha del CRM: igual que antes, sin barra propia.
    if (!conversation.isPreview && conversation.contactId) {
      return { clientHeaderBar: null, barraAnticipada: false };
    }

    const fila = filaDelChatAbierto;
    const filaCompleta =
      fila?.contactId &&
      fila.crmStage &&
      fila.assignedToUserId !== undefined &&
      fila.automationPaused !== undefined &&
      fila.automationPaused !== null;

    return {
      barraAnticipada: true,
      clientHeaderBar: filaCompleta ? (
        <BarraDeAccionesDelChat
          // Misma clave que la de /live: al llegar no se vuelve a montar, solo cambian los datos.
          key={`header-bar:${conversationId}:${fila.status ?? "OPEN"}`}
          contactId={fila.contactId ?? null}
          stage={fila.crmStage as CrmStage}
          conversationId={conversationId}
          automationPaused={Boolean(fila.automationPaused)}
          status={fila.status ?? "OPEN"}
          returnTo={returnTo}
          toggleAutomationAction={toggleConversationAutomationAction}
          assignee={
            fila.assignedToUserId
              ? { id: fila.assignedToUserId, name: fila.assignedToName ?? null, email: "" }
              : null
          }
        />
      ) : (
        <BarraDeAccionesEnSilueta />
      ),
    };
  }, [filaDelChatAbierto, renderedConversation, selectedConversationKey]);

  /*
    Botones de la ficha del contacto (copiar la conversacion, traer el historial) armados en el CLIENTE.

    Mismo problema que la cabecera: el servidor los arma solo para el chat que venia en la URL. Abriendo
    un chat con un toque -como entra una asesora desde el celular- la ficha salia sin "Cargar historial"
    (Genesis, 14-sep-2026). /live ya trae canImportHistory; con eso alcanza.
  */
  const clientContactPanelHeaderActions = useMemo(() => {
    const conversation = renderedConversation;
    if (!conversation || conversation.isPreview || !selectedConversationKey.startsWith("agent:")) {
      return null;
    }
    return (
      <MenuDelContacto
        key={`panel-menu:${selectedConversationKey}`}
        chatKey={selectedConversationKey}
        label={conversation.label}
        phone={conversation.secondaryLabel}
        conversationId={conversation.id}
        puedeTraerHistorial={Boolean(conversation.canImportHistory)}
      />
    );
  }, [renderedConversation, selectedConversationKey]);

  /*
    El bloque "Agente asignado" de la ficha, armado en el CLIENTE con el chat que esta abierto.

    Venia tal cual del servidor, y el servidor lo arma para el chat que traia la URL. Abriendo un
    chat con un toque -como entran las asesoras desde el celular- la ficha mostraba la asesora del
    chat ANTERIOR hasta que la pantalla se volvia a pedir entera, segundos despues, y ahi saltaba a
    la correcta: "sale Ingrid y despues pasa a Maria". Visto asi, parecia que alguien le estaba
    cambiando los chats a Ingrid, y nadie lo hacia (Alex, 30-09-2026). Mientras el chat carga no
    se muestra nadie: vacio un instante es mejor que el nombre equivocado.
  */
  const clientContactPanelActions = useMemo(() => {
    const conversation = renderedConversation;
    const esOficial = selectedConversationKey.startsWith("official:");
    if (
      !conversation ||
      conversation.isPreview ||
      (!esOficial && !selectedConversationKey.startsWith("agent:")) ||
      !conversationIdMatchesKey(selectedConversationKey, conversation.id)
    ) {
      return null;
    }
    return (
      <AssignChatControl
        key={`panel-assign:${selectedConversationKey}`}
        conversationId={conversation.id}
        // El selector pide el correo como texto: una cuenta sin correo trae null, y se muestra por nombre.
        assignee={conversation.assignedTo ? { ...conversation.assignedTo, email: conversation.assignedTo.email ?? "" } : null}
        source={esOficial ? "official" : "agent"}
      />
    );
  }, [renderedConversation, selectedConversationKey]);

  // "El chat ya esta asentado" = tenemos el contenido real del chat abierto, no el preview.
  // Antes se comprobaba contra currentSelectedConversation, que sale del prop del SERVIDOR: al
  // no navegar ese prop se congela en el chat con el que cargo la pagina y esto quedaba siempre
  // en falso, escondiendo los botones del encabezado (etapa del CRM, etiquetas, acciones).
  const hasSettledConversation = Boolean(
    renderedConversation &&
      !renderedConversation.isPreview &&
      conversationIdMatchesKey(selectedConversationKey, renderedConversation.id),
  );
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;
  const canLoadOlderMessagesRef = useRef(canLoadOlderMessages);
  canLoadOlderMessagesRef.current = canLoadOlderMessages;
  const loadMoreHrefRef = useRef(renderedConversation?.loadMoreHref ?? null);
  loadMoreHrefRef.current = renderedConversation?.loadMoreHref ?? null;
  const messageScrollBehaviorRef = useRef(messageScrollBehavior);
  messageScrollBehaviorRef.current = messageScrollBehavior;
  // OJO: comparar con conversationIdMatchesKey y no con ===. pendingConversation.id es la CLAVE
  // ("agent:cmxxx") y renderedConversation.id es el id pelado ("cmxxx"), asi que === siempre da
  // falso. Y esto no es cosmetico: buildComposerHiddenFields es lo que reescribe el
  // conversationId del formulario de envio. Si no entra, el formulario se queda con los campos
  // del servidor —congelados en el chat con el que cargo la pagina— y el mensaje se le manda AL
  // CLIENTE EQUIVOCADO. Antes quedaba tapado porque la seleccion pendiente se borraba al
  // completarse la navegacion y ahi el chat renderizado ya era el del servidor.
  // Se apunta al chat REALMENTE cargado (renderedConversation.id ya es el id pelado que espera la
  // accion de envio) y no a la clave de la seleccion. Si todavia no hay chat cargado se pasa null
  // y mandan los campos del servidor: es preferible el comportamiento viejo a inventar un id.
  const composerHiddenFields = composer
    ? buildComposerHiddenFields(
        composer.hiddenFields,
        pendingConversation &&
          renderedConversation &&
          !renderedConversation.isPreview &&
          conversationIdMatchesKey(pendingConversation.id, renderedConversation.id)
          ? {
              conversationId: renderedConversation.id,
              source: pendingConversation.source ?? "agent",
              agentId: pendingConversation.agentId ?? null,
            }
          : null,
      )
    : [];
  // Refs para mantener estable handleRetryFailedMessage (asi MessageBubble no
  // re-renderiza toda la lista en cada render por un callback nuevo).
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const composerHiddenFieldsRef = useRef(composerHiddenFields);
  composerHiddenFieldsRef.current = composerHiddenFields;

  const handleRetryFailedMessage = useCallback((target: SharedInboxMessageItem) => {
    const composerValue = composerRef.current;
    const failed = mensajesFallidosRef.current.find((item) => item.id === target.id) ?? null;
    // Se reenvia el texto SIN firma (la pone el servidor). Si la burbuja salio sin firma
    // (respuesta rapida o firma apagada), el reintento tambien va sin firma.
    const text = (failed?.matchContent ?? failed?.content)?.trim();
    if (!composerValue || !failed || !text) {
      return;
    }

    // Mismo candado anti doble envio que el cuadro de texto: antes el reintento no lo usaba y un
    // doble toque mandaba el texto dos veces.
    const chatDelEnvio = failed.envio?.chatKey ?? `agent:${failed.conversationId}`;
    if (textoEnCursoRef.current.has(chatDelEnvio)) {
      toast.info("Espera a que salga el mensaje anterior.");
      return;
    }

    // Se repite el envio TAL CUAL (mismo chat, misma firma, misma cita), no con los campos del
    // chat que este abierto ahora.
    const formData = new FormData();
    if (failed.envio) {
      for (const [nombre, valor] of failed.envio.campos) {
        formData.set(nombre, valor);
      }
    } else {
      for (const field of composerHiddenFieldsRef.current) {
        formData.set(field.name, field.value);
      }
      formData.set("conversationId", failed.conversationId);
      formData.set("chatEsperado", failed.conversationId);
      if (failed.matchContent !== undefined && failed.content === failed.matchContent) {
        formData.set("skipSignature", "1");
      }
    }
    formData.set("message", text);

    textoEnCursoRef.current.add(chatDelEnvio);
    setChatsConTextoEnCurso((actual) => [...actual, chatDelEnvio]);
    const liberar = () => {
      textoEnCursoRef.current.delete(chatDelEnvio);
      setChatsConTextoEnCurso((actual) => actual.filter((chat) => chat !== chatDelEnvio));
    };

    // Reintento: sale de la lista de fallidos y vuelve a verse como texto en camino; si vuelve a
    // fallar, regresa a "No se envió" con su texto.
    const optimisticId = `optimistic:${failed.conversationId}:${Date.now()}`;
    const burbuja: OptimisticDraftMessage = {
      ...failed,
      id: optimisticId,
      outboundStatusLabel: null,
      errorDetail: null,
      createdAt: new Date(),
    };
    setMensajesFallidos((lista) => quitarFallido(lista, failed.id));
    setOptimisticOutgoingMessage(burbuja);
    enviosEnCursoRef.current.set(optimisticId, burbuja);

    void Promise.resolve(composerValue.action(formData))
      .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
      .catch(() => finalizeOptimisticSend(optimisticId, null))
      .finally(liberar);
  }, [finalizeOptimisticSend]);
  // Identidad estable de la conversación: normalizamos el id (el preview viene como
  // "agent:<id>" y el cargado como "<id>"), si no, split(":")[0] daría "agent" para todos
  // los chats y no detectaría el cambio de conversación → el scroll no bajaría al fondo.
  // Usamos "|" como separador porque el id puede contener ":".
  const selectedConversationScrollKey = renderedConversation
    ? `${extractConversationIdFromKey(renderedConversation.id)}|${renderedMessages.length}|${renderedMessages.at(-1)?.id ?? ""}`
    : "empty";
  const hasSidebar = sidebarItems.length > 0;

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  // Reset scroll state when the user opens a different conversation.
  useEffect(() => {
    isNearBottomRef.current = true;
    setUnreadCount(0);
    showJumpToBottomRef.current = false;
    setShowJumpToBottom(false);
    prevScrollKeyRef.current = "";
    lastScrollTopRef.current = 0;
    historyLoadArmedRef.current = false;
    historyLoadConsumedRef.current = false;
  }, [selectedConversationId]);

  // Track whether the user is near the bottom of the message list and only arm
  // older-history loading after the user actually scrolls upward.
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const BOTTOM_SCROLL_THRESHOLD_PX = 24;
    const TOP_SCROLL_THRESHOLD_PX = 96;
    const JUMP_TO_BOTTOM_THRESHOLD_PX = 220;

    function handleScroll() {
      const el = container!;
      const nextScrollTop = el.scrollTop;
      const previousScrollTop = lastScrollTopRef.current;
      // Ventana tras abrir el chat: ignoramos los scrolls programáticos (pin al fondo) para
      // no armar ni lanzar la carga de mensajes anteriores, que anclaría la vista arriba.
      const historyLoadSuppressed = suppressHistoryLoadUntilRef.current > Date.now();

      if (!historyLoadSuppressed && nextScrollTop < previousScrollTop) {
        historyLoadArmedRef.current = true;
      }

      if (nextScrollTop > TOP_SCROLL_THRESHOLD_PX) {
        historyLoadConsumedRef.current = false;
      }

      lastScrollTopRef.current = nextScrollTop;

      const distFromBottom = el.scrollHeight - nextScrollTop - el.clientHeight;
      isNearBottomRef.current = distFromBottom <= BOTTOM_SCROLL_THRESHOLD_PX;
      if (isNearBottomRef.current) setUnreadCount(0);

      // El boton aparece cuando ya se subio lo suficiente como para perder de vista el final.
      // El margen es mas ancho que el de "estoy al fondo" para que no parpadee al desplazarse.
      const debeMostrarse = distFromBottom > JUMP_TO_BOTTOM_THRESHOLD_PX;
      if (debeMostrarse !== showJumpToBottomRef.current) {
        showJumpToBottomRef.current = debeMostrarse;
        setShowJumpToBottom(debeMostrarse);
      }

      /*
        Quien dispara la carga es el observador de mas abajo, no un umbral de pixeles.

        Medir "estoy a menos de 96 px del tope" falla justo en el celular: con el impulso del dedo
        el scroll pasa de largo esa franja entre dos mediciones y no se dispara nada. Ademas
        llevaba dos banderas -"armado" y "ya consumido"- para no repetirse, y despues de la primera
        carga habia que apretar el boton a mano, que es lo que reporto Alex.
      */
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [router]);

  /**
   * Al llegar arriba, trae los mensajes anteriores solo.
   *
   * Se vigila un elemento invisible puesto arriba de todo: cuando entra en pantalla, se pide la
   * pagina anterior. El navegador avisa por su cuenta, asi que no depende de cuanto se movio el
   * dedo ni de que el scroll caiga dentro de una franja de pixeles —con el impulso de un celular
   * eso se saltea, y por eso habia que apretar el boton—.
   *
   * El margen de 300px lo dispara ANTES de tocar el borde, para que los mensajes ya esten cuando
   * uno llega.
   *
   * Se respeta la ventana de silencio de despues de abrir el chat: ahi el scroll lo mueve el
   * codigo (el pin al fondo) y sin eso cada apertura pediria historial sin que nadie lo pida.
   */
  useEffect(() => {
    const centinela = loadMoreSentinelRef.current;
    const contenedor = messagesScrollRef.current;
    if (!centinela || !contenedor) {
      return;
    }

    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) {
          return;
        }
        if (suppressHistoryLoadUntilRef.current > Date.now() || loadMoreHistoryInFlightRef.current) {
          return;
        }

        /*
          Primero el camino liviano, y la navegacion como ultimo recurso.

          Estaba al reves: al llegar arriba se hacia `router.replace`, o sea el servidor rearmaba
          la PAGINA ENTERA -lista, panel, contadores- para traer veinte mensajes viejos. El otro
          camino pide solo los mensajes y los agrega arriba conservando la posicion, que es lo que
          uno espera al subir en una conversacion.

          La navegacion queda por si algun chat llega sin cursor -no deberia, el bloque que dibuja
          el centinela exige tenerlo- para no dejar el historial inalcanzable.
        */
        if (canLoadOlderMessagesRef.current) {
          void loadOlderMessagesRef.current();
          return;
        }
        const loadMoreHref = loadMoreHrefRef.current;
        if (loadMoreHref && messageScrollBehaviorRef.current === "preserve") {
          router.replace(loadMoreHref, { scroll: false });
        }
      },
      { root: contenedor, rootMargin: "300px 0px 0px 0px" },
    );

    observador.observe(centinela);

    /*
      Ademas del centinela, un escucha del desplazamiento. Los dos, a proposito.

      El centinela es un IntersectionObserver, y hay situaciones normales en las que no avisa: el
      elemento se dibuja despues de armarlo, el contenedor todavia no tiene alto, la pestaña esta
      en segundo plano -ahi el navegador colapsa el alto y no dispara nada- o simplemente lo
      estrangula para ahorrar bateria. Cada una de esas es un "a veces no carga" para quien lo
      usa, y no hay forma de distinguirlas desde afuera.

      Preguntar "estas a menos de 300 px del tope?" en cada desplazamiento es tosco pero no falla,
      y es barato: comparar dos numeros. Si los dos caminos coinciden no pasa nada, porque el
      candado de "ya hay una carga en curso" deja entrar a uno solo.
    */
    const alDesplazar = () => {
      if (contenedor.scrollTop > 300) {
        return;
      }
      if (suppressHistoryLoadUntilRef.current > Date.now() || loadMoreHistoryInFlightRef.current) {
        return;
      }
      if (canLoadOlderMessagesRef.current) {
        void loadOlderMessagesRef.current();
      }
    };
    contenedor.addEventListener("scroll", alDesplazar, { passive: true });

    return () => {
      observador.disconnect();
      contenedor.removeEventListener("scroll", alDesplazar);
    };
    /*
      Se rearma al cambiar de chat Y cuando aparece el centinela.

      Lo segundo no estaba y por eso, al sacar el boton, algunos chats se quedaban sin historial:
      el centinela recien se dibuja cuando llegan los datos de la conversacion -un instante
      despues de abrirla-, asi que al correr este efecto todavia no existia y el observador no
      quedaba vigilando nada. Antes el boton tapaba ese hueco; sin boton, subir no hacia nada.
    */
  }, [selectedConversationId, canLoadOlderMessages, router]);

  // Smart scroll: auto-scroll only when near bottom; count new messages when scrolled up.
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;

    const container = messagesScrollRef.current;
    const currentKey = selectedConversationScrollKey;
    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = currentKey;

    if (currentKey === "empty" || !container) return;

    if (loadMoreHistoryRestoreRef.current) {
      const restore = loadMoreHistoryRestoreRef.current;
      // Al cargar mensajes antiguos arriba, el contenido inferior no cambia, así que
      // mantener (scrollHeight - scrollTop) constante conserva la vista exacta. Como ya
      // no hay virtualización, la altura es real: basta fijar antes del paint (este
      // useLayoutEffect) + un par de frames por si algún media termina de cargar.
      const distanceFromBottom = Math.max(0, restore.scrollHeight - restore.scrollTop);
      const pinScroll = () => {
        const el = messagesScrollRef.current;
        if (!el) return;
        el.scrollTop = Math.max(0, el.scrollHeight - distanceFromBottom);
        // Quien acaba de pedir el historial esta leyendo hacia arriba, no esperando el
        // ultimo mensaje: se deja constancia de que YA NO esta al fondo. Sin esto, el
        // observador de tamaño creia que seguia abajo y devolvia la vista al final en
        // cuanto una foto del historial terminaba de cargar.
        lastScrollTopRef.current = el.scrollTop;
        isNearBottomRef.current = false;
      };
      pinScroll();
      window.requestAnimationFrame(pinScroll);
      historyRestoreGuardUntilRef.current = Math.max(
        historyRestoreGuardUntilRef.current,
        Date.now() + 1200,
      );
      loadMoreHistoryRestoreRef.current = null;
      return;
    }

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      // En salto inmediato (no-smooth) fijamos el scroll YA, dentro de este useLayoutEffect
      // (antes del paint), para que no se vea un frame "arriba" antes del rAF. El rAF queda
      // como re-anclaje por si la altura cambia (media que termina de cargar, etc.).
      if (!smooth) {
        container.scrollTop = container.scrollHeight;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }

          isNearBottomRef.current = true;
          setUnreadCount(0);
          scrollFrameRef.current = null;
        });
      });
    };

    if (!prevKey || prevKey === "empty") {
      // Initial load — jump to bottom without animation.
      jumpToBottom(false);
      return;
    }

    const prevConvId = prevKey.split("|")[0];
    const curConvId = currentKey.split("|")[0];

    if (prevConvId !== curConvId) {
      // Different conversation opened — always jump to bottom.
      jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = Number(prevKey.split("|")[1]) || 0;
    const curCount = Number(currentKey.split("|")[1]) || 0;
    const added = curCount - prevCount;
    if (added <= 0) {
      // Mismo número de mensajes pero el contenido/altura pudo cambiar (p. ej. al pasar
      // de la caché al detalle del servidor). Si el usuario está al fondo, lo mantenemos
      // pegado abajo para que no parezca que "se subió".
      if (isNearBottomRef.current) {
        jumpToBottom(false);
      }
      return;
    }

    // First messages arriving (0 → N): always jump to bottom regardless of scroll position.
    if (prevCount === 0) {
      jumpToBottom(false);
      return;
    }

    // Transition from a lightweight preview (usually 1 message) to the real chat:
    // use a hard jump so the final hydration doesn't leave the viewport slightly above.
    if (prevCount <= 1) {
      jumpToBottom(false);
      return;
    }

    // Comportamiento estilo WhatsApp:
    // - Tu propio envío (burbuja optimista) → baja para verlo.
    // - Estás cerca del fondo (leyendo lo último) → baja natural al mensaje nuevo.
    // - Estás arriba en el historial → NO mueve el scroll; si es entrante, muestra
    //   el contador "↓ N" de no leídos.
    const lastMessage = renderedMessagesRef.current.at(-1);
    const lastMessageIsOwnDraft =
      typeof lastMessage?.id === "string" && lastMessage.id.startsWith("optimistic:");

    if (lastMessageIsOwnDraft || isNearBottomRef.current) {
      jumpToBottom(true);
      return;
    }

    // Scrolleado arriba: anclamos a la posición previa para que el re-render no la
    // mueva, y contamos el no leído si el mensaje es entrante.
    container.scrollTop = lastScrollTopRef.current;
    if (lastMessage?.direction === "INBOUND") {
      setUnreadCount((prev) => prev + added);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  // Al ABRIR una conversación (cambia el id normalizado), fijamos el scroll al fondo de
  // forma agresiva en varios frames/timeouts. Así, aunque el contenido pase por las
  // transiciones caché → SSR → /live (que cambian la altura), el chat siempre queda en el
  // último mensaje y no se ve "subido". No interfiere con la llegada de mensajes nuevos
  // (eso lo maneja el efecto de arriba), porque solo corre cuando cambia la conversación.
  const openedConversationIdRef = useRef("");
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const convId = renderedConversation ? extractConversationIdFromKey(renderedConversation.id) : "";
    if (!convId || convId === openedConversationIdRef.current) return;
    openedConversationIdRef.current = convId;
    // Bloquea la carga automática de historial durante la apertura (los pines de scroll
    // disparan el listener y, si no, anclarían la vista arriba).
    suppressHistoryLoadUntilRef.current = Date.now() + 700;

    const pinToBottom = () => {
      const el = messagesScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      isNearBottomRef.current = true;
    };

    pinToBottom();
    const raf1 = window.requestAnimationFrame(() => {
      pinToBottom();
      window.requestAnimationFrame(pinToBottom);
    });
    const t1 = window.setTimeout(pinToBottom, 80);
    const t2 = window.setTimeout(pinToBottom, 250);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [renderedConversation, messageScrollBehavior]);

  // Cuando el contenido CRECE después del render (típicamente una imagen/media que termina
  // de cargar), si el usuario está al fondo o el chat se acaba de abrir, volvemos a pegar
  // la vista abajo. Sin esto, los chats con foto/video quedan a media altura al abrir.
  useEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const container = messagesScrollRef.current;
    const content = container?.firstElementChild;
    if (!container || !content) return;

    let lastScrollHeight = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const el = messagesScrollRef.current;
      if (!el) return;
      const grew = el.scrollHeight > lastScrollHeight + 1;
      lastScrollHeight = el.scrollHeight;
      if (!grew) return;

      // El contenido crecio porque se pidieron mensajes ANTERIORES: ese crecimiento va
      // arriba, no abajo, y bajar al fondo seria taparle a la asesora lo que fue a buscar.
      if (
        historyRestoreGuardUntilRef.current > Date.now() ||
        loadMoreHistoryInFlightRef.current ||
        loadMoreHistoryRestoreRef.current
      ) {
        return;
      }

      const justOpened = suppressHistoryLoadUntilRef.current > Date.now();
      if (isNearBottomRef.current || justOpened) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
        isNearBottomRef.current = true;
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [messageScrollBehavior, selectedConversationId]);

  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    // Ir al final es una orden explicita: si quedaba una restauracion de historial pendiente se
    // descarta, porque volveria a anclar la vista arriba a mitad de camino.
    historyRestoreGuardUntilRef.current = 0;
    loadMoreHistoryRestoreRef.current = null;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setUnreadCount(0);
    // Se esconde ya, sin esperar a que termine el desplazamiento suave: si no, el boton se
    // queda a la vista durante toda la bajada y parece que no respondio al toque.
    showJumpToBottomRef.current = false;
    setShowJumpToBottom(false);
    // Una foto que termina de cargar corre el final del chat hacia abajo y la bajada se queda a
    // media altura. Se reafirma un par de veces —y solo si en el camino nadie volvio a subir.
    const reafirmarFondo = () => {
      const el = messagesScrollRef.current;
      if (!el || !isNearBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    };
    window.setTimeout(reafirmarFondo, 300);
    window.setTimeout(reafirmarFondo, 900);
  }, []);

  return (
    <>
    <div
      className={`chat-inbox-grid flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden md:grid ${
        hasSidebar ? "md:grid-cols-[250px_360px_minmax(0,1fr)]" : "md:grid-cols-[380px_minmax(0,1fr)]"
      }`}
    >
      {hasSidebar ? (
        <div className="hidden chat-inbox-sidebar min-h-0 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#171717] p-0 text-white shadow-[0_28px_70px_-42px_rgba(15,23,42,0.42)] md:flex md:h-full">
          <div className="flex min-h-0 w-full flex-col">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90">
                  <MessageSquareText className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-[-0.03em] text-white">Chats</p>
                  <p className="text-[11px] text-white/45">Conexiones creadas</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <nav className="space-y-1">
                {sidebarItems.map((item) => {
                  const isActive = item.isActive || selectedConnectionKey === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                        isActive ? "bg-white/8 text-white" : "text-white/72 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isActive ? "border-white/16 bg-white/8" : "border-white/8 bg-white/4"
                        }`}
                      >
                        {item.channelType === "whatsapp_official" ? (
                          <BadgeCheck className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-400" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        {item.helper ? <p className="truncate text-[11px] text-white/42">{item.helper}</p> : null}
                      </div>

                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition ${
                          isActive ? "translate-x-0 text-white/75" : "text-white/28 group-hover:text-white/55"
                        }`}
                      />
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      <AppSidebar
        conversationItems={displayedConversationItems}
        selectedConversationId={selectedConversationId}
        searchAction={searchAction}
        selectedConnectionKey={selectedConnectionKey}
        searchQuery={searchQuery}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        assignedCounts={assignedCounts}
        isManager={isManager || veTodoElEquipo}
        filtros={{
          etapas: etapasEnLaUrl ? (etapasEnLaUrl.split(",") as EtapaCrm[]) : [],
          sinResponder: sinResponderEnLaUrl,
          etiquetas: etiquetasEnLaUrl ? etiquetasEnLaUrl.split(",").filter(Boolean) : [],
        }}
        hasMoreConversationItems={hasMoreConversationItems}
        isLoadingMoreConversationItems={isLoadingMoreConversationItems}
        onLoadMoreConversationItems={loadMoreConversationItems}
        mobileConversationActive={mobileConversationActive}
        emptyListTitle={emptyListTitle}
        emptyListDescription={emptyListDescription}
        alCambiarVista={alCambiarVista}
        listaAtenuada={vistaEnCurso}
        versionDeVista={versionDeVista}
      />

      <ConversationPanel
        // Clave del panel = clave EFECTIVA del chat (pendiente o de la URL). Antes usaba
        // selectedConversationId (solo la URL), que cambia al confirmarse la navegación
        // DESPUÉS de mostrar el chat optimista → el panel se re-montaba a mitad de la
        // apertura, el contenedor de scroll nacía arriba y se veía un "sube y baja" antes
        // de re-anclar al fondo. selectedConversationKey es idéntica en el estado pendiente
        // y tras el commit (misma "agent:<id>"), así que el panel se monta UNA sola vez al
        // hacer click y el pin al fondo queda estable.
        key={mobileConversationActive ? (selectedConversationKey || "selected") : "empty"}
        canDeleteTags={isManager}
        chatSignature={chatSignature}
        backHref={backHrefActual}
        composer={effectiveComposer}
        composerHiddenFields={composerHiddenFields}
        hasSettledConversation={hasSettledConversation}
        barraAnticipada={barraAnticipada}
        isLoadingOlderMessages={isLoadingOlderMessages}
        loadMoreSentinelRef={loadMoreSentinelRef}
        messageScrollBehavior={messageScrollBehavior}
        messagesScrollRef={messagesScrollRef}
        unreadCount={unreadCount}
        showJumpToBottom={showJumpToBottom}
        onScrollToBottom={scrollToBottom}
        onEditContact={handleOpenEditContact}
        isManager={isManager}
        onComposerDraft={handleComposerDraft}
        enviandoTexto={chatsConTextoEnCurso.includes(selectedConversationId)}
        // Enviar queda apagado hasta que el chat abierto este cargado (nunca al chat anterior).
        envioBloqueado={!hasSettledConversation}
        estadoCarga={estadoCargaDelChat({
          esVistaPrevia: Boolean(renderedConversation?.isPreview),
          fallo: falloCargaDelChat === selectedConversationKey,
          msDesdeQueAbrio: 0,
        })}
        onReintentarCarga={reintentarCargaDelChat}
        onRetryFailedMessage={handleRetryFailedMessage}
        onReplyToMessage={handleReplyToMessage}
        onDeleteMessage={handleDeleteMessage}
        replyTarget={replyTarget}
        onCancelReply={handleCancelReply}
        renderedConversation={renderedConversation}
        renderedMessages={renderedMessages}
        selectedConversationId={selectedConversationId}
        selectedConversationScrollKey={selectedConversationScrollKey}
        selectedConversationTags={selectedConversationTags}
        emptySelectionTitle={emptySelectionTitle}
        emptySelectionDescription={emptySelectionDescription}
        // El del servidor solo si es de ESTE chat: si no, el interruptor de la IA apuntaria al
        // chat con el que cargo la pagina.
        headerActions={clientHeaderActions ?? (selectedConversationMatchesCurrentKey ? headerActions : null)}
        headerBadge={headerBadge}
        // Igual que la ficha: la del servidor solo si es de ESTE chat (Ventas 2 usa siempre esa).
        headerBar={clientHeaderBar ?? (selectedConversationMatchesCurrentKey ? headerBar : null)}
        // El del servidor solo si es de ESTE chat: el de otro mostraria a la asesora equivocada.
        contactPanelActions={clientContactPanelActions ?? (selectedConversationMatchesCurrentKey ? contactPanelActions : null)}
        contactPanelHeaderActions={clientContactPanelHeaderActions ?? contactPanelHeaderActions}
      />
    </div>

    {renderedConversation?.contactId ? (
      <EditContactModal
        open={editContactOpen}
        onClose={handleCloseEditContact}
        contactId={renderedConversation.contactId}
        contactName={renderedConversation.contactName ?? renderedConversation.label}
      />
    ) : null}
    </>
  );
}



