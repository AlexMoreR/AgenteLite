"use client";

import Link from "next/link";
import { listaProvisional } from "@/components/chats/lista-provisional";
import { empezoLaApertura, terminoLaApertura } from "@/components/chats/datos-de-la-apertura";
import { enviarArchivoPorRuta, enviarAudioPorRuta } from "@/lib/chats/enviar-por-ruta";
import { marcarOcupada } from "@/lib/actualizacion-automatica";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  anotarChatReciente,
  pedirIrAlMensaje,
  soltarMensajeAEnfocar,
  useMensajeAEnfocar,
} from "./busqueda-de-chats-store";
import type { MensajeEncontrado } from "./chat-inbox-types";
import { BadgeCheck, ChevronRight, MessageCircle, MessageSquareText } from "lucide-react";
import {
  copiaComoBase,
  mergeConversationSnapshots,
  readConversationFromCache,
  saveConversationToCache,
} from "@/components/chats/chat-history-cache";
import { precargaEnCamino } from "@/components/chats/chat-conversation-warmup";
import { EVENTO_PONERSE_AL_DIA } from "@/components/agents/chats-auto-refresh";
import { atenderChatSinAcceso, EVENTO_CHAT_SIN_ACCESO } from "@/components/chats/guardado-local/sin-acceso";
import { reconciliarPrimeraPagina } from "@/components/chats/guardado-local/reglas";
import { guardarListaEnElCelular } from "@/components/chats/guardado-local/lista-guardada";
import { guardarConteos, leerConteosGuardados } from "@/components/chats/guardado-local/conteos-guardados";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import {
  resetConversationSelection,
  setPendingConversationSelection,
  useOpenChatKey,
  usePendingConversationSelection,
  type PendingChatSelection,
} from "./chat-selection-store";
import { deleteChatMessageAction, editChatMessageAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { AppSidebar } from "./appsidebar";
import {
  leerFiltrosDeBandeja,
  paramsDeFiltros,
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
import { buscaEnMensajes, cifrasParaBuscarElTelefono, estadoQueAplica } from "@/lib/busqueda-de-chats";
import { filasDelBuscador } from "./filas-del-buscador";
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
  esperaSinContestadas,
  juntarPaginaDeEsperando,
  sincronizarConEspera,
} from "./chat-inbox-conversation-utils";
import { filtroSinResponderPuesto, seOcultaPorSinResponder } from "@/features/chats/domain/sin-responder";
import { filtrosParaContar } from "./pastillas-de-la-bandeja";
import {
  LISTA_FRESCA_MS,
  LISTA_VIGENTE_MS,
  envejecerListasRecientes,
  guardarListaReciente,
  leerListaReciente,
  olvidarListasRecientes,
  type ListaGuardada as ListaGuardadaDeLaBandeja,
} from "./listas-recientes-de-la-bandeja";
import { esperaPorClave, type EsperaDeChats } from "@/features/chats/domain/espera-de-chats";
import { leerEspera } from "@/features/chats/domain/filtros-de-bandeja";
import { ConversationPanel, type EnvioTerminado } from "./chat-conversation-panel";
import {
  contarNuevosAlFinal,
  debeBajarAlFinal,
  debeVerseElBotonDeBajar,
  distanciaAlFinal,
  estaPegadaAlFinal,
  leerLlaveDelHilo,
  type MotivoParaBajar,
} from "./scroll-del-hilo";
import { BarraDeAccionesDelChat, BarraDeAccionesEnSilueta, ChatHeaderActions } from "./chat-header-actions";
import { MenuDelContacto } from "./menu-del-contacto";
import { AssignChatControl } from "./assign-chat-control";
import { inicializarFijados, useChatsFijados } from "./chats-fijados-store";
import { inicializarPermisosDeLaBandeja } from "./permisos-de-la-bandeja-store";
import type { CrmStage } from "@/features/crm/types";
import { resolveCallTarget } from "@/lib/whatsapp-lid";
import { iniciarMedicion, terminarMedicion, terminarMedicionAlPintar } from "@/lib/metricas-chats";
import { aplicarFirmaDelChat } from "@/lib/firma-del-chat";
import { EditarMensajeDialog } from "@/components/chats/editar-mensaje-dialog";
import {
  agregarFallido,
  estadoCargaDelChat,
  fallidosDelChat,
  LIMITE_CARGA_CHAT_MS,
  quitarFallido,
  resolverDestinoDelEnvio,
  textoCoincideConGuardado,
} from "@/lib/chat-envio-seguro";
import {
  CLAVE_FALLOS_POR_ANOTAR,
  CLAVE_NO_ENVIADOS,
  MENSAJE_GATEWAY_TARDO,
  agregarFallosPorAnotar,
  enviarConReintentos,
  falloDeRed,
  guardarNoEnviados,
  leerFallosPorAnotar,
  leerNoEnviados,
  leerRespuestaDelEnvio,
  nuevoIdDeMensaje,
  type FalloPorAnotar,
  type NoEnviadoGuardado,
  type RespuestaDelEnvio,
} from "@/lib/chat-envio-reintento";

/*
  Cuantos chats se piden al bajar por la lista. Eran 10: llegar al fondo de "Todas" (unos 2.500)
  eran ~250 pedidos y cada uno re-dibujaba la lista. 40 es el maximo que ya acepta
  /api/cliente/chats/list (ver su `limit`).
*/
const CONVERSATION_LIST_LOAD_BATCH_SIZE = 40;
// Logs de depuración de la lista desactivados (ensuciaban la consola en desarrollo).
const CHAT_LIST_DEBUG = false;
// Siempre la MISMA lista vacia: un [] nuevo en cada dibujo obligaba a re-dibujar la barra lateral
// (AppSidebar va memorizada) cada vez que cambiaba algo del chat abierto.
const SIN_MENSAJES_ENCONTRADOS: MensajeEncontrado[] = [];
// Buscador de chats: pausa al escribir antes de ir al servidor, y letras minimas para ir.
const ESPERA_DEL_BUSCADOR_MS = 350;
const LETRAS_PARA_IR_AL_SERVIDOR = 2;
// La seccion "Mensajes" del buscador: con menos letras casi todo coincide (ver buscar-mensajes).
const LETRAS_PARA_BUSCAR_MENSAJES = 3;
// Siempre el mismo objeto vacio, por lo mismo que SIN_MENSAJES_ENCONTRADOS.
type ChatsPorMensaje = { q: string; vista: string; items: SharedInboxConversationItem[] };
const SIN_CHATS_POR_MENSAJE: ChatsPorMensaje = { q: "", vista: "", items: [] };

function debugConversationList(...args: unknown[]) {
  if (!CHAT_LIST_DEBUG) {
    return;
  }

  console.log("[SharedInbox][list]", ...args);
}

/** Pestaña, estado y "Esperando" que dice la URL, con las mismas reglas que page.tsx y /list. */
function vistaDeLaUrl(
  params: { get: (clave: string) => string | null },
  puedeVerEquipo: boolean,
): { assignedFilter: AssignedFilter; statusFilter: StatusFilter; espera: boolean } {
  const asignada = params.get("assigned")?.trim() ?? "";
  const estado = params.get("status")?.trim() ?? "";
  const assignedFilter: AssignedFilter = !puedeVerEquipo
    ? "mine"
    : asignada === "mine" || asignada === "unassigned" || /^user:[a-z0-9]+(,[a-z0-9]+)*$/i.test(asignada)
      ? (asignada as AssignedFilter)
      : "all";
  const statusFilter: StatusFilter = estado === "all" || estado === "resolved" ? estado : "open";
  return { assignedFilter, statusFilter, espera: leerEspera((clave) => params.get(clave)) };
}

function claveDeVista(q: string, conexion: string, asignada: string, estado: string, filtros: string, espera: boolean) {
  return [q.trim(), conexion.trim(), asignada, estado, filtros, espera ? "espera" : ""].join("::");
}

/** Un chat contestado aca se descarta de la espera de /counts por este tiempo (ver esperaSinContestadas). */
const CONTESTADA_VIGENTE_MS = 3 * 60_000;

// LAS ULTIMAS LISTAS, en memoria: ver listas-recientes-de-la-bandeja.ts.
type ListaGuardada = ListaGuardadaDeLaBandeja<SharedInboxConversationItem>;

/** Si /list falla al cambiar de vista, se reintenta UNA vez tras esta pausa (ya no router.refresh()). */
const REINTENTO_DE_LISTA_MS = 400;

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

/*
  Envio de texto por la ruta normal (tarjeta whovymqk): a diferencia de la accion del servidor, no
  se rompe cuando se sube una version nueva con la pestaña abierta. El numero unico del mensaje va
  en los campos, asi cada reintento (automatico o con Reintentar) es el MISMO mensaje.
*/
const RUTA_ENVIAR_TEXTO = "/api/cliente/chats/enviar";
const RUTA_ANOTAR_FALLOS = "/api/cliente/chats/enviar/fallo";
// El servidor corta al gateway a los 25 s; esto es solo para no esperar para siempre.
const LIMITE_ESPERA_ENVIO_MS = 60_000;

async function enviarTextoPorRuta(campos: Array<[string, string]>, intento: number): Promise<RespuestaDelEnvio> {
  const datos = new FormData();
  for (const [nombre, valor] of campos) {
    datos.set(nombre, valor);
  }
  datos.set("intento", String(intento));
  let respuesta: Response;
  try {
    respuesta = await fetch(RUTA_ENVIAR_TEXTO, {
      method: "POST",
      body: datos,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(LIMITE_ESPERA_ENVIO_MS),
    });
  } catch (error) {
    // Se corto la espera con el pedido ya adentro: pudo haber salido, no se repite solo.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: MENSAJE_GATEWAY_TARDO, motivo: "timeout_gateway", reintentable: false };
    }
    return falloDeRed();
  }
  const cuerpo = await respuesta.json().catch(() => null);
  return leerRespuestaDelEnvio(respuesta.status, cuerpo);
}

/* El almacenamiento del navegador puede no estar (modo privado, bloqueado): nunca rompe el envio. */
function leerDelNavegador(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirEnNavegador(clave: string, valor: string | null) {
  try {
    if (valor === null) {
      window.localStorage.removeItem(clave);
    } else {
      window.localStorage.setItem(clave, valor);
    }
  } catch {
    // sin almacenamiento: el "No se envió" sigue en pantalla mientras no se recargue
  }
}

/** Fallos que no llegaron al servidor: se guardan y se mandan a medir cuando hay red. */
function anotarFallosSinLlegar(nuevos: FalloPorAnotar[]) {
  if (nuevos.length === 0) {
    return;
  }
  escribirEnNavegador(
    CLAVE_FALLOS_POR_ANOTAR,
    JSON.stringify(agregarFallosPorAnotar(leerFallosPorAnotar(leerDelNavegador(CLAVE_FALLOS_POR_ANOTAR)), nuevos)),
  );
  void mandarFallosPorAnotar();
}

let mandandoFallos = false;
async function mandarFallosPorAnotar() {
  if (mandandoFallos || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return;
  }
  const fallos = leerFallosPorAnotar(leerDelNavegador(CLAVE_FALLOS_POR_ANOTAR));
  if (fallos.length === 0) {
    return;
  }
  mandandoFallos = true;
  try {
    const respuesta = await fetch(RUTA_ANOTAR_FALLOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fallos }),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (respuesta.ok) {
      // Solo se borran los que se mandaron; los que se sumaron mientras tanto quedan.
      const actuales = leerFallosPorAnotar(leerDelNavegador(CLAVE_FALLOS_POR_ANOTAR));
      const resto = actuales.slice(fallos.length);
      escribirEnNavegador(CLAVE_FALLOS_POR_ANOTAR, resto.length > 0 ? JSON.stringify(resto) : null);
    }
  } catch {
    // sin red todavia: se manda al volver
  } finally {
    mandandoFallos = false;
  }
}

function campoDe(campos: Array<[string, string]>, nombre: string) {
  return campos.find(([clave]) => clave === nombre)?.[1] ?? "";
}

function fallosSinLlegar(campos: Array<[string, string]>, sinLlegar: Array<{ intento: number; motivo: FalloPorAnotar["motivo"]; detalle: string }>): FalloPorAnotar[] {
  return sinLlegar.map((fallo) => ({
    conversationId: campoDe(campos, "conversationId"),
    source: campoDe(campos, "source") === "official" ? "official" : "agent",
    motivo: fallo.motivo,
    detalle: fallo.detalle,
    clientMessageId: campoDe(campos, "clientMessageId") || null,
    intento: fallo.intento,
    ocurrioEn: Date.now(),
  }));
}

/** Manda el texto con hasta 2 reintentos seguros y anota lo que ni llego al servidor. */
async function enviarTextoConReintentos(campos: Array<[string, string]>): Promise<RespuestaDelEnvio> {
  const { resultado, sinLlegar } = await enviarConReintentos({
    enviar: (intento) => enviarTextoPorRuta(campos, intento),
  });
  anotarFallosSinLlegar(fallosSinLlegar(campos, sinLlegar));
  return resultado;
}

function noEnviadoParaGuardar(fallido: OptimisticDraftMessage): NoEnviadoGuardado | null {
  if (!fallido.envio || (fallido.type ?? "TEXT") !== "TEXT") {
    return null;
  }
  const rawPayload = fallido.rawPayload as { replyTo?: NoEnviadoGuardado["replyTo"] } | null | undefined;
  return {
    id: fallido.id,
    conversationId: fallido.conversationId,
    chatKey: fallido.envio.chatKey,
    content: fallido.content ?? "",
    matchContent: fallido.matchContent ?? fallido.content ?? "",
    campos: fallido.envio.campos,
    createdAt: fallido.createdAt.getTime(),
    errorDetail: fallido.errorDetail ?? "",
    replyTo: rawPayload?.replyTo ?? null,
  };
}

function noEnviadoGuardadoAMensaje(guardado: NoEnviadoGuardado): OptimisticDraftMessage {
  return {
    id: guardado.id,
    conversationId: guardado.conversationId,
    content: guardado.content,
    matchContent: guardado.matchContent,
    direction: "OUTBOUND",
    createdAt: new Date(guardado.createdAt),
    authorType: "user",
    outboundStatusLabel: "error",
    errorDetail: guardado.errorDetail || null,
    type: "TEXT",
    mediaUrl: null,
    rawPayload: guardado.replyTo ? { optimistic: true, replyTo: guardado.replyTo } : { optimistic: true },
    isOptimistic: true,
    envio: { chatKey: guardado.chatKey, campos: guardado.campos },
  };
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
  esperaDelServidor = false,
  isManager = false,
  veTodoElEquipo = false,
  chatsFijados,
  pastillasIniciales = null,
  usuarioActualId = null,
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
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilterDelServidor, statusFilterDelServidor, [], esperaDelServidor),
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
  /*
    Las condiciones del filtro se leen de la URL con el MISMO lector del servidor (también las
    listas viejas con stage= / tag= / pending=) y viajan ya normalizadas en `c=`.
  */
  const firmaDeCondicionesEnLaUrl = ["stage", "tag", "pending", "c"].map((clave) => parametrosDeLaUrl.get(clave) ?? "").join("|");
  const filtrosDeLaUrl = useMemo(
    () => leerFiltrosDeBandeja((clave) => parametrosDeLaUrl.get(clave)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la firma resume lo que se lee
    [firmaDeCondicionesEnLaUrl],
  );
  const ponerFiltrosNuevos = useCallback(
    (params: URLSearchParams) => {
      for (const [clave, valor] of paramsDeFiltros(filtrosDeLaUrl)) params.set(clave, valor);
    },
    [filtrosDeLaUrl],
  );
  /*
    Para /counts, las mismas condiciones SIN `sin_responder:si` ni `no_leido:si`: asi Todas, Mias y
    Sin asignar no bajan a cero cuando Sin responder o No leido estan puestos. Sus numeros
    (`sinResponder` y `noLeido`) los calcula el servidor aparte.

    El efecto de /counts depende de la FIRMA de texto de esos filtros, no de los filtros: tocar No
    leido o Sin responder cambia `c=` pero no lo que se cuenta, y antes volvia a pedir /counts igual.
  */
  const paresParaContar = useMemo(() => paramsDeFiltros(filtrosParaContar(filtrosDeLaUrl)), [filtrosDeLaUrl]);
  const firmaParaContar = paresParaContar.map(([clave, valor]) => `${clave}=${valor}`).join("&");
  const paresParaContarRef = useRef(paresParaContar);
  paresParaContarRef.current = paresParaContar;

  /*
    LA VISTA (pestaña + estado + filtros) SALE DE LA URL DEL NAVEGADOR.

    Cambiar de filtro ya no navega: la bandeja pide solo /list y cambia la URL con pushState, que
    Next sincroniza con useSearchParams sin pedir nada (igual que abrir un chat). Atras/adelante
    tambien: la URL vuelve y la vista con ella. Las reglas son las MISMAS que las del servidor
    (page.tsx): quien no ve al equipo queda siempre en "Mias".
  */
  const { assignedFilter, statusFilter, espera: enEspera } = vistaDeLaUrl(parametrosDeLaUrl, isManager || veTodoElEquipo);
  /*
    "ESPERANDO" (espera=1): la lista va en el orden del servidor -el que mas lleva esperando primero-
    y la mantiene al dia el /counts de cada 60 s (ver el efecto de sincronizarConEspera). Con texto
    en el buscador del servidor (q) la busqueda manda, igual que en /list.
  */
  const ordenDelServidor = enEspera && !searchQuery.trim();
  const ordenDelServidorRef = useRef(ordenDelServidor);
  ordenDelServidorRef.current = ordenDelServidor;
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
    enEspera,
  );
  const vistaDelServidorKey = claveDeVista(
    searchQuery,
    selectedConnectionKey,
    assignedFilterDelServidor,
    statusFilterDelServidor,
    filtrosDelServidor,
    esperaDelServidor,
  );
  // El enlace de cada fila lleva la vista de AHORA (con los filtros nuevos tambien).
  const hrefDeFila = useCallback(
    (item: SharedInboxConversationItemLike, q: string = searchQuery) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, q, item, assignedFilter, statusFilter, paresDeFiltros, enEspera),
    [searchAction, selectedConnectionKey, searchQuery, assignedFilter, statusFilter, paresDeFiltros, enEspera],
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

  const [assignedCounts, setAssignedCounts] = useState<{ mine: number; unassigned: number; all: number; sinResponder?: number; noLeido?: number } | null>(null);
  // El `espera` del ultimo /counts: la marca de cada fila, el numero de "Esperando" y su lista.
  const [esperaDelConteo, setEsperaDelConteo] = useState<EsperaDeChats | null>(null);
  /*
    Los chats que esta pantalla acaba de contestar (clave -> cuando). Salen en el acto de
    "Esperando" y bajan el numero, aunque la memoria de 60 s del servidor todavia los traiga.
  */
  const [contestadasAca, setContestadasAca] = useState<ReadonlyMap<string, number>>(() => new Map());
  const esperaVigente = useMemo(
    () => esperaSinContestadas(esperaDelConteo, contestadasAca, Date.now(), CONTESTADA_VIGENTE_MS),
    [esperaDelConteo, contestadasAca],
  );
  // `key` -> desde cuando espera (ver filasConEspera).
  const esperaPorClaveActual = useMemo(() => esperaPorClave(esperaVigente), [esperaVigente]);
  const esperaVigenteRef = useRef(esperaVigente);
  esperaVigenteRef.current = esperaVigente;
  const contestadasAcaRef = useRef(contestadasAca);
  contestadasAcaRef.current = contestadasAca;
  /*
    Saca de una pagina de "Esperando" los chats recien contestados aca que el servidor todavia trae
    (su memoria dura 60 s). Si el cliente volvio a escribir, /counts ya lo trae de nuevo y se queda.
  */
  const sinContestadasAca = useCallback((items: SharedInboxConversationItem[]) => {
    const contestadas = contestadasAcaRef.current;
    if (contestadas.size === 0) return items;
    const siguenEsperando = new Set((esperaVigenteRef.current?.chats ?? []).map((chat) => chat.key));
    const ahora = Date.now();
    return items.filter((item) => {
      const en = contestadas.get(item.id);
      return en === undefined || ahora - en > CONTESTADA_VIGENTE_MS || siguenEsperando.has(item.id);
    });
  }, []);
  const numerosDeEspera = useMemo(
    () => (esperaVigente ? { mine: esperaVigente.mine, all: esperaVigente.all } : null),
    [esperaVigente],
  );
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
    Ponerse al dia sin recargar (P5, T1): ChatsAutoRefresh avisa al volver a la app, al volver la red,
    al reconectarse el socket o en su respaldo. Se pide /list y los numeros en vez de la pantalla
    entera (preventDefault le dice que ya se atendio), y esa vez la lista tambien QUITA los chats que
    salieron de la vista (reconciliarPrimeraPagina).
  */
  const reconciliarListaRef = useRef(false);
  // Lo que ponerse al dia nunca quita: el chat abierto y los fijados (se ponen mas abajo, en el render).
  const chatAbiertoParaConservarRef = useRef("");
  const fijadosParaConservarRef = useRef<readonly string[]>([]);
  useEffect(() => {
    const alPonerseAlDia = (evento: Event) => {
      evento.preventDefault();
      reconciliarListaRef.current = true;
      setPedidoDeLista((actual) => actual + 1);
      setPedidoDeConteos((actual) => actual + 1);
    };
    window.addEventListener(EVENTO_PONERSE_AL_DIA, alPonerseAlDia);
    return () => window.removeEventListener(EVENTO_PONERSE_AL_DIA, alPonerseAlDia);
  }, []);
  // Chat sin acceso (P5, T5): /live dijo 404, la copia ya se borro; aca sale la fila.
  useEffect(() => {
    const alQuedarSinAcceso = (evento: Event) => {
      const chatKey = (evento as CustomEvent<{ chatKey?: string } | null>).detail?.chatKey?.trim() || "";
      if (!chatKey) return;
      setConversationItems((current) =>
        current.some((item) => item.id === chatKey) ? current.filter((item) => item.id !== chatKey) : current,
      );
    };
    window.addEventListener(EVENTO_CHAT_SIN_ACCESO, alQuedarSinAcceso);
    return () => window.removeEventListener(EVENTO_CHAT_SIN_ACCESO, alQuedarSinAcceso);
  }, []);
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
  /*
    Los "No se envió" tambien quedan en el navegador (tarjeta whovymqk): si la asesora recarga,
    siguen ahi con su texto y su Reintentar. Se cargan al abrir y se guardan en cada cambio.
  */
  const noEnviadosCargadosRef = useRef(false);
  useEffect(() => {
    const guardados = leerNoEnviados(leerDelNavegador(CLAVE_NO_ENVIADOS), Date.now());
    noEnviadosCargadosRef.current = true;
    if (guardados.length > 0) {
      setMensajesFallidos((lista) =>
        guardados.reduce((acumulado, guardado) => agregarFallido(acumulado, noEnviadoGuardadoAMensaje(guardado)), lista),
      );
    }
  }, []);
  useEffect(() => {
    if (!noEnviadosCargadosRef.current) {
      return;
    }
    const paraGuardar = mensajesFallidos
      .map(noEnviadoParaGuardar)
      .filter((fila): fila is NoEnviadoGuardado => fila !== null);
    escribirEnNavegador(CLAVE_NO_ENVIADOS, paraGuardar.length > 0 ? guardarNoEnviados(paraGuardar) : null);
  }, [mensajesFallidos]);
  // Fallos que no llegaron al servidor: se mandan a medir al abrir y cada vez que vuelve la red.
  useEffect(() => {
    void mandarFallosPorAnotar();
    const alVolverLaRed = () => void mandarFallosPorAnotar();
    window.addEventListener("online", alVolverLaRed);
    return () => window.removeEventListener("online", alVolverLaRed);
  }, []);
  /** Envios de texto en camino, por id optimista: el resultado se resuelve contra ESTE registro. */
  const enviosEnCursoRef = useRef<Map<string, OptimisticDraftMessage>>(new Map());
  /* Carga del chat abierto: fallo /live, o cuando empezo a cargar (para el limite de espera). */
  const [falloCargaDelChat, setFalloCargaDelChat] = useState<string | null>(null);
  const [reintentoCargaDelChat, setReintentoCargaDelChat] = useState(0);
  const [replyTarget, setReplyTarget] = useState<ComposerReplyTarget | null>(null);
  const [deletedMessageIds, setDeletedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  // Ediciones optimistas: el texto nuevo se ve al instante; si el servidor (WhatsApp) no la acepta, se quita.
  const [editedMessages, setEditedMessages] = useState<ReadonlyMap<string, { content: string; editedAt: Date }>>(
    () => new Map(),
  );
  const [messageToEdit, setMessageToEdit] = useState<SharedInboxMessageItem | null>(null);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const handleOpenEditContact = useCallback(() => setEditContactOpen(true), []);
  const [, startSelectionTransition] = useTransition();
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  /*
    Cuantos px le faltan a la asesora para el final, medido en cada scroll (y puesto en 0 cuando el
    codigo la baja). Con esto se decide si un mensaje que entra o una foto que carga la bajan: ver
    la regla en scroll-del-hilo.ts.
  */
  const distanciaAlFinalRef = useRef(0);
  // Cuando la asesora movio por ultima vez la rueda, el dedo o el teclado dentro de la conversacion.
  // Lo que el codigo programo ANTES de ese momento (reintentos de la apertura, una bajada pendiente)
  // ya no la mueve.
  const ultimoGestoRef = useRef(0);
  // Hasta cuando dura la apertura del chat: las fotos que cargan en ese rato la acompañan al final.
  const ventanaAperturaHastaRef = useRef(0);
  const aperturaEnRef = useRef(0);
  const prevScrollKeyRef = useRef("");
  const lastScrollTopRef = useRef(0);
  const historyLoadArmedRef = useRef(false);
  const historyLoadConsumedRef = useRef(false);
  const loadMoreHistoryInFlightRef = useRef(false);
  const loadMoreHistoryRestoreRef = useRef<{ scrollTop: number; scrollHeight: number; ultimoId: string } | null>(null);
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
  // Lo escrito en el buscador, para los listeners que no se vuelven a registrar en cada letra.
  const searchInputValueRef = useRef(searchInputValue);
  searchInputValueRef.current = searchInputValue;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
    Los chats que coinciden por el TEXTO de un mensaje (no por nombre ni numero), con el texto que
    los trajo: la segunda llamada del buscador (/list?soloPorMensaje=1). Van al final de la lista y
    solo mientras lo escrito sea ese mismo texto. No entran a conversationItems: al borrar el
    buscador se van solos.
  */
  const [chatsPorMensaje, setChatsPorMensaje] = useState<ChatsPorMensaje>(SIN_CHATS_POR_MENSAJE);
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

      // Buscando, el estado no filtra: el chat sigue a la vista (ver estadoQueAplica).
      const estado = estadoQueAplica(statusFilter, searchInputValueRef.current);
      const yaNoCorresponde =
        estado === "open" ? detail.resolved : estado === "resolved" ? !detail.resolved : false;
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

  /*
    LOS NUMEROS DE LAS PASTILLAS SIN BRINCOS (Alex, 10-11-2026). /counts tarda segundos y la fila
    salia sin numeros y brincaba al llegar. Se pinta lo ultimo que se vio para esta misma vista de
    conteo (guardado en el equipo, ver conteos-guardados.ts) ANTES del primer pintado del cliente, y
    /counts lo actualiza por debajo. Con texto en el buscador no se guarda ni se lee: son resultados.
  */
  const firmaDeConteoGuardado = searchQuery.trim()
    ? ""
    : [conversationListApiPath, selectedConnectionKey.trim(), statusFilter, firmaParaContar].join("|");
  const firmaDeConteoGuardadoRef = useRef(firmaDeConteoGuardado);
  firmaDeConteoGuardadoRef.current = firmaDeConteoGuardado;
  useLayoutEffect(() => {
    if (!firmaDeConteoGuardado) return;
    const guardados = leerConteosGuardados(firmaDeConteoGuardado);
    if (!guardados) return;
    setAssignedCounts(guardados.counts);
    if (guardados.espera) setEsperaDelConteo(guardados.espera);
  }, [firmaDeConteoGuardado]);

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
        for (const [clave, valor] of paresParaContarRef.current) params.set(clave, valor);
        const qs = params.toString();

        const response = await fetch(`${countsApiPath}${qs ? `?${qs}` : ""}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              counts?: { mine: number; unassigned: number; all: number; sinResponder?: number; noLeido?: number };
              espera?: EsperaDeChats | null;
            }
          | null;
        if (!cancelled && payload?.ok && payload.counts) {
          setAssignedCounts(payload.counts);
          // La marca «espera N min», el numero de "Esperando" y su lista. null (no se pudo calcular) = sin nada.
          setEsperaDelConteo(payload.espera ?? null);
          // Lo ultimo que se vio, para la proxima vez que se abra la bandeja (sin brincos).
          if (firmaDeConteoGuardadoRef.current) {
            guardarConteos(firmaDeConteoGuardadoRef.current, { counts: payload.counts, espera: payload.espera ?? null });
          }
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
    // paresParaContarRef cambia SIEMPRE junto con firmaParaContar.
  }, [conversationListApiPath, searchQuery, selectedConnectionKey, statusFilter, firmaParaContar, pedidoDeConteos]);

  useEffect(() => {
    conversationItemsRef.current = conversationItems;
  }, [conversationItems]);

  // La lista queda guardada en el celular para pintarla mientras carga la proxima vez (P5, T4). Con
  // busqueda no: serian resultados sueltos, no la bandeja.
  useEffect(() => {
    if (searchInputValue.trim() || searchQuery.trim()) return;
    guardarListaEnElCelular(vistaKey, conversationItems);
  }, [vistaKey, conversationItems, searchInputValue, searchQuery]);

  // La vista cuyos chats estan HOY en conversationItems, y la ultima que mando el servidor.
  const vistaCargadaRef = useRef(vistaDelServidorKey);
  const vistaDelServidorRef = useRef(vistaDelServidorKey);
  const hasMoreConversationItemsRef = useRef(hasMoreConversationItems);
  hasMoreConversationItemsRef.current = hasMoreConversationItems;

  // Un mensaje que entra o sale deja VIEJAS las listas guardadas de otras vistas: se muestran al
  // volver y se piden de nuevo (solo el servidor sabe si ese chat sigue en cada filtro). Resolver o
  // posponer las borra: ahi un chat sale de la lista. Ver listas-recientes-de-la-bandeja.ts.
  useEffect(() => {
    const envejecer = () => envejecerListasRecientes();
    const olvidar = () => olvidarListasRecientes();
    window.addEventListener("chat-list-update", envejecer);
    window.addEventListener(CHAT_STATUS_CHANGED_EVENT, olvidar);
    window.addEventListener(CHAT_SNOOZED_EVENT, olvidar);
    return () => {
      window.removeEventListener("chat-list-update", envejecer);
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
      const {
        assignedFilter: asignadaDestino,
        statusFilter: estadoDestino,
        espera: esperaDestino,
      } = vistaDeLaUrl(destino.searchParams, isManager || veTodoElEquipo);
      // La linea y la busqueda no cambian con un filtro: se comparan con las mismas de vistaKey.
      const claveDestino = claveDeVista(
        searchQuery,
        selectedConnectionKey,
        asignadaDestino,
        estadoDestino,
        paramsDeFiltros(leerFiltrosDeBandeja((clave) => destino.searchParams.get(clave)))
          .map(([clave, valor]) => `${clave}=${valor}`)
          .join("&"),
        esperaDestino,
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

  /*
    "Esperando" no se pudo leer (/list respondio `esperaNoDisponible`): se vuelve a la misma pestaña
    (Mias o Todas) sin "Esperando". Se reemplaza la direccion, asi atras no vuelve a la vista rota.
  */
  const salirDeEsperando = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("espera")) return;
    url.searchParams.delete("espera");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    toast.info("No se pudo cargar Esperando. Te dejamos en la bandeja de siempre.");
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Este pedido lo hizo "ponerse al dia" (ver alPonerseAlDia): tambien quita lo que salio de la vista.
    const reconciliar = reconciliarListaRef.current;
    reconciliarListaRef.current = false;

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
      if (enEspera) params.set("espera", "1");
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

      const guardada = leerListaReciente<SharedInboxConversationItem>(vistaKey);
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
        /*
          AL INSTANTE (velocidad, 10-nov-2026): si la vista sale de una lista que ya esta en memoria
          (Todas o Mias, Abiertas, sin condiciones), se pinta filtrandola y /list la completa abajo.
          Sin "hay mas" mientras tanto (el desplazamiento se calcula con la lista del servidor) y sin
          marcar la vista como cargada: si /list falla, el proximo pedido lo vuelve a intentar.
        */
        const provisional = listaProvisional<SharedInboxConversationItem>(
          {
            asignada: assignedFilter,
            estado: statusFilter,
            condiciones: filtrosDeLaUrl.condiciones,
            espera: enEspera,
            busqueda: searchQuery,
          },
          usuarioActualId,
          (base) => {
            const lista = leerListaReciente<SharedInboxConversationItem>(
              claveDeVista(searchQuery, selectedConnectionKey, base, "open", "", false),
            );
            return lista && Date.now() - lista.at < LISTA_VIGENTE_MS ? lista.items : undefined;
          },
        );
        /*
          Vacia NO: la primera tanda de Todas casi nunca trae los chats de quien mira (medido: "Mías"
          salia vacia un instante y despues se llenaba). Sin filas se espera a /list como antes.
        */
        if (provisional && provisional.length > 0) {
          setHasMoreConversationItems(false);
          setConversationItems(provisional.map((item) => ({ ...item, href: hrefDeFila(item) })));
          setVersionDeVista((actual) => actual + 1);
          setVistaEnCurso(false);
          medir(true);
        } else {
          setVistaEnCurso(true);
        }
      }

      const intentar = async (intento: number): Promise<void> => {
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
                    esperaNoDisponible?: boolean;
                  }
                | null)
            : null;
          if (cancelled) {
            return;
          }
          if (payload?.ok && payload.esperaNoDisponible) {
            // La lista de antes queda a la vista y la direccion vuelve a la pestaña sin "Esperando".
            setVistaEnCurso(false);
            salirDeEsperando();
            return;
          }
          if (!payload?.ok || !Array.isArray(payload.conversations)) {
            throw new Error("lista");
          }
          const items = sortConversationItems(
            normalizeConversationItems(payload.conversations, (item) => hrefDeFila(item)),
            { ordenDelServidor },
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
          /*
            Ya NO router.refresh(): rehacia la pagina entera en el servidor (1,6-2 s). Un reintento a
            los 400 ms; si falla de nuevo, queda la lista de antes sin atenuar y el proximo
            pedidoDeLista vuelve a intentar este cambio de vista (vistaCargadaRef sigue en la de antes).
          */
          if (intento === 0) {
            await new Promise((listo) => setTimeout(listo, REINTENTO_DE_LISTA_MS));
            if (!cancelled) {
              await intentar(1);
            }
            return;
          }
          setVistaEnCurso(false);
        }
      };
      void intentar(0);

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
    if (esLaPrimera && !reconciliar && typeof performance !== "undefined" && performance.now() < 15_000) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const params = armarParams();
        // En "Esperando" el refresco trae la pagina mas grande: el chat que entra va al final.
        if (ordenDelServidor) params.set("limit", String(CONVERSATION_LIST_LOAD_BATCH_SIZE));

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              conversations?: SharedInboxConversationItem[];
              hasMore?: boolean;
              nextOffset?: number;
              esperaNoDisponible?: boolean;
            }
          | null;
        if (cancelled || !payload?.ok) {
          return;
        }
        if (payload.esperaNoDisponible) {
          salirDeEsperando();
          return;
        }
        if (!Array.isArray(payload.conversations)) {
          return;
        }

        const fresh = normalizeConversationItems(payload.conversations, (item) => hrefDeFila(item));

        if (ordenDelServidor) {
          // Orden del servidor: la pagina en su orden y despues lo cargado al bajar que no vino.
          const hayMas = Boolean(payload.hasMore);
          const siguiente = typeof payload.nextOffset === "number" ? payload.nextOffset : fresh.length;
          conversationOffsetRef.current = hayMas ? Math.max(conversationOffsetRef.current, siguiente) : siguiente;
          conversationCursorRef.current = null;
          setHasMoreConversationItems(hayMas);
          setConversationItems((current) => {
            const currentById = new Map(current.map((item) => [item.id, item]));
            const pagina = fresh.map((item) => mergeConversationListItem(item, currentById.get(item.id) ?? null));
            const juntas = sinContestadasAca(juntarPaginaDeEsperando(current, pagina, hayMas));
            return juntas.length === current.length &&
              current.every((item, index) => areConversationListItemsEqual(item, juntas[index]))
              ? current
              : juntas;
          });
          return;
        }

        const hayMasEnElServidor = Boolean(payload.hasMore);
        setConversationItems((current) => {
          let next = current;
          /*
            Al ponerse al dia salen los chats que dejaron la vista (reasignados, resueltos): antes este
            pedido solo agregaba y actualizaba. Con texto en el buscador no se toca nada (los
            resultados se quedan quietos), y nunca salen el chat abierto, los fijados ni las filas de
            la API oficial, que este /list no trae.
          */
          if (reconciliar && !isSearchActiveRef.current) {
            const abierto = chatAbiertoParaConservarRef.current;
            const fijados = new Set(fijadosParaConservarRef.current);
            next = reconciliarPrimeraPagina(next, fresh, hayMasEnElServidor, (fila) =>
              fila.id === abierto || fijados.has(fila.id) || fila.source === "official",
            );
          }
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
    "MÍAS" AL INSTANTE (Alex, 10-nov-2026). Filtrar Todas no alcanza: la primera tanda de Todas casi
    nunca trae los chats de quien mira. Con Todas abierta, por debajo se trae la primera tanda de Mías a
    los 3 s de cargar y se renueva cada 4 min (vive 5 en la memoria, ver listas-recientes-de-la-bandeja):
    al tocar Mías se dibuja esa lista en el acto (el cambio de vista ya la toma de la memoria) y /list la
    actualiza por debajo. Solo quien ve Todas (dueño, administradores, supervisora); con la pestaña
    escondida no se pide nada. Es un /list liviano cada 4 min por pestaña.
  */
  const sinCondicionesEnLaUrl = filtrosDeLaUrl.condiciones.length === 0;
  useEffect(() => {
    if (!(isManager || veTodoElEquipo) || !usuarioActualId) return;
    if (assignedFilter !== "all" || statusFilter !== "open" || enEspera || searchQuery.trim() || !sinCondicionesEnLaUrl) return;
    const claveMias = claveDeVista(searchQuery, selectedConnectionKey, "mine", "open", "", false);
    let cancelado = false;
    const precargar = async () => {
      if (cancelado || document.hidden) return;
      const guardada = leerListaReciente<SharedInboxConversationItem>(claveMias);
      if (guardada && Date.now() - guardada.at < LISTA_FRESCA_MS) return;
      const desde = Date.now();
      try {
        const params = new URLSearchParams();
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        params.set("assigned", "mine");
        params.set("limit", String(Math.min(40, Math.max(1, initialConversationBatchSize))));
        params.set("incluirOficial", "1");
        const respuesta = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload = respuesta.ok
          ? ((await respuesta.json().catch(() => null)) as
              | { ok?: boolean; conversations?: SharedInboxConversationItem[]; hasMore?: boolean; nextOffset?: number; nextCursor?: string | null }
              | null)
          : null;
        if (cancelado || !payload?.ok || !Array.isArray(payload.conversations)) return;
        // Si mientras viajaba se abrio Mias de verdad, esa lista es mas nueva: no se pisa.
        const yaHay = leerListaReciente<SharedInboxConversationItem>(claveMias);
        if (yaHay && yaHay.at >= desde) return;
        const items = sortConversationItems(
          normalizeConversationItems(payload.conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, "", item, "mine", "open", [], false),
          ),
          { ordenDelServidor: false },
        );
        guardarListaReciente(claveMias, {
          items,
          hasMore: Boolean(payload.hasMore),
          offset: typeof payload.nextOffset === "number" ? payload.nextOffset : items.length,
          cursor: typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
          at: Date.now(),
        });
      } catch {
        // Sin la lista guardada, Mias espera a /list como antes.
      }
    };
    const primera = window.setTimeout(() => void precargar(), 3000);
    const cada = window.setInterval(() => void precargar(), 4 * 60_000);
    return () => {
      cancelado = true;
      window.clearTimeout(primera);
      window.clearInterval(cada);
    };
  }, [
    isManager,
    veTodoElEquipo,
    usuarioActualId,
    assignedFilter,
    statusFilter,
    enEspera,
    searchQuery,
    sinCondicionesEnLaUrl,
    selectedConnectionKey,
    conversationListApiPath,
    initialConversationBatchSize,
    searchAction,
  ]);

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
  fijadosParaConservarRef.current = fijadosEnVivo;
  const fijadosYaPedidosRef = useRef(new Set<string>());
  useEffect(() => {
    const faltan = fijadosEnVivo.filter(
      (clave) => clave.startsWith("agent:") && !conversationItemsRef.current.some((item) => item.id === clave),
    );
    if (faltan.length === 0) {
      return;
    }
    // Una vez por combinacion de fijados y filtros: si el servidor no lo devolvio, no se insiste.
    const firma = [faltan.join(","), assignedFilter, statusFilter, selectedConnectionKey, searchQuery, enEspera ? "espera" : ""].join("|");
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
        // En "Esperando" el servidor devuelve solo los fijados que ademas estan esperando.
        if (enEspera) params.set("espera", "1");

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
            if (!item.id) continue;
            /*
              En "Esperando" no se inserta por fecha: el fijado va al final de lo cargado (la lista
              igual lo dibuja arriba, con los fijados) y al bajar no se repite.
            */
            next =
              ordenDelServidorRef.current && !next.some((fila) => fila.id === item.id)
                ? [...next, item]
                : updateConversationItemInSortedList(next, item.id, item, { ordenDelServidor: ordenDelServidorRef.current });
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
  }, [fijadosEnVivo, assignedFilter, statusFilter, selectedConnectionKey, searchQuery, enEspera, ponerFiltrosNuevos, conversationListApiPath, searchAction, hrefDeFila]);

  /*
    Búsqueda aumentativa, en DOS pasos (Alex, 10-11-2026):
     1. `soloNombreYNumero=1`: los chats por nombre o numero que estan mas alla de lo ya cargado. Se
        AGREGAN (nunca quitan) a la lista; no navega ni la reemplaza, asi borrar el buscador siempre
        restaura todos los chats al instante.
     2. Con 4 letras o mas, recien despues, `soloPorMensaje=1`: los chats con el texto en un mensaje,
        que se ponen al final (chatsPorMensaje). Si falla, queda lo del paso 1 sin ningun error.
    Una letra mas corta los dos pedidos (el AbortController) y lo que llegue tarde no se usa.
  */
  const runSearchAugmentation = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      searchAugmentAbortRef.current?.abort();

      if (!q) {
        searchAugmentAbortRef.current = null;
        setChatsPorMensaje(SIN_CHATS_POR_MENSAJE);
        return;
      }

      const controller = new AbortController();
      searchAugmentAbortRef.current = controller;
      const sigueVigente = () => searchAugmentAbortRef.current === controller && !controller.signal.aborted;

      const params = new URLSearchParams();
      params.set("limit", "40");
      if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
      // Siempre se manda: la ruta lee la ausencia como "mine", asi que omitirlo
      // estando en "Todas" hacia que el refresco de la lista la pasara sola a "Mias".
      params.set("assigned", assignedFilter);
      if (statusFilter !== "open") params.set("status", statusFilter);
      ponerFiltrosNuevos(params);
      // Los de otra pestaña, linea o filtro no se muestran mientras llegan los de esta.
      const vista = params.toString();
      setChatsPorMensaje((actual) => (actual.vista === vista ? actual : SIN_CHATS_POR_MENSAJE));
      params.set("q", q);

      const pedir = async (parte: "soloNombreYNumero" | "soloPorMensaje") => {
        const response = await fetch(`${conversationListApiPath}?${params.toString()}&${parte}=1`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;
        if (!payload?.ok || !Array.isArray(payload.conversations)) return null;
        return normalizeConversationItems(payload.conversations, (item) => hrefDeFila(item, q));
      };

      try {
        const porNombreYNumero = await pedir("soloNombreYNumero").catch(() => null);
        if (porNombreYNumero && sigueVigente()) {
          setConversationItems((current) => {
            const currentIds = new Set(current.map((item) => item.id));
            const additions = porNombreYNumero.filter((item) => item.id && !currentIds.has(item.id));
            return additions.length === 0
              ? current
              : sortConversationItems([...current, ...additions], { ordenDelServidor: ordenDelServidorRef.current });
          });
        }

        if (!buscaEnMensajes(q) || !sigueVigente()) return;
        const porMensaje = await pedir("soloPorMensaje");
        if (porMensaje && sigueVigente()) {
          setChatsPorMensaje({ q, vista, items: porMensaje });
        }
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

  /*
    El filtro local corre con cada letra; al servidor se va una vez por pausa (350 ms) y solo con 2
    letras o mas: con una sola letra casi todo coincide y el pedido no agrega nada que no este ya.
  */
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
      // Se vació el buscador (borrando a mano): restaurar la lista completa quitando `q` de la URL.
      if (!value.trim()) {
        clearSearchUrlParam();
      }
      if (value.trim().length < LETRAS_PARA_IR_AL_SERVIDOR) {
        // Corta el pedido que estaba en camino y suelta los resultados de la busqueda anterior.
        void runSearchAugmentation("");
        return;
      }
      searchDebounceRef.current = setTimeout(() => {
        searchDebounceRef.current = null;
        void runSearchAugmentation(value);
      }, ESPERA_DEL_BUSCADOR_MS);
    },
    [runSearchAugmentation, clearSearchUrlParam],
  );

  /*
    Cambiar Todas/Mias/asesora, un filtro o la linea con texto puesto: los resultados del servidor
    eran los de la vista anterior. Se vuelve a buscar UNA vez, cuando la lista nueva ya esta puesta
    (versionDeVista sube recien ahi): si se buscara antes, la lista nueva pisaria lo encontrado.
  */
  const busquedaVigenteRef = useRef({ texto: searchInputValue, buscar: runSearchAugmentation });
  // Va antes que el efecto de abajo: en el mismo render corre primero y le deja lo de ahora.
  useEffect(() => {
    busquedaVigenteRef.current = { texto: searchInputValue, buscar: runSearchAugmentation };
  }, [searchInputValue, runSearchAugmentation]);
  const versionDeVistaBuscadaRef = useRef(versionDeVista);
  useEffect(() => {
    if (versionDeVistaBuscadaRef.current === versionDeVista) return;
    versionDeVistaBuscadaRef.current = versionDeVista;
    const { texto, buscar } = busquedaVigenteRef.current;
    if (texto.trim().length < LETRAS_PARA_IR_AL_SERVIDOR) return;
    // Si quedaba una pausa del teclado en curso, esta busqueda la reemplaza.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = null;
    void buscar(texto);
  }, [versionDeVista]);
  /*
    La pagina abierta con `q` en la direccion (un chat abierto desde el buscador) trae del servidor
    solo los de nombre y numero: los de texto de mensaje se piden aca, una vez al cargar.
  */
  useEffect(() => {
    const { texto, buscar } = busquedaVigenteRef.current;
    if (texto.trim().length < LETRAS_PARA_IR_AL_SERVIDOR) return;
    void buscar(texto);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAugmentAbortRef.current?.abort();
    searchAugmentAbortRef.current = null;
    setChatsPorMensaje(SIN_CHATS_POR_MENSAJE);
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
    /*
      Con texto en el buscador el estado no filtra: el chat buscado sale aunque este cerrado (Alex,
      30-10-2026). Al borrar la busqueda vuelve el filtro de siempre y los cerrados se van solos.
    */
    const estado = estadoQueAplica(statusFilter, searchInputValue);
    const pasaElEstado = (item: SharedInboxConversationItem) => {
      const resueltaAca = estado === "open" ? resueltasAca.get(item.id) : undefined;
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
      return estado === "open" ? !cerrada : estado === "resolved" ? cerrada : true;
    };
    const porEstado = conversationItems.filter(pasaElEstado);

    const normalizedQuery = normalizeChatSearchText(searchInputValue.trim());
    if (!normalizedQuery) {
      return porEstado;
    }

    // "300 123 4567" tambien encuentra el numero guardado sin espacios, y "573012175617" el
    // guardado sin el 57 (igual que el servidor).
    const variantes = cifrasParaBuscarElTelefono(searchInputValue);

    /*
      Como en WhatsApp: en "Chats" van los que coinciden por NOMBRE o NUMERO; los que tienen la
      palabra adentro de un mensaje salen en la seccion "Mensajes", justo debajo (buscar-mensajes).

      Antes tambien entraban aca los que coincidian por el texto de un mensaje, y con una palabra
      comun -"Cali", que el agente dice en cada chat- la lista quedaba de decenas de chats y
      "Mensajes" terminaba al fondo, tapado por el teclado (Alex, 20-10-2026).

      Desde el 10-11-2026 (Alex) los que coinciden por el texto de un mensaje vuelven, pero AL
      FINAL, despues de los de nombre y numero, y un instante despues (la segunda llamada).
    */
    const porNombreYNumero = porEstado.filter((item) => {
      return (
        normalizeChatSearchText(item.label).includes(normalizedQuery) ||
        normalizeChatSearchText(item.secondaryLabel).includes(normalizedQuery) ||
        variantes.some(
          (cifras) =>
            item.secondaryLabel.replace(/\D/g, "").includes(cifras) || item.label.replace(/\D/g, "").includes(cifras),
        )
      );
    });
    // Solo los de lo que esta escrito AHORA: los de un texto anterior no.
    if (chatsPorMensaje.q !== searchInputValue.trim() || chatsPorMensaje.items.length === 0) {
      return porNombreYNumero;
    }
    return filasDelBuscador({
      porNombreYNumero,
      porMensaje: chatsPorMensaje.items,
      actuales: new Map(conversationItems.map((item) => [item.id, item])),
      pasa: pasaElEstado,
    });
  }, [conversationItems, resueltasAca, searchInputValue, statusFilter, chatsPorMensaje]);

  /*
    "Cargar mas" ESTABLE (no cambia en cada pagina). Antes dependia del largo de la lista y de los
    estados de carga: cada pagina nueva creaba otra funcion, la lista volvia a montar sus escuchas
    del scroll y a revisar si estaba cerca del fondo, y se encadenaban pedidos uno tras otro. Ahora
    la funcion de verdad vive en un ref y la lista recibe siempre la misma.
  */
  const loadMoreConversationItemsImpl = async () => {
    if (isLoadingMoreConversationItems || !hasMoreConversationItems) {
      return;
    }

    /*
      En "Esperando" se sigue desde lo que hay en pantalla: los que dejaron de esperar ya salieron
      (sincronizarConEspera) y tambien salieron de la lista del servidor, asi la pagina siguiente no
      salta a nadie. Puede ser 0 si se vacio la pantalla y quedan mas.
    */
    const offset = ordenDelServidor
      ? Math.min(conversationOffsetRef.current, conversationItems.length)
      : conversationOffsetRef.current;
    if (offset <= 0 && !ordenDelServidor) {
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
      if (enEspera) {
        params.set("espera", "1");
      }

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
            esperaNoDisponible?: boolean;
          }
        | null;

      if (payload?.ok && payload.esperaNoDisponible) {
        salirDeEsperando();
        return;
      }

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
        const sorted = ordenDelServidor
          ? sinContestadasAca(sortConversationItems(deduped, { ordenDelServidor }))
          : sortConversationItems(deduped);

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
  };
  const loadMoreConversationItemsRef = useRef(loadMoreConversationItemsImpl);
  loadMoreConversationItemsRef.current = loadMoreConversationItemsImpl;
  const loadMoreConversationItems = useCallback(() => loadMoreConversationItemsRef.current(), []);

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
  chatAbiertoParaConservarRef.current = selectedConversationKey;

  /*
    Con el filtro "Sin responder" puesto, un chat ya contestado sale de la lista sin recargar (parte 4
    de la marca). El chat abierto se queda hasta cambiar de chat. Tambien tapa la cache de 60 s del
    filtro: un chat recien contestado no reaparece. Uno recien escrito puede tardar hasta 1 min en
    entrar, y es lo esperado.
  */
  const filasDeLaBarraLateral = useMemo(() => {
    const filtroPuesto = filtroSinResponderPuesto(filtrosDeLaUrl.condiciones);
    if (!filtroPuesto) return displayedConversationItems;
    return displayedConversationItems.filter(
      (item) =>
        !seOcultaPorSinResponder({
          filtroPuesto,
          sinResponderDesde: item.sinResponderDesde,
          esElChatAbierto: conversationIdMatchesKey(selectedConversationKey, item.id),
        }),
    );
  }, [displayedConversationItems, filtrosDeLaUrl, selectedConversationKey]);

  /*
    La marca «espera N min» (parte 3 de "Esperando respuesta"). El dato llega en el /counts de cada
    60 s y se agrega aca, al dibujar, por `key`: no se guarda en conversationItems, asi el tiempo
    real (que reemplaza filas enteras) no lo pisa. El minuto lo sube el reloj de ConversationList,
    sin pedir nada al servidor.
  */
  const filasConEspera = useMemo(() => {
    if (esperaPorClaveActual.size === 0) return filasDeLaBarraLateral;
    return filasDeLaBarraLateral.map((item) => {
      const desde = esperaPorClaveActual.get(item.id);
      return desde ? { ...item, esperaDesde: desde } : item;
    });
  }, [esperaPorClaveActual, filasDeLaBarraLateral]);

  /*
    "ESPERANDO" AL DIA CON CADA /counts (cada 60 s), sin pedir nada para decidirlo.

    - Un chat que ya no viene en `espera.chats` sale de la lista en el acto, sin pedir nada.
    - Un chat que entra a esperar y la lista no tiene pide /list UNA vez (ver sincronizarConEspera).
      Lo que ya estaba esperando cuando se cargo la vista (y todavia no se bajo a verlo) no cuenta
      como nuevo: lo trae el scroll. Por eso, con la vista abierta y sin chats nuevos, no sale /list.
    Con texto en el buscador no se toca nada: los resultados de la busqueda se quedan quietos.
  */
  const esperaConocidasRef = useRef<{ version: string; claves: Set<string> } | null>(null);
  useEffect(() => {
    if (!ordenDelServidor || searchInputValue.trim() || !esperaVigente) return;
    // La lista a la vista todavia es la de otra vista: la de "Esperando" esta llegando.
    if (vistaCargadaRef.current !== vistaKey) return;
    const version = `${vistaKey}#${versionDeVista}`;
    const anteriores = esperaConocidasRef.current?.version === version ? esperaConocidasRef.current.claves : null;
    // Recien cargada la vista: lo que ya esperaba se da por conocido (no se pide).
    const yaPedidas = anteriores ?? new Set(esperaVigente.chats.map((chat) => chat.key));
    const { faltan, pedirLista } = sincronizarConEspera({
      items: conversationItemsRef.current,
      espera: esperaVigente,
      asignacion: assignedFilter,
      yaPedidas,
    });
    esperaConocidasRef.current = { version, claves: new Set([...yaPedidas, ...faltan]) };
    setConversationItems(
      (current) => sincronizarConEspera({ items: current, espera: esperaVigente, asignacion: assignedFilter, yaPedidas }).items,
    );
    if (pedirLista) {
      setPedidoDeLista((actual) => actual + 1);
    }
  }, [ordenDelServidor, searchInputValue, esperaVigente, vistaKey, versionDeVista, assignedFilter]);

  /*
    La asesora contesto desde esta pantalla (envio bueno): el chat sale en el acto de "Esperando" y
    el numero baja, sin esperar al /counts siguiente. No toca el envio: solo mira su resultado.
  */
  const marcarContestadaEnEspera = useCallback((idOClave: string) => {
    const id = idOClave.trim();
    if (!id) return;
    const clave =
      esperaVigenteRef.current?.chats.find((chat) => conversationIdMatchesKey(chat.key, id))?.key ??
      conversationItemsRef.current.find((item) => conversationIdMatchesKey(item.id, id))?.id ??
      null;
    if (!clave) return;
    const ahora = Date.now();
    setContestadasAca((actual) => {
      const siguiente = new Map([...actual].filter(([, en]) => ahora - en <= CONTESTADA_VIGENTE_MS));
      siguiente.set(clave, ahora);
      return siguiente;
    });
    if (ordenDelServidorRef.current) {
      setConversationItems((current) => current.filter((item) => item.id !== clave));
    }
  }, []);

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
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter, [], esperaDelServidor),
        ),
      );
      return;
    }

    // La lista "Esperando" del servidor ya viene en su orden: no se reordena por fecha.
    const orden = { ordenDelServidor: esperaDelServidor && !searchQuery.trim() };
    setConversationItems((current) => {
      if (current.length === 0) {
        return sortConversationItems(
          normalizeConversationItems(conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter, [], esperaDelServidor),
          ),
          orden,
        );
      }

      const currentById = new Map(current.map((item) => [item.id, item]));
      const frescos = normalizeConversationItems(conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter, [], esperaDelServidor),
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
      const sorted = sortConversationItems([...frescos, ...cargadosAlBajar], orden);

      if (
        current.length === sorted.length &&
        current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
      ) {
        return current;
      }

      return sorted;
    });
  }, [conversations, initialConversationBatchSize, initialConversationOffset, initialHasMoreConversations, searchAction, searchQuery, selectedConnectionKey, assignedFilterDelServidor, statusFilterDelServidor, esperaDelServidor, vistaDelServidorKey]);

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

  /*
    La ventana de apertura (suppressHistoryLoadUntilRef) dura 0,7 s desde que se pinta el chat. En
    un celular con mala senal el /live de apertura, o la precarga, puede llegar despues, y entonces
    sus mensajes bajaban animados justo donde mas se nota. Cuando llega uno de los dos se vuelve a
    abrir otros 0,7 s, SOLO si la asesora sigue al final: si subio, el observador de tamano la
    bajaria a la fuerza mientras lee.
  */
  const reabrirVentanaDeApertura = useCallback(() => {
    if (!estaPegadaAlFinal(distanciaAlFinalRef.current) || ultimoGestoRef.current > aperturaEnRef.current) {
      return;
    }
    const hasta = Date.now() + 700;
    suppressHistoryLoadUntilRef.current = Math.max(suppressHistoryLoadUntilRef.current, hasta);
    ventanaAperturaHastaRef.current = Math.max(ventanaAperturaHastaRef.current, hasta);
  }, []);

  /*
    Precarga que llega despues del toque (chats, parte 2). Si la asesora toca un chat cuya precarga
    todavia viene en camino, la copia de abajo se lee antes de que exista y quedaba la vista previa
    hasta el /live de apertura. Cuando esa precarga termina, se vuelve a leer la copia por el mismo
    camino (validado por id, y con el /live por delante si ya llego). Si la asesora ya cambio de
    chat, el aviso se descarta.
  */
  const [lecturaDeLaCopia, setLecturaDeLaCopia] = useState(0);
  useEffect(() => {
    if (!selectedConversationKey) {
      return;
    }
    const enCamino = precargaEnCamino(selectedConversationKey);
    if (!enCamino) {
      return;
    }
    let vigente = true;
    void enCamino.then(() => {
      if (!vigente) {
        return;
      }
      reabrirVentanaDeApertura();
      setLecturaDeLaCopia((actual) => actual + 1);
    });
    return () => {
      vigente = false;
    };
  }, [selectedConversationKey, reabrirVentanaDeApertura]);

  // Clave efectiva del chat activo. Sirve para sincronizar el panel y para
  // evitar que el listado se reordene cuando el evento pertenece al chat abierto.
  const selectedConversationCache = useMemo(
    () =>
      hasHydrated && selectedConversationKey
        ? readConversationFromCache(selectedConversationKey, { ignoreFreshness: true })
        : null,
    // lecturaDeLaCopia: volver a leer cuando termina la precarga del chat abierto (ver arriba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasHydrated, selectedConversationKey, lecturaDeLaCopia],
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
  const copiaDelChatAbiertoRef = useRef<SharedInboxSelectedConversation | null>(null);
  copiaDelChatAbiertoRef.current = cachedConversationForCurrentSelection;

  /*
    Sobre que se mezcla un snapshot del chat abierto. UN solo lugar para los cuatro caminos que traen
    mensajes: el /live de apertura, el segundo /live, el tiempo real y el historial.

    La base SOLO puede ser una conversacion cuyo id COINCIDA con el snapshot; si ninguna coincide, es
    `null` y se arranca limpio con el snapshot. Antes, en algunos caminos, caia en la conversacion
    anterior y le mezclaba el snapshot nuevo encima: los mensajes de un chat quedaban bajo otro (el
    cruce real: mis-amores bajo Vanessa/Karen).

    Orden: lo que ya llego del servidor en esta apertura, el chat que pinto la pagina y, por ultimo,
    la copia guardada, solo si empalma con el snapshot (ver copiaComoBase). Sin la copia como base, el
    /live de 10 mensajes reemplazaba a la copia de 50.
  */
  const baseParaMezclar = useCallback(
    (
      current: SharedInboxSelectedConversation | null,
      snapshot: SharedInboxSelectedConversation,
      opciones?: { paginaAnterior?: boolean },
    ) => {
      if (current && conversationIdMatchesKey(current.id, snapshot.id)) {
        return current;
      }
      const delServidor = selectedConversationRef.current;
      if (delServidor && conversationIdMatchesKey(delServidor.id, snapshot.id)) {
        return delServidor;
      }
      const copia = copiaDelChatAbiertoRef.current;
      if (!copia || !conversationIdMatchesKey(copia.id, snapshot.id)) {
        return null;
      }
      return copiaComoBase(copia, snapshot, opciones);
    },
    [],
  );
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
    /*
      Los chats "official:" tambien: su aviso en tiempo real no trae el mensaje (solo avisa), y el
      router.refresh() que lo traia tras enviar una foto o una nota de voz ya no esta. /live los
      soporta; /summary no, asi que ahi solo se pide /live (la fila ya subio con el aviso local).
    */
    const esOficial = chatKey.startsWith("official:");
    if (!chatKey.startsWith("agent:") && !esOficial) {
      return;
    }

    try {
      const [liveResponse, summaryResponse] = await Promise.all([
        fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        }),
        esOficial
          ? Promise.resolve(null)
          : fetch(`/api/cliente/chats/summary?chatKey=${encodeURIComponent(chatKey)}`, {
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

      if (summaryResponse?.ok) {
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
  /*
    Varios envios seguidos (10 fotos) se juntan en UN refresco: cada envio reinicia el temporizador,
    asi no salen 10 pedidos a /live. Se lee la funcion desde una referencia para que el temporizador
    use la del chat abierto cuando dispara.
  */
  const refreshSelectedConversationFromServerRef = useRef(refreshSelectedConversationFromServer);
  useEffect(() => {
    refreshSelectedConversationFromServerRef.current = refreshSelectedConversationFromServer;
  }, [refreshSelectedConversationFromServer]);
  const refrescoTrasEnviarRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refrescoTrasEnviarRef.current) {
        clearTimeout(refrescoTrasEnviarRef.current);
      }
    },
    [],
  );
  const scheduleConversationRefreshAfterSend = useCallback(() => {
    if (refrescoTrasEnviarRef.current) {
      clearTimeout(refrescoTrasEnviarRef.current);
    }
    refrescoTrasEnviarRef.current = setTimeout(() => {
      refrescoTrasEnviarRef.current = null;
      void refreshSelectedConversationFromServerRef.current();
    }, 1500);
  }, []);

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

      // Base validada por id (ver baseParaMezclar): nunca la conversacion de otro chat.
      setLiveConversation((current) => mergeConversationSnapshotIfChanged(baseParaMezclar(current, snapshot), snapshot));
      // El detalle (setLiveConversation, arriba) SI se actualiza aunque haya busqueda; solo
      // la LISTA se congela para que el resultado no cambie de preview/orden en vivo.
      if (!isSearchActiveRef.current) {
        setConversationItems((current) => {
          const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
          const updatedItem = normalizeRealtimeConversationItem(buildConversationItemFromSnapshot(snapshot, currentItem));
          return updateConversationItemInSortedList(current, snapshot.id, updatedItem, {
            ordenDelServidor: ordenDelServidorRef.current,
          });
        });
      }
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [baseParaMezclar, normalizeRealtimeConversationItem, selectedConversationKey]);

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
      /*
        En "Esperando" un aviso de un chat que no esta en la lista NO pide /list: si ese chat empezo
        a esperar, lo trae el /counts siguiente (sincronizarConEspera pide la lista una sola vez).
        Asi la vista abierta no agrega pedidos por cada mensaje que entra.
      */
      if (!yaEstaEnLaLista && !esAvisoLocal && !ordenDelServidorRef.current) {
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
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem, {
          ordenDelServidor: ordenDelServidorRef.current,
        });
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

          // Base validada por id (ver baseParaMezclar): nunca la conversacion de otro chat.
          setLiveConversation((current) =>
            mergeConversationSnapshotIfChanged(baseParaMezclar(current, snapshot), snapshot),
          );
        })
        .catch(() => null);
    }, 2500);
  }, [baseParaMezclar]);

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
      // La ficha y el interruptor de seguimientos esperan esta respuesta en vez de pedirlos con
      // acciones de servidor (ver datos-de-la-apertura.ts). Se cierra SIEMPRE en el finally.
      let datosDeLaApertura: Parameters<typeof terminoLaApertura>[0];
      empezoLaApertura();
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

        // 404: reasignado, borrado o sin permiso. Fuera del guardado y de la lista (P5, T5).
        atenderChatSinAcceso(response, normalizedSelectedConversationId);
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
        {
          const traido = payload.conversation as { contactId?: unknown; ficha?: unknown; seguimientosApagados?: unknown };
          datosDeLaApertura = {
            contactId: typeof traido.contactId === "string" ? traido.contactId : null,
            ficha: traido.ficha,
            conversationId: normalizedSelectedConversationId.startsWith("agent:")
              ? normalizedSelectedConversationId.slice("agent:".length)
              : null,
            seguimientosApagados: traido.seguimientosApagados,
          };
        }

        // Si la asesora sigue al final, lo que traiga entra sin bajada animada (ver la funcion).
        reabrirVentanaDeApertura();
        // Base validada por id (ver baseParaMezclar): nunca la conversacion de otro chat.
        setLiveConversation((current) => mergeConversationSnapshotIfChanged(baseParaMezclar(current, snapshot), snapshot));
      } catch {
        // Si falla, la vista cacheada/preview sigue siendo usable; abajo se marca el fallo.
      } finally {
        terminoLaApertura(datosDeLaApertura);
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
    // (programarSegundoLive, baseParaMezclar y reabrirVentanaDeApertura son estables: no vuelven a
    // correr el efecto.)
    // reintentoCargaDelChat solo cambia cuando la asesora toca "Reintentar" en un chat que no cargo.
  }, [selectedConversationKey, programarSegundoLive, reintentoCargaDelChat, baseParaMezclar, reabrirVentanaDeApertura]);

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
      /*
        La posicion se mide AHORA, justo antes de agregar los antiguos, y no al pedirlos: si la
        asesora siguio subiendo mientras cargaban, restaurar la medida vieja la hacia retroceder.
        Se guarda tambien el ultimo mensaje: si mientras tanto entro uno nuevo, la medida ya no sirve.
      */
      const ahora = messagesScrollRef.current ?? container;
      loadMoreHistoryRestoreRef.current = {
        scrollTop: ahora.scrollTop,
        scrollHeight: ahora.scrollHeight,
        ultimoId: renderedMessagesRef.current.at(-1)?.id ?? "",
      };
      // Base validada por id (ver baseParaMezclar). La pagina se pidio con el cursor de lo que se ve:
      // empalma con la copia aunque todavia no haya llegado el /live de apertura.
      setLiveConversation((current) =>
        mergeConversationSnapshotIfChanged(baseParaMezclar(current, snapshot, { paginaAnterior: true }), snapshot),
      );
    } catch {
      // Ignore loading failures so scroll never gets blocked.
    } finally {
      if (!shouldRestoreScroll) {
        loadMoreHistoryRestoreRef.current = null;
      }
      loadMoreHistoryInFlightRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [baseParaMezclar, renderedConversation, selectedConversation, selectedConversationId]);

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
      deletedMessageIds.size === 0 && editedMessages.size === 0
        ? baseRenderedMessages
        : baseRenderedMessages.map((message) => {
            const edicion = editedMessages.get(message.id);
            const conEdicion = edicion ? { ...message, content: edicion.content, editedAt: edicion.editedAt } : message;
            return deletedMessageIds.has(message.id) && !message.deletedAt
              ? { ...conEdicion, deletedAt: new Date() }
              : conEdicion;
          }),
    [baseRenderedMessages, deletedMessageIds, editedMessages],
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
        // Desde el 11-nov-2026 nada de esto mira la version: el texto va por la ruta normal, que no se
        // rompe con un despliegue, y si falla queda "No se envió" con Reintentar, como cualquier falla.
        setOptimisticOutgoingMessage((current) => (current && current.id === optimisticId ? null : current));
      } else if (result.suppressOptimistic) {
        setOptimisticOutgoingMessage((current) => (current && current.id === optimisticId ? null : current));
      }

      if (result?.ok && !result.suppressOptimistic) {
        scheduleConversationRefreshAfterSend();
        if (enviado) {
          marcarContestadaEnEspera(enviado.envio?.chatKey ?? enviado.conversationId);
        }
      }
    },
    [scheduleConversationRefreshAfterSend, marcarContestadaEnEspera],
  );

  /*
    Fin de un envio bueno desde el panel (foto, archivo, nota de voz, ubicacion, biblioteca, carta
    de colores, flujo). Reemplaza al router.refresh() del panel y al revalidatePath de las acciones,
    que rearmaban /cliente/chats entero en cada envio.

    - Con `tipo`: la fila del chat DESTINO sube al instante con el mismo aviso local del texto.
    - Si el destino es el chat abierto: /live de ese chat a los 1,5 s (ver arriba), que trae el
      mensaje real aunque se pierda el aviso en tiempo real.
  */
  const handleEnvioTerminado = useCallback(
    (envio: EnvioTerminado) => {
      const conversationId = envio.conversationId?.trim();
      if (!conversationId) {
        return;
      }
      if (envio.tipo) {
        window.dispatchEvent(
          new CustomEvent("chat-list-update", {
            detail: {
              conversation: {
                id: conversationId,
                incomingCount: 0,
                lastMessage: envio.texto ?? null,
                lastMessageType: envio.tipo,
                lastMessageDirection: "OUTBOUND" as const,
                lastMessageAt: new Date(),
              },
              // Fila armada aca: no debe pedir /list al servidor (ver handleListUpdate).
              local: true,
            },
          }),
        );
      }
      if (conversationIdMatchesKey(selectedConversationKey, conversationId)) {
        scheduleConversationRefreshAfterSend();
      }
      // Foto, archivo, nota de voz o ubicacion de la asesora: contesta. Un flujo (sin tipo) no se cuenta.
      if (envio.tipo) {
        marcarContestadaEnEspera(conversationId);
      }
    },
    [scheduleConversationRefreshAfterSend, selectedConversationKey, marcarContestadaEnEspera],
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

        // Enviar es una de las tres cosas que bajan la vista (ver scroll-del-hilo.ts).
        if (!debeBajarAlFinal({ tipo: "enviar" })) {
          return;
        }
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        distanciaAlFinalRef.current = 0;
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

      // Numero unico del mensaje: viaja en cada intento y en Reintentar, asi nunca sale dos veces.
      formData.set("clientMessageId", nuevoIdDeMensaje());
      const campos = camposDelFormulario(formData);

      // Registro del envio: si falla, de aca sale la burbuja "No se envió" y su Reintentar.
      enviosEnCursoRef.current.set(optimisticId, {
        ...burbuja,
        envio: { chatKey: chatDelEnvio, campos },
      });

      // Envio sin navegacion por la ruta normal (no se rompe con una version nueva). Si falla de
      // una forma en que seguro no salio, se reintenta solo hasta 2 veces con el mismo numero.
      void enviarTextoConReintentos(campos)
        .then((resultado) => finalizeOptimisticSend(optimisticId, resultado))
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

  const handleEditMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    setMessageToEdit(target);
  }, []);

  const handleSaveEditedMessage = useCallback((target: SharedInboxMessageItem, texto: string) => {
    setMessageToEdit(null);
    const quitarEdicion = () =>
      setEditedMessages((current) => {
        const next = new Map(current);
        next.delete(target.id);
        return next;
      });
    setEditedMessages((current) => new Map(current).set(target.id, { content: texto, editedAt: new Date() }));

    const formData = new FormData();
    formData.set("messageId", target.id);
    formData.set("text", texto);
    void Promise.resolve(editChatMessageAction(formData))
      .then((result) => {
        if (!result?.ok) {
          quitarEdicion();
          toast.error(result?.error || "No se pudo editar: WhatsApp no lo permitió");
        }
      })
      .catch(() => {
        quitarEdicion();
        toast.error("No se pudo editar: WhatsApp no lo permitió");
      });
  }, []);

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

    // El envio final va por las rutas fijas (/enviar-audio, /enviar-archivo) y no por la Server
    // Action del prop: esa cambia de id en cada build y fallaba en las pestañas abiertas antes de un
    // despliegue. Misma entrada y misma respuesta; cubre archivos, Reintentar, biblioteca, carta y audio.
    return {
      ...composer,
      audio: composer.audio ? { ...composer.audio, conversationId: targetId, source, sendAction: enviarAudioPorRuta } : undefined,
      media: composer.media ? { ...composer.media, conversationId: targetId, source, sendAction: enviarArchivoPorRuta } : undefined,
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

  const clientHeaderActions = useMemo(() => {
    const conversation = renderedConversation;
    if (!conversation || !selectedConversationKey.startsWith("agent:")) {
      return null;
    }
    /*
      Mientras llega /live (vista previa), los botones salen de la FILA de la lista, que ya trae
      contacto, etapa, linea, agente y estado (iPhone, 11-11-2026: "la cabecera sale sin el boton de
      llamar y luego aparece y los botones se corren"). Misma clave que la de /live: al llegar no se
      vuelve a montar, solo cambian los datos.
    */
    // Tambien con la copia guardada del chat, que puede venir sin contacto o sin etapa (medido: el
    // boton de llamar salia a los 0,4-1,5 s igual).
    const usaFila = conversation.isPreview || !conversation.contactId || !conversation.crmStage;
    const fila = usaFila ? filaDelChatAbierto : null;
    const contactId = conversation.contactId || fila?.contactId;
    const etapa = conversation.crmStage || fila?.crmStage;
    if (!contactId || !etapa) {
      return null;
    }
    const estado = (usaFila ? fila?.status ?? conversation.status : conversation.status) ?? "OPEN";

    return (
      <ChatHeaderActions
        key={`header-actions:${conversation.id}:${estado}`}
        contactId={contactId}
        stage={etapa as CrmStage}
        /*
          Se pasa el DESTINO de la llamada, que puede ser un telefono o el identificador oculto de
          WhatsApp. A los leads de anuncios -que llegan sin telefono- ahora tambien se les puede
          llamar: probado el 25-09-2026 y el boton ya no se apaga con ellos.
        */
        telefono={resolveCallTarget({ phoneNumber: conversation.secondaryLabel })}
        nombreContacto={conversation.label}
        channelId={conversation.channelId ?? fila?.channelId ?? null}
        avatarUrl={conversation.avatarUrl ?? null}
        conversationId={conversation.id}
        automationPaused={Boolean(usaFila && fila ? fila.automationPaused : conversation.automationPaused)}
        status={estado}
        returnTo={typeof window === "undefined" ? "" : window.location.pathname + window.location.search}
        toggleAutomationAction={toggleConversationAutomationAction}
      />
    );
  }, [filaDelChatAbierto, renderedConversation, selectedConversationKey]);

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
        // El segundo asesor (solo WhatsApp normal). Mientras /live no lo trae, no se muestra el bloque.
        segundoAsesor={
          esOficial || conversation.segundoAsesorId === undefined
            ? undefined
            : conversation.segundoAsesorId
              ? { id: conversation.segundoAsesorId, name: conversation.segundoAsesorNombre ?? null }
              : null
        }
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

  /*
    EL BUSCADOR COMO EL DE WHATSAPP (Alex, 19-10-2026). Ver busqueda-de-chats-store.

    "Mensajes": los mensajes que contienen lo escrito (con 3 letras o mas), debajo de los chats.
    Tocar uno abre el chat EN ese mensaje: se pide la tanda grande que llega hasta el (`desde`) y el
    efecto de abajo lleva la vista hasta el y lo resalta.
  */
  const [mensajesEncontrados, setMensajesEncontrados] = useState<{ q: string; mensajes: MensajeEncontrado[] }>({
    q: "",
    mensajes: [],
  });
  useEffect(() => {
    const q = searchInputValue.trim();
    if (q.length < LETRAS_PARA_BUSCAR_MENSAJES) {
      return;
    }
    const controller = new AbortController();
    const espera = window.setTimeout(async () => {
      try {
        const respuesta = await fetch(`/api/cliente/chats/buscar-mensajes?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const datos = (await respuesta.json().catch(() => null)) as { ok?: boolean; mensajes?: MensajeEncontrado[] } | null;
        if (datos?.ok && Array.isArray(datos.mensajes)) {
          setMensajesEncontrados({ q, mensajes: datos.mensajes });
        }
      } catch {
        // Abortado o sin red: queda la busqueda de chats.
      }
    }, ESPERA_DEL_BUSCADOR_MS);
    return () => {
      window.clearTimeout(espera);
      controller.abort();
    };
  }, [searchInputValue]);
  // Solo se muestran los de lo que esta escrito AHORA: los de una busqueda anterior no.
  const mensajesDeLaBusqueda =
    searchInputValue.trim().length >= LETRAS_PARA_BUSCAR_MENSAJES && mensajesEncontrados.q === searchInputValue.trim()
      ? mensajesEncontrados.mensajes
      : SIN_MENSAJES_ENCONTRADOS;

  /** Abre un chat desde el buscador (un mensaje encontrado o una busqueda reciente). */
  const abrirChatDesdeElBuscador = useCallback(
    (chat: { chatKey: string; nombre: string; telefono: string; avatarUrl: string | null }, messageId?: string) => {
      // En Android el teclado podia quedar atado a la caja del buscador (que se esconde al abrir el
      // chat) y lo que se escribia en el compositor no aparecia: se suelta el foco antes de abrir.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const href = hrefDeFila({ id: chat.chatKey, source: "agent" }, searchInputValue.trim());
      anotarChatReciente({ ...chat, href });
      if (messageId) {
        pedirIrAlMensaje(chat.chatKey, messageId);
      }
      setPendingConversationSelection({
        id: chat.chatKey,
        chatKey: chat.chatKey,
        source: "agent",
        label: chat.nombre,
        secondaryLabel: chat.telefono,
        avatarUrl: chat.avatarUrl,
        hasCache: Boolean(readConversationFromCache(chat.chatKey, { ignoreFreshness: true })),
      });
      window.history.pushState(null, "", href);
      if (!messageId) {
        return;
      }
      // La tanda que llega hasta el mensaje. Se suma (no reemplaza) a lo que traiga la apertura normal.
      void fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chat.chatKey)}&desde=${encodeURIComponent(messageId)}&conLlamada=1`,
        { credentials: "same-origin", cache: "no-store" },
      )
        .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
        .then((datos: { ok?: boolean; conversation?: unknown } | null) => {
          const snapshot = datos?.ok ? normalizeLiveConversationSnapshot(datos.conversation) : null;
          if (!snapshot) return;
          setLiveConversation((current) =>
            mergeConversationSnapshotIfChanged(
              current && conversationIdMatchesKey(current.id, snapshot.id) ? current : null,
              snapshot,
            ),
          );
        })
        .catch(() => undefined);
    },
    [hrefDeFila, searchInputValue],
  );

  // Un chat abierto desde la lista MIENTRAS se busca tambien queda en "recientes".
  const ultimoAnotadoRef = useRef("");
  useEffect(() => {
    const clave = selectedConversationKey.trim();
    if (!clave || !searchInputValue.trim() || ultimoAnotadoRef.current === clave) return;
    const fila = displayedConversationItems.find((item) => item.id === clave);
    if (!fila) return;
    ultimoAnotadoRef.current = clave;
    anotarChatReciente({
      chatKey: clave,
      nombre: fila.label ?? fila.secondaryLabel ?? clave,
      telefono: fila.secondaryLabel ?? "",
      avatarUrl: fila.avatarUrl ?? null,
      href: fila.href || hrefDeFila(fila, searchInputValue.trim()),
    });
  }, [selectedConversationKey, searchInputValue, displayedConversationItems, hrefDeFila]);

  /*
    Llevar la vista al mensaje buscado y resaltarlo.

    Al abrir, el chat se pega al fondo varias veces (al montar, a los 80 y 250 ms y cuando cargan las
    fotos). Por eso no alcanza con un scroll: se lo vuelve a centrar un rato despues de encontrarlo.
    Si a los ~6 s no aparecio (muy viejo: mas de 400 mensajes atras), se avisa y se suelta.
  */
  const mensajeAEnfocar = useMensajeAEnfocar();
  useEffect(() => {
    if (!mensajeAEnfocar || !conversationIdMatchesKey(selectedConversationKey, mensajeAEnfocar.chatKey)) {
      return;
    }
    let vueltas = 0;
    let encontradoEn = -1;
    const reloj = window.setInterval(() => {
      vueltas += 1;
      const contenedor = messagesScrollRef.current;
      const burbuja = contenedor?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(mensajeAEnfocar.messageId)}"]`,
      );
      if (burbuja) {
        // Que el scroll de arriba no dispare la carga de mensajes viejos mientras se acomoda.
        suppressHistoryLoadUntilRef.current = Date.now() + 1500;
        // Ya no esta al final: que una foto que carga no la devuelva abajo mientras se centra.
        distanciaAlFinalRef.current = Number.POSITIVE_INFINITY;
        ventanaAperturaHastaRef.current = 0;
        burbuja.scrollIntoView({ block: "center" });
        if (encontradoEn < 0) {
          encontradoEn = vueltas;
          burbuja.classList.add("mensaje-citado-resaltado");
          window.setTimeout(() => burbuja.classList.remove("mensaje-citado-resaltado"), 2500);
        }
      }
      const yaSeAcomodo = encontradoEn >= 0 && vueltas - encontradoEn >= 8;
      if (yaSeAcomodo || vueltas >= 40) {
        window.clearInterval(reloj);
        if (encontradoEn < 0) {
          toast.info("Ese mensaje está muy atrás en la conversación. Sube para verlo.");
        }
        soltarMensajeAEnfocar();
      }
    }, 150);
    return () => window.clearInterval(reloj);
  }, [mensajeAEnfocar, selectedConversationKey]);

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

  /** Repite un envio de texto que no salio (boton Reintentar). */
  const reenviarFallido = useCallback((failed: OptimisticDraftMessage | null) => {
    const composerValue = composerRef.current;
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

    // Se repite el envio TAL CUAL (mismo chat, misma firma, misma cita y mismo numero unico: si
    // el primero si habia salido, el servidor no lo repite), no con los campos del chat abierto ahora.
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
    if (!formData.get("clientMessageId")) {
      formData.set("clientMessageId", nuevoIdDeMensaje());
    }
    const campos = camposDelFormulario(formData);

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
      envio: { chatKey: chatDelEnvio, campos },
    };
    setMensajesFallidos((lista) => quitarFallido(lista, failed.id));
    setOptimisticOutgoingMessage(burbuja);
    enviosEnCursoRef.current.set(optimisticId, burbuja);

    void enviarTextoConReintentos(campos)
      .then((resultado) => finalizeOptimisticSend(optimisticId, resultado))
      .catch(() => finalizeOptimisticSend(optimisticId, null))
      .finally(liberar);
  }, [finalizeOptimisticSend]);

  const handleRetryFailedMessage = useCallback((target: SharedInboxMessageItem) => {
    reenviarFallido(mensajesFallidosRef.current.find((item) => item.id === target.id) ?? null);
  }, [reenviarFallido]);

  /*
    Con un texto en camino, o uno que quedo "No se envió" esperando Reintentar (vive solo en memoria:
    una recarga lo perderia), la app no se recarga sola en segundo plano (app-version-guard.tsx).
  */
  useEffect(() => {
    marcarOcupada("texto", chatsConTextoEnCurso.length > 0, "envio");
    return () => marcarOcupada("texto", false);
  }, [chatsConTextoEnCurso.length]);
  useEffect(() => {
    marcarOcupada("textos-fallidos", mensajesFallidos.length > 0, "envio");
    return () => marcarOcupada("textos-fallidos", false);
  }, [mensajesFallidos.length]);
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
    distanciaAlFinalRef.current = 0;
    setUnreadCount(0);
    showJumpToBottomRef.current = false;
    setShowJumpToBottom(false);
    prevScrollKeyRef.current = "";
    lastScrollTopRef.current = 0;
    historyLoadArmedRef.current = false;
    historyLoadConsumedRef.current = false;
  }, [selectedConversationId]);

  /*
    El contenedor de la conversacion (`.chat-messages-scroll`) solo existe mientras hay un chat
    abierto. Los vigilantes del scroll se conectaban UNA vez, al cargar la bandeja: si en ese momento
    no habia chat abierto (entrar a la lista y tocar uno, o volver a la lista en el celular) no
    encontraban la conversacion y no volvian a intentarlo. La marca de "esta al final" se quedaba
    en "si" aunque la asesora subiera, y al dibujarse los mensajes de arriba (crecen al acercarse a
    ellos) el observador de tamaño creia que seguia abajo y la bajaba: el salto que vio Emanuel. Por
    eso el contenedor se sigue aca, y los vigilantes se vuelven a conectar cada vez que aparece.
  */
  const [contenedorDeMensajes, setContenedorDeMensajes] = useState<HTMLDivElement | null>(null);
  const contenedorDeMensajesRef = useRef<HTMLDivElement | null>(null);
  // Sin lista de dependencias a proposito: el contenedor puede aparecer o irse en cualquier render.
  // No hay cadena infinita: solo se actualiza el estado cuando el elemento de verdad cambio.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (messagesScrollRef.current !== contenedorDeMensajesRef.current) {
      contenedorDeMensajesRef.current = messagesScrollRef.current;
      setContenedorDeMensajes(messagesScrollRef.current);
    }
  });

  // Track whether the user is near the bottom of the message list and only arm
  // older-history loading after the user actually scrolls upward.
  useEffect(() => {
    const container = contenedorDeMensajes;
    if (!container) return;
    const TOP_SCROLL_THRESHOLD_PX = 96;

    const actualizarBoton = (distancia: number) => {
      // El boton aparece cuando ya se subio lo suficiente como para perder de vista el final.
      // El margen es mas ancho que el de "estoy al fondo" para que no parpadee al desplazarse.
      const debeMostrarse = debeVerseElBotonDeBajar(distancia);
      if (debeMostrarse !== showJumpToBottomRef.current) {
        showJumpToBottomRef.current = debeMostrarse;
        setShowJumpToBottom(debeMostrarse);
      }
    };

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

      const distancia = distanciaAlFinal(el);
      distanciaAlFinalRef.current = distancia;
      if (estaPegadaAlFinal(distancia)) setUnreadCount(0);
      actualizarBoton(distancia);

      /*
        Quien dispara la carga es el observador de mas abajo, no un umbral de pixeles.

        Medir "estoy a menos de 96 px del tope" falla justo en el celular: con el impulso del dedo
        el scroll pasa de largo esa franja entre dos mediciones y no se dispara nada. Ademas
        llevaba dos banderas -"armado" y "ya consumido"- para no repetirse, y despues de la primera
        carga habia que apretar el boton a mano, que es lo que reporto Alex.
      */
    }

    // La rueda, el dedo o las teclas son de la asesora; el scroll solo puede ser del codigo.
    const alGesto = () => {
      ultimoGestoRef.current = Date.now();
    };
    const TECLAS_QUE_DESPLAZAN = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    const alTeclear = (evento: KeyboardEvent) => {
      if (TECLAS_QUE_DESPLAZAN.has(evento.key)) alGesto();
    };
    // Arrastrar la barra de desplazamiento: el clic cae en el propio contenedor, no en un mensaje.
    const alApretar = (evento: PointerEvent) => {
      if (evento.target === container) alGesto();
    };

    // Al conectarse se mide ya, sin esperar al primer scroll.
    distanciaAlFinalRef.current = distanciaAlFinal(container);
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", alGesto, { passive: true });
    container.addEventListener("touchmove", alGesto, { passive: true });
    container.addEventListener("keydown", alTeclear);
    container.addEventListener("pointerdown", alApretar);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", alGesto);
      container.removeEventListener("touchmove", alGesto);
      container.removeEventListener("keydown", alTeclear);
      container.removeEventListener("pointerdown", alApretar);
    };
  }, [contenedorDeMensajes]);

  /**
   * Al llegar arriba, trae los mensajes anteriores solo. UN solo camino (05-11-2026).
   *
   * Eran dos: un sensor invisible arriba de todo (IntersectionObserver) y este escucha del scroll,
   * "por si el sensor no avisa". Los dos pedian lo mismo y, cuando llegaba un mensaje nuevo y el
   * cursor del historial se perdia (ver cursorDelHistorial en chat-history-cache), se encadenaban
   * cargas repetidas y el chat brincaba. Queda el escucha del scroll, que es el que no falla: con el
   * impulso del dedo en el celular el scroll termina quieto arriba igual, y preguntar "estas a
   * menos de 300 px del tope?" es comparar dos numeros. El candado de "ya hay una carga en curso"
   * deja pasar una sola carga a la vez.
   *
   * Se respeta la ventana de silencio de despues de abrir el chat: ahi el scroll lo mueve el
   * codigo (el pin al fondo) y sin eso cada apertura pediria historial sin que nadie lo pida.
   */
  useEffect(() => {
    const contenedor = contenedorDeMensajes;
    if (!contenedor) {
      return;
    }

    const alDesplazar = () => {
      if (contenedor.scrollTop > 300) {
        return;
      }
      if (suppressHistoryLoadUntilRef.current > Date.now() || loadMoreHistoryInFlightRef.current) {
        return;
      }
      /*
        Primero el camino liviano, y la navegacion como ultimo recurso: pedir solo los mensajes y
        agregarlos arriba conservando la posicion. La navegacion (el servidor rearma la pagina
        entera) queda por si algun chat llega sin cursor, para no dejar el historial inalcanzable.
      */
      if (canLoadOlderMessagesRef.current) {
        void loadOlderMessagesRef.current();
        return;
      }
      const loadMoreHref = loadMoreHrefRef.current;
      if (loadMoreHref && messageScrollBehaviorRef.current === "preserve") {
        router.replace(loadMoreHref, { scroll: false });
      }
    };
    contenedor.addEventListener("scroll", alDesplazar, { passive: true });

    return () => {
      contenedor.removeEventListener("scroll", alDesplazar);
    };
    // Se rearma al cambiar de chat, al aparecer el contenedor y cuando el chat pasa a tener
    // historial para pedir.
  }, [contenedorDeMensajes, selectedConversationId, canLoadOlderMessages, router]);

  // Smart scroll: auto-scroll only when near bottom; count new messages when scrolled up.
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;

    const container = messagesScrollRef.current;
    const currentKey = selectedConversationScrollKey;
    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = currentKey;

    if (currentKey === "empty" || !container) return;

    const anterior = leerLlaveDelHilo(prevKey);
    const actual = leerLlaveDelHilo(currentKey);
    const restore = loadMoreHistoryRestoreRef.current;
    loadMoreHistoryRestoreRef.current = null;

    // Solo se restaura si lo que cambio fue lo de arriba: si mientras tanto entro un mensaje al
    // final, mantener la distancia al final la arrastraria hacia abajo.
    if (restore && restore.ultimoId === actual.ultimoId) {
      // Al cargar mensajes antiguos arriba, el contenido inferior no cambia, así que
      // mantener (scrollHeight - scrollTop) constante conserva la vista exacta. Como ya
      // no hay virtualización, la altura es real: basta fijar antes del paint (este
      // useLayoutEffect) + un par de frames por si algún media termina de cargar.
      const distanceFromBottom = Math.max(0, restore.scrollHeight - restore.scrollTop);
      const fijadoEn = Date.now();
      const pinScroll = () => {
        const el = messagesScrollRef.current;
        if (!el) return;
        // Si en el medio la asesora volvio a mover la rueda o el dedo, su posicion manda.
        if (ultimoGestoRef.current > fijadoEn) return;
        el.scrollTop = Math.max(0, el.scrollHeight - distanceFromBottom);
        // Quien acaba de pedir el historial esta leyendo hacia arriba, no esperando el
        // ultimo mensaje: se mide donde quedo de verdad. Sin esto, el observador de tamaño
        // creia que seguia abajo y devolvia la vista al final en cuanto una foto del
        // historial terminaba de cargar.
        lastScrollTopRef.current = el.scrollTop;
        distanciaAlFinalRef.current = distanciaAlFinal(el);
      };
      pinScroll();
      window.requestAnimationFrame(pinScroll);
      historyRestoreGuardUntilRef.current = Math.max(
        historyRestoreGuardUntilRef.current,
        Date.now() + 1200,
      );
      return;
    }

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      const programadoEn = Date.now();

      // En salto inmediato (no-smooth) fijamos el scroll YA, dentro de este useLayoutEffect
      // (antes del paint), para que no se vea un frame "arriba" antes del rAF. El rAF queda
      // como re-anclaje por si la altura cambia (media que termina de cargar, etc.).
      if (!smooth) {
        container.scrollTop = container.scrollHeight;
        distanciaAlFinalRef.current = 0;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          scrollFrameRef.current = null;
          // La bajada pendiente se cancela si en estos dos cuadros la asesora empezo a subir.
          if (ultimoGestoRef.current > programadoEn) return;
          if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }

          distanciaAlFinalRef.current = 0;
          setUnreadCount(0);
        });
      });
    };

    if (!prevKey || prevKey === "empty") {
      // Initial load — jump to bottom without animation.
      if (debeBajarAlFinal({ tipo: "abrir" })) jumpToBottom(false);
      return;
    }

    if (anterior.chatId !== actual.chatId) {
      // Different conversation opened — always jump to bottom.
      if (debeBajarAlFinal({ tipo: "abrir" })) jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = anterior.cantidad;
    const curCount = actual.cantidad;
    const added = curCount - prevCount;

    // First messages arriving (0 → N), or the lightweight preview (usually 1 message) turning
    // into the real chat: it is still the opening, use a hard jump.
    if (added > 0 && prevCount <= 1) {
      jumpToBottom(false);
      return;
    }

    if (anterior.ultimoId === actual.ultimoId || added < 0) {
      // No entro nada al final: el contenido cambio arriba o se rehizo (p. ej. al pasar de la
      // caché al detalle del servidor). Solo se la acompaña si estaba pegada al final; si subio,
      // no se toca nada.
      const enApertura = ventanaAperturaHastaRef.current > Date.now();
      if (
        debeBajarAlFinal({
          tipo: "crecio-contenido",
          distancia: distanciaAlFinalRef.current,
          asesoraSeMovio: ultimoGestoRef.current > aperturaEnRef.current && enApertura,
          enApertura,
        })
      ) {
        jumpToBottom(false);
      }
      return;
    }

    // Comportamiento estilo WhatsApp:
    // - Tu propio envío (burbuja optimista) → baja para verlo.
    // - Estás cerca del fondo (leyendo lo último) → baja natural al mensaje nuevo.
    // - Estás arriba en el historial → NO mueve el scroll; si es entrante, muestra
    //   "Ir al final" con el contador de nuevos.
    const lastMessage = renderedMessagesRef.current.at(-1);
    const lastMessageIsOwnDraft =
      typeof lastMessage?.id === "string" && lastMessage.id.startsWith("optimistic:");

    if (
      (lastMessageIsOwnDraft && debeBajarAlFinal({ tipo: "enviar" })) ||
      debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: distanciaAlFinalRef.current, asesoraSeMovio: false })
    ) {
      /*
        En la ventana de apertura, lo que trae el refresco (/live o la precarga con mensajes que la
        copia no tenia) entra de golpe: animado, la vista quedaba varios cuadros fuera del final
        justo al abrir. Fuera de la ventana, el mensaje nuevo baja animado como siempre.
      */
      jumpToBottom(!(suppressHistoryLoadUntilRef.current > Date.now()));
      return;
    }

    // Arriba en el historial: no se mueve NADA (un mensaje que entra abajo no corre lo que se esta
    // leyendo). Solo se cuentan los nuevos del cliente para el boton.
    const nuevos = contarNuevosAlFinal(anterior.ultimoId, renderedMessagesRef.current);
    if (nuevos > 0) {
      setUnreadCount((prev) => prev + nuevos);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  // Al ABRIR una conversación (cambia el id normalizado), fijamos el scroll al fondo de
  // forma agresiva en varios frames/timeouts. Así, aunque el contenido pase por las
  // transiciones caché → SSR → /live (que cambian la altura), el chat siempre queda en el
  // último mensaje y no se ve "subido". No interfiere con la llegada de mensajes nuevos
  // (eso lo maneja el efecto de arriba), porque solo corre cuando cambia la conversación.
  // Los reintentos se cancelan si la asesora ya movio la rueda o el dedo.
  const openedConversationIdRef = useRef("");
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const convId = renderedConversation ? extractConversationIdFromKey(renderedConversation.id) : "";
    if (!convId || convId === openedConversationIdRef.current) return;
    openedConversationIdRef.current = convId;
    // Bloquea la carga automática de historial durante la apertura (los pines de scroll
    // disparan el listener y, si no, anclarían la vista arriba).
    const abiertoEn = Date.now();
    aperturaEnRef.current = abiertoEn;
    suppressHistoryLoadUntilRef.current = abiertoEn + 700;
    ventanaAperturaHastaRef.current = abiertoEn + 700;

    const pinToBottom = (motivo: MotivoParaBajar) => {
      const el = messagesScrollRef.current;
      if (!el || !debeBajarAlFinal(motivo)) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      distanciaAlFinalRef.current = 0;
    };
    const reintentar = () =>
      pinToBottom({ tipo: "reintento-apertura", asesoraSeMovio: ultimoGestoRef.current > abiertoEn });

    pinToBottom({ tipo: "abrir" });
    const raf1 = window.requestAnimationFrame(() => {
      reintentar();
      window.requestAnimationFrame(reintentar);
    });
    const t1 = window.setTimeout(reintentar, 80);
    const t2 = window.setTimeout(reintentar, 250);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [renderedConversation, messageScrollBehavior]);

  // Cuando el contenido CRECE después del render (típicamente una imagen/media que termina
  // de cargar), si el usuario está pegado al fondo o el chat se acaba de abrir, volvemos a pegar
  // la vista abajo. Sin esto, los chats con foto/video quedan a media altura al abrir. Si subio,
  // nunca: ese crecimiento es de lo que se dibuja arriba mientras lee.
  useEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const container = contenedorDeMensajes;
    const content = container?.firstElementChild;
    if (!container || !content) return;

    let lastScrollHeight = container.scrollHeight;
    let lastClientHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const el = messagesScrollRef.current;
      if (!el) return;
      const grew = el.scrollHeight > lastScrollHeight + 1;
      /*
        Tambien cuando se ACHICA la ventana del chat (iPhone, 11-nov-2026: "se siente el brinco"):
        el aviso de la ultima llamada o el de cierre llegan con /live y se ponen ARRIBA de los
        mensajes. El area se achicaba ~52 px, el scroll quedaba igual y el ultimo mensaje quedaba
        medio tapado por la barra de escribir hasta que otra cosa la volvia a bajar: ese era el
        brinco. Se mira el contenedor, no solo el contenido.
      */
      const shrank = el.clientHeight < lastClientHeight - 1;
      lastScrollHeight = el.scrollHeight;
      lastClientHeight = el.clientHeight;
      if (!grew && !shrank) return;

      // El contenido crecio porque se pidieron mensajes ANTERIORES: ese crecimiento va
      // arriba, no abajo, y bajar al fondo seria taparle a la asesora lo que fue a buscar.
      if (
        historyRestoreGuardUntilRef.current > Date.now() ||
        loadMoreHistoryInFlightRef.current ||
        loadMoreHistoryRestoreRef.current
      ) {
        return;
      }

      const enApertura = ventanaAperturaHastaRef.current > Date.now();
      if (
        debeBajarAlFinal({
          tipo: "crecio-contenido",
          // La ultima medida del scroll es de ANTES de crecer: dice si estaba pegada al final.
          distancia: distanciaAlFinalRef.current,
          asesoraSeMovio: ultimoGestoRef.current > aperturaEnRef.current && enApertura,
          enApertura,
        })
      ) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
        distanciaAlFinalRef.current = 0;
      }
    });

    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [messageScrollBehavior, selectedConversationId, contenedorDeMensajes]);

  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    // Ir al final es una orden explicita: si quedaba una restauracion de historial pendiente se
    // descarta, porque volveria a anclar la vista arriba a mitad de camino.
    historyRestoreGuardUntilRef.current = 0;
    loadMoreHistoryRestoreRef.current = null;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    distanciaAlFinalRef.current = 0;
    const pedidoEn = Date.now();
    setUnreadCount(0);
    // Se esconde ya, sin esperar a que termine el desplazamiento suave: si no, el boton se
    // queda a la vista durante toda la bajada y parece que no respondio al toque.
    showJumpToBottomRef.current = false;
    setShowJumpToBottom(false);
    // Una foto que termina de cargar corre el final del chat hacia abajo y la bajada se queda a
    // media altura. Se reafirma un par de veces —y solo si en el camino nadie volvio a subir.
    const reafirmarFondo = () => {
      const el = messagesScrollRef.current;
      if (!el || ultimoGestoRef.current > pedidoEn) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      distanciaAlFinalRef.current = 0;
    };
    window.setTimeout(reafirmarFondo, 300);
    window.setTimeout(reafirmarFondo, 900);
  }, []);

  // overflow-clip: igual que la tarjeta del chat, la grilla no se puede correr de lado (T-314).
  return (
    <>
    <div
      className={`chat-inbox-grid flex h-full min-h-0 flex-1 flex-col gap-0 overflow-clip md:grid ${
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
        conversationItems={filasConEspera}
        selectedConversationId={selectedConversationId}
        searchAction={searchAction}
        selectedConnectionKey={selectedConnectionKey}
        searchQuery={searchQuery}
        busqueda={searchInputValue}
        alBuscar={handleSearchChange}
        alBorrarBusqueda={handleSearchClear}
        mensajesEncontrados={mensajesDeLaBusqueda}
        alAbrirDesdeElBuscador={abrirChatDesdeElBuscador}
        pastillasIniciales={pastillasIniciales}
        refBuscador={searchInputRef}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        assignedCounts={assignedCounts}
        enEspera={enEspera}
        numerosDeEspera={numerosDeEspera}
        isManager={isManager || veTodoElEquipo}
        filtros={filtrosDeLaUrl}
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
        onEnvioTerminado={handleEnvioTerminado}
        chatSignature={chatSignature}
        backHref={backHrefActual}
        composer={effectiveComposer}
        composerHiddenFields={composerHiddenFields}
        hasSettledConversation={hasSettledConversation}
        barraAnticipada={barraAnticipada}
        contactIdDeLaFila={filaDelChatAbierto?.contactId ?? null}
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
        onEditMessage={handleEditMessage}
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

    <EditarMensajeDialog
      mensaje={messageToEdit}
      alCerrar={() => setMessageToEdit(null)}
      alGuardar={handleSaveEditedMessage}
    />

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



