import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendUnifiedChatReplyAction, toggleConversationAutomationAction, toggleOfficialApiConversationAutomationAction } from "@/app/actions/chats-actions";
import { sendChatAudioReplyAction, sendChatMediaReplyAction } from "@/app/actions/agent-actions";
import { AssignChatControl } from "@/components/chats/assign-chat-control";
import { BarraDeAccionesDelChat, ChatHeaderActions } from "@/components/chats/chat-header-actions";
import type { CrmStage } from "@/features/crm/types";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { ChatsRealtimeSync } from "@/components/chats/chats-realtime-sync";
import { ChatsEvolutionApiRealtime } from "@/components/chats/chats-evolution-api-realtime";
import { PushSubscriptionManager } from "@/components/chats/push-subscription-manager";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import type { MensajeFijado } from "@/lib/chats/mensaje-fijado";
import { MenuDelContacto } from "@/components/chats/menu-del-contacto";
import { leerChatsFijados } from "@/lib/chats-fijados";
import { leerListasGuardadas, leerPreferenciaDePastillas } from "@/features/chats/services/pastillas-de-la-persona";
import { SharedInbox } from "@/components/chats/shared-inbox";
import type { AssignedFilter } from "@/components/chats/chat-inbox-types";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import {
  extractEvolutionMessageText,
  extractEvolutionPushName,
} from "@/lib/evolution-webhook";
import { getOfficialApiChatsData } from "@/features/official-api/services/getOfficialApiChatsData";
import { readGatewayConnection } from "@/lib/evolution";
import { getEvolutionSettings } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";
import {
  sqlPayloadDeMensajes,
  sqlUltimoMensajeDeChats,
  type FilaUltimoMensaje,
} from "@/lib/ultimo-mensaje-de-chats";
import { Prisma } from "@prisma/client";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds, resolverConexionElegida } from "@/lib/channel-visibility";
import { canalesQueMonitorea, enmascararSiEsTelefono, enmascararTelefono } from "@/lib/modo-monitoreo";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { chatKeyPorConversacion, puedeAbrirChatPorClave } from "@/lib/chats-acceso-por-enlace";
import {
  idsParaLosFiltros,
  leerFiltrosDeBandeja,
  paramsDeFiltros,
  whereDeFiltros,
} from "@/features/chats/services/filtros-de-bandeja";
import { DIAS_DE_SIN_RESPONDER, SIN_FILTROS, leerEspera } from "@/features/chats/domain/filtros-de-bandeja";
import {
  listaDeEsperaDeLaBandeja,
  ordenarSegunEspera,
  paginaDeEspera,
  vistaInicialDeLaBandeja,
  type QuienMira,
} from "@/features/chats/services/espera-de-chats";
import { isSnoozed } from "@/lib/lead-snooze";
import { debeMarcarseFueraDeLaVista } from "@/features/chats/domain/chat-abierto-fuera-de-la-vista";
import { estadoQueAplica, hayBusqueda, whereDeBusquedaDeChats } from "@/lib/busqueda-de-chats";
import { syncLeadLifecycleForContacts } from "@/lib/contact-default-tags";
import { tieneCierrePendiente } from "@/lib/crm-stage-sync";
import { whereEsMio } from "@/lib/chats-asignacion-compartida";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const CHAT_MESSAGE_MAX_BATCHES = 5;
const CHAT_MESSAGE_SCROLL_PRESERVE_QUERY = "preserve";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type UnifiedConversation = {
  key: string;
  source: "agent" | "official";
  conversationId: string;
  agentId?: string;
  channelId?: string;
  label: string;
  secondaryLabel: string;
  contactId?: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  // Etapa del CRM del contacto: alimenta la pastilla (Frío/Tibio/Caliente) de la fila de la lista.
  crmStage?: string | null;
  incomingCount?: number | null;
  assignedToName?: string | null;
  // Para la barra del chat al tocar la fila (ver SharedInboxConversationItem). Misma consulta.
  assignedToUserId?: string | null;
  automationPaused?: boolean | null;
  status?: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED" | null;
  /** El candado "No reasignar" (ISO y quien). Solo lo traen las filas del canal propio. */
  noReasignarAt?: string | null;
  noReasignarPor?: string | null;
  // El nombre de la linea (Ventas 1, Admin...). Lo traia solo la recarga de /list, asi que la
  // lista abria sin linea y "al rato aparecia" (Alex, 02-10-2026).
  channelName?: string | null;
  lastMessage: string | null;
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "CONTACTS" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  /** Desde cuando el cliente espera respuesta. Null = ya contestado. */
  sinResponderDesde?: Date | null;
  lastMessageStatus?: string | null;
  lastMessageAt?: Date | null;
  // El chat abierto que no cumple el filtro (ver features/chats/domain/chat-abierto-fuera-de-la-vista).
  fueraDeLaVista?: boolean;
  activeProductContext?: ActiveProductContextSummary | null;
};

type ActiveProductContextSummary = {
  productName?: string | null;
};

function toActiveProductContextSummary(input: unknown): ActiveProductContextSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as { productName?: unknown };
  const productName = typeof value.productName === "string" ? value.productName.trim() : "";
  if (!productName) {
    return null;
  }

  return { productName };
}

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getConversationContextTags(input: ActiveProductContextSummary | null | undefined) {
  const productName = input?.productName?.trim();
  if (!productName) {
    return [];
  }

  return [{
    label: productName,
    color: "#2563eb",
  }];
}

function mergeConversationTags(
  baseTags: Array<{
    label: string;
    color: string;
  }>,
  extraTags: Array<{
    label: string;
    color: string;
  }>,
) {
  const merged: Array<{
    label: string;
    color: string;
  }> = [];
  const seen = new Set<string>();

  for (const tag of [...baseTags, ...extraTags]) {
    const label = tag.label.trim();
    if (!label) {
      continue;
    }

    const key = `${label.toLowerCase()}::${tag.color.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      label,
      color: tag.color,
    });
  }

  return merged;
}

function getConversationPreviewLabel(type?: UnifiedConversation["lastMessageType"] | null) {
  if (type === "AUDIO") return "Audio";
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video";
  if (type === "STICKER") return "Sticker";
  if (type === "DOCUMENT") return "Documento";
  return "";
}

function resolveStoredAgentMessagePreview(input: {
  content: string | null;
  deletedAt: Date | null;
  rawPayload: unknown;
}) {
  if (input.deletedAt) {
    return "Mensaje eliminado";
  }

  return input.content?.trim() || extractEvolutionMessageText(input.rawPayload) || null;
}

function resolveStoredAgentContactLabel(input: {
  contactName: string | null;
  phoneNumber: string;
  rawPayload: unknown;
}) {
  return input.contactName?.trim() || extractEvolutionPushName(input.rawPayload)?.trim() || input.phoneNumber;
}

function parseChatKey(input: string): { source: "agent" | "official"; conversationId: string } | null {
  if (!input) return null;
  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");
  if (source === "agent" && conversationId) {
    return { source, conversationId };
  }
  if (source === "official" && conversationId) {
    return { source, conversationId };
  }
  return null;
}

function parsePositiveInteger(value: string | undefined, fallback = 1) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampMessagePage(value: number) {
  return Math.min(value, CHAT_MESSAGE_MAX_BATCHES);
}

export default async function ClienteChatsPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const params = await searchParams;
  const chatKeyDeLaUrl = typeof params.chatKey === "string" ? params.chatKey : "";
  /*
    Enlace directo /cliente/chats?conversacion=<id>: se busca el id (primero WhatsApp normal y
    despues la API oficial, dentro de este negocio) y se arma la misma clave de ?chatKey=. El
    permiso se revisa mas abajo con la MISMA regla; si el id no existe da "" y es la bandeja normal.
  */
  const conversacionDeLaUrl =
    !chatKeyDeLaUrl && typeof params.conversacion === "string" ? params.conversacion.trim() : "";

  /*
    Lo que solo depende de quien mira y del negocio sale JUNTO, no en fila: cada consulta en fila
    se pagaba antes de pintar la pagina (y en cada refresh). Son las mismas consultas de siempre.

    - Supervisora: solo se pregunta si no es dueño ni administrador, como antes.
    - La firma va al compositor para que se VEA y se pueda borrar antes de enviar. Antes se pegaba
      en el servidor: la asesora no la veia y no habia forma de sacarla cuando no correspondia.
    - Modo monitoreo: mira todos los chats del canal y no puede escribir (ver modo-monitoreo.ts).
      Cambia tres cosas de esta pantalla: que conversaciones entran, si se dibuja el cuadro de
      escribir, y si los telefonos salen tapados.
    - Canales que esta persona puede ver (ver channel-visibility): la linea administrativa no la
      tiene que ver ninguna asesora, ni la conexion en la lista ni sus chats mezclados en "Todas".
      Usa isOwner/ADMIN del acceso, no isManager, asi que no espera a la supervisora.
    - Los chats que quien mira fijo arriba de su bandeja (hasta 3, como WhatsApp).
  */
  const [esSupervisoraDelNegocio, usuarioConFirma, canalesMonitoreados, canalesVisibles, chatsFijados, chatKeyPorEnlaceDirecto, pastillasIniciales] =
    await Promise.all([
      membership.role === "OWNER" || membership.role === "ADMIN"
        ? Promise.resolve(false)
        : esSupervisora(membership.workspace.id, access.userId),
      prisma.user.findUnique({
        where: { id: access.userId },
        select: { chatSignature: true },
      }),
      canalesQueMonitorea({
        workspaceId: membership.workspace.id,
        userId: access.userId,
      }),
      getVisibleChannelIds({
        workspaceId: membership.workspace.id,
        userId: access.userId,
        esJefe: access.isOwner || access.role === "ADMIN",
      }),
      leerChatsFijados(access.userId),
      conversacionDeLaUrl
        ? chatKeyPorConversacion({
            workspaceId: membership.workspace.id,
            conversationId: conversacionDeLaUrl,
          }).then((clave) => clave ?? "")
        : Promise.resolve(""),
      /*
        Las listas y el orden de la fila de pastillas de quien mira (dos renglones de AppSetting): con
        la pagina, asi la fila sale completa desde el primer pintado (lista sin brincos, 10-11-2026).
        Si fallan, la barra las pide sola como antes.
      */
      leerListasGuardadas(access.userId)
        .then(async (listas) => ({
          listas,
          preferencia: await leerPreferenciaDePastillas(access.userId, listas.map((lista) => lista.id)),
        }))
        .catch(() => null),
    ]);
  const chatKeySolicitada = chatKeyDeLaUrl || chatKeyPorEnlaceDirecto;
  const selectedConnectionParam = typeof params.connection === "string" ? params.connection : "";
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const leerParametro = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string) : null);
  /*
    "Esperando" (espera=1): la primera lista sale del MISMO servicio y en el MISMO orden que
    /api/cliente/chats/list?espera=1. Con texto en el buscador la busqueda manda, igual que alla.
    Los enlaces de la pagina conservan `espera=1` siempre que venga en la direccion.
  */
  const pideEspera = leerEspera(leerParametro);
  const esperaEnLaLista = pideEspera && !searchQuery;

  // La supervisora ve "Todas" y asigna como el jefe, pero sigue viendo solo sus lineas (canalesVisibles).
  const isManager = membership.role === "OWNER" || membership.role === "ADMIN" || esSupervisoraDelNegocio;

  const chatSignature = usuarioConFirma?.chatSignature?.trim() ?? "";
  /**
   * Por defecto, LO MIO.
   *
   * Antes abria en "Todas": una asesora entraba a 1.800 conversaciones y tenia que filtrar a mano
   * para encontrar las suyas, todos los dias. Ver el trabajo propio primero es lo que uno espera
   * al abrir una bandeja; "Todas" sigue a un toque de distancia.
   */
  const modoMonitoreo = canalesMonitoreados.length > 0;

  /*
    Por defecto, TODAS (Alex, 15-sep-2026).

    Se habia puesto "Mias" para que una asesora no entrara a 1.800 conversaciones, pero para quien
    mira el negocio -dueño, administrador o supervisora- abrir en "Mias" esconde lo que entra a los
    chats de las demas, que es justo lo que quiere ver al abrir. A quien no puede ver "Todas" le
    sigue quedando "Mias": se lo impone el permiso, unas lineas mas abajo.
  */
  const assignedParam = typeof params.assigned === "string" ? params.assigned.trim() : "";
  /*
    `user:<id>` = la bandeja de UNA asesora ("Por asesora" en Filtrar conversaciones).

    El modal y la ruta /list ya lo entendian, pero aca se descartaba en silencio y quedaba "Todas":
    se elegia a Maria Bautista y la lista no cambiaba (Alex, 30-09-2026). Y como esta pantalla es
    la que le pasa el filtro a la bandeja, el refresco y el scroll tambien pedian "Todas".
    Para jefes y para quien monitorea (Alex, 30-09-2026): a una asesora comun se le impone "Mias"
    justo abajo, igual que en /list. La monitora igual queda dentro de SUS lineas: ver assignedWhere.
  */
  // Una o varias, separadas por coma: `user:id1,id2` (Alex, 30-09-2026, "poder seleccionar mas asesoras").
  const pideUnaAsesora = (isManager || modoMonitoreo) && /^user:[a-z0-9]+(,[a-z0-9]+)*$/i.test(assignedParam);
  let assignedFilter: AssignedFilter =
    assignedParam === "mine" || assignedParam === "unassigned" || pideUnaAsesora
      ? (assignedParam as AssignedFilter)
      : "all";
  // Los no-managers (empleados) solo pueden ver sus chats asignados: nunca "Todos" ni "Sin asignar".
  if (!isManager && !modoMonitoreo) {
    assignedFilter = "mine";
  }
  const filtroDeAsignacion: Prisma.ConversationWhereInput =
    assignedFilter === "mine"
      ? whereEsMio(access.userId)
      : assignedFilter === "unassigned"
        ? { assignedToUserId: null }
        : assignedFilter.startsWith("user:")
          ? { assignedToUserId: { in: assignedFilter.slice("user:".length).split(",") } }
          : {};
  /*
    Quien monitorea ve lo de SU canal, tenga dueño o no, y ahora ademas puede filtrarlo.

    Antes la pestaña se ignoraba para ella -"Mias" y "Todas" le mostraban lo mismo- y la bandeja
    solo le ofrecia "Mias". Alex pidio que tenga "Todas" y el filtro por asesora (30-09-2026): se
    aplica la pestaña, pero siempre DENTRO de sus lineas, para que no vea otras.
  */
  const assignedWhere: Prisma.ConversationWhereInput =
    modoMonitoreo && !isManager
      ? { channelId: { in: canalesMonitoreados }, ...filtroDeAsignacion }
      : filtroDeAsignacion;

  /**
   * Los filtros nuevos (etapa del embudo y "sin responder").
   *
   * Se leen aca pero se aplican en cuatro consultas distintas, por eso el criterio vive en un
   * modulo aparte: la lista mezcla dos fuentes y se refresca contra otras dos rutas, y un filtro
   * que se olvide en una de ellas deja pasar esa fuente entera, sin error ni aviso.
   */
  const filtros = leerFiltrosDeBandeja((clave) =>
    typeof params[clave] === "string" ? (params[clave] as string) : "",
  );
  const messagePage = clampMessagePage(parsePositiveInteger(typeof params.messagePage === "string" ? params.messagePage : undefined, 1));
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const scrollMode = typeof params.scroll === "string" ? params.scroll : "";

  const chatSolicitado = parseChatKey(chatKeySolicitada);

  /*
    Abrir por enlace (?chatKey=) aplica las MISMAS reglas que la lista: linea visible, asesora
    dueña del chat y modo monitoreo (ver lib/chats-acceso-por-enlace). Sin permiso se hace de
    cuenta que el enlace no traia chat: bandeja normal, sin error y sin datos de ese chat. Todo lo
    de abajo (carga, marcar leidos, panel) parte de estas dos variables y no de lo que trae la URL.

    La conexion elegida se valida contra ESTE negocio antes de filtrar por ella: una que quedo
    guardada de otro workspace vaciaba la bandeja entera sin decir por que. Las dos dependen solo
    de los canales visibles, asi que salen juntas.
  */
  const [puedeAbrirSolicitado, conexionElegida] = await Promise.all([
    chatSolicitado !== null
      ? puedeAbrirChatPorClave({
          workspaceId: membership.workspace.id,
          userId: access.userId,
          fuente: chatSolicitado.source,
          conversationId: chatSolicitado.conversationId,
          esJefe: isManager,
          canalesVisibles,
          canalesMonitoreados,
        })
      : Promise.resolve(false),
    resolverConexionElegida({
      workspaceId: membership.workspace.id,
      connectionKey: selectedConnectionParam,
      visibleChannelIds: canalesVisibles,
    }),
  ]);
  const selectedChatRef = puedeAbrirSolicitado ? chatSolicitado : null;
  const selectedChatKeyParam = puedeAbrirSolicitado ? chatKeySolicitada : "";
  const conversationListTake = searchQuery || selectedChatRef ? 40 : 20;
  const abrePorConversacion = puedeAbrirSolicitado && Boolean(chatKeyPorEnlaceDirecto);

  // Filtro de estado de conversación. Por DEFECTO se ocultan las resueltas (solo abiertas):
  // las resueltas solo aparecen al elegir "Resueltas" o "Todas".
  const statusParam = typeof params.status === "string" ? params.status.trim() : "";
  // Con ?conversacion= y permiso, "all": el chat se ve aunque este cerrado, y los enlaces de la
  // pagina (selectedChatHref, la lista) llevan status=all para que no se cierre al refrescar.
  const statusFilter: "all" | "open" | "resolved" = abrePorConversacion
    ? "all"
    : statusParam === "all" || statusParam === "resolved"
      ? statusParam
      : "open";
  // Con texto en el buscador el estado no filtra, igual que /api/cliente/chats/list (ver
  // estadoQueAplica en lib/busqueda-de-chats). La pestaña elegida (statusFilter) no cambia.
  const estadoAplicado = estadoQueAplica(statusFilter, searchQuery);
  const statusWhere: Prisma.ConversationWhereInput =
    estadoAplicado === "resolved"
      ? { status: { in: ["CLOSED", "ARCHIVED"] } }
      : estadoAplicado === "all"
        ? {}
        : { status: { in: ["OPEN", "PENDING"] } };

  /*
    Quien mira la espera: lo MISMO que responderEsperando en /api/cliente/chats/list (y /counts),
    para que la primera lista, el numero y el scroll coincidan. La monitora (que no es jefa ni
    supervisora) ve sus lineas; la asesora, solo sus chats; los jefes, las lineas que tienen visibles.
  */
  const monitoreadosDeLaEspera = isManager ? [] : canalesMonitoreados;
  const quienMiraLaEspera: Omit<QuienMira, "canalElegido" | "incluirOficial"> =
    monitoreadosDeLaEspera.length > 0
      ? {
          userId: access.userId,
          canales: canalesVisibles
            ? monitoreadosDeLaEspera.filter((id) => canalesVisibles.includes(id))
            : monitoreadosDeLaEspera,
          soloMios: false,
        }
      : { userId: access.userId, canales: canalesVisibles, soloMios: !isManager };
  const leerListaDeEspera = (asignacion: string) =>
    listaDeEsperaDeLaBandeja({
      workspaceId: membership.workspace.id,
      conexionElegida,
      quien: quienMiraLaEspera,
      asignacion,
    });

  /*
    LA APERTURA (vista inicial, parte 2). Sin nada en la direccion, la asesora con chats suyos
    esperando entra a "Mias + Esperando" con un redirect: la direccion es la verdad, y atras/adelante
    y recargar funcionan. Dueño, administrador, supervisora y monitora abren en Todas sin leer la
    espera. Si la lectura falla, Mias como siempre, sin error. Tocar Mias deja `assigned=mine` en la
    direccion, y con eso ya no se redirige.
  */
  const veTodasLaBandeja = isManager || modoMonitoreo;
  if (!veTodasLaBandeja && vistaInicialDeLaBandeja({ leer: leerParametro, veTodas: false, esperandoMios: null }).origen === "defecto") {
    let esperandoMios: number | null = null;
    try {
      esperandoMios = (await leerListaDeEspera("mine")).length;
    } catch (error) {
      console.error("[cliente/chats] no se pudo leer la espera al abrir", error);
    }
    const vistaInicial = vistaInicialDeLaBandeja({ leer: leerParametro, veTodas: false, esperandoMios });
    if (vistaInicial.origen === "defecto" && vistaInicial.espera) {
      redirect(
        `/cliente/chats?${new URLSearchParams([
          ...(selectedConnectionParam.trim() ? [["connection", selectedConnectionParam.trim()]] : []),
          ["assigned", "mine"],
          ["espera", "1"],
        ]).toString()}`,
      );
    }
  }

  /*
    La primera pagina de "Esperando", paginada sobre la lista de esperas como /list (offset sobre
    ESA lista, no sobre la base). Si la espera no se puede leer, la direccion vuelve a la misma
    pestaña sin `espera` (como hace la bandeja cuando /list responde esperaNoDisponible).
  */
  let paginaDeEsperando: { claves: string[]; hasMore: boolean; nextOffset: number } | null = null;
  let esperaNoDisponible = false;
  if (esperaEnLaLista) {
    try {
      const { pagina, hasMore, nextOffset } = paginaDeEspera(
        await leerListaDeEspera(assignedFilter),
        0,
        conversationListTake,
      );
      paginaDeEsperando = { claves: pagina.map((chat) => chat.key), hasMore, nextOffset };
    } catch (error) {
      console.error("[cliente/chats] no se pudo leer la espera", error);
      esperaNoDisponible = true;
    }
  }
  if (esperaNoDisponible) {
    const sinEspera = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
      if (clave !== "espera" && typeof valor === "string") sinEspera.set(clave, valor);
    }
    const qs = sinEspera.toString();
    redirect(qs ? `/cliente/chats?${qs}` : "/cliente/chats");
  }
  const idsEsperandoDe = (prefijo: string) =>
    (paginaDeEsperando?.claves ?? [])
      .filter((clave) => clave.startsWith(prefijo))
      .map((clave) => clave.slice(prefijo.length));
  // En "Esperando" no cuentan condiciones ni estado: solo abiertos o pendientes (igual que /list).
  const filtrosDeLaLista = paginaDeEsperando ? SIN_FILTROS : filtros;

  /**
   * Las que quedaron sin responder y las no leidas, cuando esos filtros estan puestos.
   *
   * Se piden una vez y entran como listas de ids: es lo mismo que mira el contador y lo que
   * devuelve el scroll infinito, asi que los tres coinciden.
   */
  const idsDeLosFiltros = await idsParaLosFiltros(filtrosDeLaLista, {
    workspaceId: membership.workspace.id,
    visibleChannelIds: canalesVisibles,
    channelId: conexionElegida.startsWith("channel:")
      ? conexionElegida.slice("channel:".length)
      : null,
  });

  const conversationWhere: Prisma.ConversationWhereInput = paginaDeEsperando
    ? {
        // "Esperando": solo los chats de la pagina, con los mismos permisos de siempre.
        workspaceId: membership.workspace.id,
        AND: [
          { id: { in: idsEsperandoDe("agent:") } },
          { contact: { bloqueadoEn: null } },
          canalesVisibles ? { channelId: { in: canalesVisibles } } : {},
          conexionElegida.startsWith("channel:")
            ? { channelId: conexionElegida.slice("channel:".length) }
            : {},
          assignedWhere,
          { status: { in: ["OPEN", "PENDING"] } },
        ],
      }
    : {
        workspaceId: membership.workspace.id,
        AND: [
          // Las condiciones del filtro (todas: Y). Ver features/chats/services/filtros-de-bandeja.
          whereDeFiltros(filtros, idsDeLosFiltros),
          // Los contactos bloqueados no aparecen en la bandeja (ver lib/bloqueo-de-contactos).
          { contact: { bloqueadoEn: null } },
          canalesVisibles ? { channelId: { in: canalesVisibles } } : {},
          conexionElegida.startsWith("channel:")
            ? { channelId: conexionElegida.slice("channel:".length) }
            : {},
          assignedWhere,
          statusWhere,
          // La misma busqueda que /api/cliente/chats/list: nombre y numero. Los chats que coinciden
          // por el texto de un mensaje los agrega la bandeja despues (ver lib/busqueda-de-chats).
          whereDeBusquedaDeChats(searchQuery, new Date(), "nombreYNumero"),
        ],
      };

  /*
    Lo que se lee de cada chat de la lista. Lo usan la primera tanda y los fijados que no entraron en
    ella (abajo): asi un fijado viejo sale con la pagina y no se mete arriba segundos despues.
  */
  const seleccionDeLaFila = {
    id: true,
    agentId: true,
    channelId: true,
    automationPaused: true,
    status: true,
    assignedToUserId: true,
    assignedTo: { select: { id: true, name: true, email: true } },
    segundoAsesorId: true,
    segundoAsesor: { select: { id: true, name: true } },
    // El candado "No reasignar": con crmStage (abajo) alcanza para saber si sigue vigente.
    noReasignarAt: true,
    noReasignarPor: true,
    activeProductContext: true,
    contact: {
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        avatarUrl: true,
        crmStage: true,
        // Para saber si el lead esta pospuesto y no mostrarlo en la bandeja.
        metadata: true,
      },
    },
  } satisfies Prisma.ConversationSelect;
  /*
    Los fijados del canal viejo que no vengan en la primera tanda (lista sin brincos, 10-11-2026): se
    piden A LA VEZ, con el MISMO filtro (si no lo cumplen no salen, igual que en /list?ids=). Antes los
    pedia la bandeja al montar (3,6 s medido) y empujaban toda la lista hacia abajo al llegar.
    En "Esperando" y buscando no: ahi la bandeja los pide como siempre.
  */
  const idsDeFijadosDelCanalViejo =
    paginaDeEsperando || searchQuery
      ? []
      : chatsFijados.filter((clave) => clave.startsWith("agent:")).map((clave) => clave.slice("agent:".length));

  const [
    evolutionSettings,
    channels,
    agentConversationsRaw,
    selectedAgentConversationRow,
    officialChatsData,
    fijadosFueraDeLaTanda,
    chatAbiertoEnElFiltro,
  ] = await Promise.all([
    getEvolutionSettings(),
    prisma.whatsAppChannel.findMany({
      where: {
        workspaceId: membership.workspace.id,
        ...(canalesVisibles ? { id: { in: canalesVisibles } } : {}),
      },
      select: {
        id: true,
        name: true,
        provider: true,
        phoneNumber: true,
        status: true,
        evolutionInstanceName: true,
        // Para saber si el canal es Evolution API (metadata.gateway) y, en ese caso,
        // conectar su realtime propio.
        metadata: true,
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.conversation.findMany({
      where: conversationWhere,
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: conversationListTake + 1,
      select: seleccionDeLaFila,
    }),
    // El chat seleccionado se carga TAMBIEN por su id, aparte de la lista. Sin esto, un deep-link
    // (p.ej. desde "Mi día") a un chat que NO esta en los ultimos 40 caia en "Selecciona un chat":
    // selectedAgentConversation se buscaba solo dentro de la lista cargada. Los links de Mi día
    // apuntan a leads viejos (dias sin actividad) que casi nunca estan en ese lote.
    selectedChatRef?.source === "agent"
      ? prisma.conversation.findFirst({
          where: { id: selectedChatRef.conversationId, workspaceId: membership.workspace.id },
          select: {
            id: true,
            agentId: true,
            channelId: true,
            automationPaused: true,
            status: true,
            assignedToUserId: true,
            assignedTo: { select: { id: true, name: true, email: true } },
            segundoAsesorId: true,
            segundoAsesor: { select: { id: true, name: true } },
            noReasignarAt: true,
            noReasignarPor: true,
            activeProductContext: true,
            contact: {
              // metadata: para saber si esta pospuesto, con la misma regla que la lista.
              select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true, metadata: true },
            },
          },
        })
      : Promise.resolve(null),
    getOfficialApiChatsData({
      workspaceId: membership.workspace.id,
      conversationId: selectedChatRef?.source === "official" ? selectedChatRef.conversationId : undefined,
      q: searchQuery || undefined,
      includeSelectedConversation: true,
      // Respeta el filtro de la bandeja: resolver un chat oficial ahora lo saca de la lista.
      statusFilter: paginaDeEsperando ? "open" : statusFilter,
      // Y el de asignacion. Sin esto los chats del canal oficial entraban en la lista con
      // CUALQUIER pestaña: se leia "Mias 1" y abajo salian los de Ingrid y los sin asignar.
      assignedFilter,
      // Y los nuevos (etapa del embudo, sin responder), por lo mismo.
      filtros: filtrosDeLaLista,
      currentUserId: access.userId,
      // "Esperando": solo los de la pagina (una lista vacia no trae ninguno).
      ...(paginaDeEsperando ? { soloIds: idsEsperandoDe("official:") } : {}),
    }),
    idsDeFijadosDelCanalViejo.length > 0
      ? prisma.conversation.findMany({
          where: { AND: [conversationWhere, { id: { in: idsDeFijadosDelCanalViejo } }] },
          select: seleccionDeLaFila,
        })
      : Promise.resolve([]),
    // ¿El chat abierto cumple el filtro de la lista? El MISMO where de la tanda, mas su id. Solo con
    // chat abierto del canal viejo: sin el, ninguna consulta de mas.
    selectedChatRef?.source === "agent"
      ? prisma.conversation.count({
          where: { AND: [conversationWhere, { id: selectedChatRef.conversationId }] },
        })
      : Promise.resolve(0),
  ]);

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const evolutionInstanceNames = Array.from(
    new Set(
      channels
        .filter((channel) => channel.provider === "EVOLUTION" && channel.evolutionInstanceName?.trim())
        .map((channel) => channel.evolutionInstanceName!.trim()),
    ),
  );

  // Excluir conversaciones cuyo canal fue eliminado
  /**
   * Un lead pospuesto tampoco aparece en la bandeja.
   *
   * Si solo se iba de "Mi dia" pero seguia en Chats, posponer no servia de nada: la asesora lo
   * volvia a ver igual en la lista que mira todo el dia. Vuelve cuando se cumple el plazo o
   * cuando el cliente escribe (ahi el webhook lo despierta).
   *
   * Se filtra despues de consultar y no en el WHERE: la fecha vive dentro del metadata y armar
   * ese filtro en la consulta es fragil. Como mucho la pagina trae unas filas menos.
   */
  // Cuantas filas se consumieron de la base. El +1 solo sirve para saber si quedan mas, y eso se
  // decide ANTES de sacar los pospuestos —nunca despues—: al reves alcanzaba UN solo lead
  // pospuesto en el lote para que la lista dijera "no hay mas" y dejara de cargar al hacer
  // scroll, con miles de chats abajo que nunca se podian ver.
  const agentConversationsConsumidas = agentConversationsRaw.slice(0, conversationListTake);
  // En "Esperando" se pagina sobre la lista de esperas (como /list), no sobre la base.
  const hasMoreConversationItems = paginaDeEsperando
    ? paginaDeEsperando.hasMore
    : agentConversationsRaw.length > conversationListTake;
  // Buscando, los pospuestos si salen (lo mismo que la ruta de la lista).
  const agentConversationsBase = hayBusqueda(searchQuery)
    ? agentConversationsConsumidas
    : agentConversationsConsumidas.filter((conversation) => !isSnoozed(conversation.contact?.metadata));
  // Los fijados que no vinieron en la tanda (ver idsDeFijadosDelCanalViejo) van con la pagina; la
  // lista los dibuja arriba. No cuentan para el offset: la tanda sigue siendo la misma.
  const idsDeLaTanda = new Set(agentConversationsBase.map((conversation) => conversation.id));
  const agentConversationsConFijados = [
    ...agentConversationsBase,
    ...fijadosFueraDeLaTanda.filter(
      (conversation) => !idsDeLaTanda.has(conversation.id) && !isSnoozed(conversation.contact?.metadata),
    ),
  ];
  // Si el chat seleccionado (deep-link) no vino en el lote de la lista, lo agregamos para que el
  // panel lo abra. Va primero para que quede visible arriba al aterrizar desde Mi día.
  const chatAbiertoVinoEnLaTanda = selectedAgentConversationRow
    ? agentConversationsConFijados.some((conversation) => conversation.id === selectedAgentConversationRow.id)
    : false;
  const agentConversations =
    selectedAgentConversationRow && !chatAbiertoVinoEnLaTanda
      ? [selectedAgentConversationRow, ...agentConversationsConFijados]
      : agentConversationsConFijados;
  /*
    Si no vino en la tanda y NO cumple el filtro (el where de la lista, y no pospuesto salvo buscando,
    la misma regla de arriba), la fila se marca `fueraDeLaVista`: el panel la sigue abriendo, pero
    la lista no la debe contar. Antes la lista "Maria" con 0 mostraba un chat de otra asesora.
  */
  const idDelChatAbiertoFueraDeLaVista =
    selectedAgentConversationRow &&
    debeMarcarseFueraDeLaVista({
      vinoEnLaTanda: chatAbiertoVinoEnLaTanda,
      cumpleElFiltro:
        chatAbiertoEnElFiltro > 0 &&
        (hayBusqueda(searchQuery) || !isSnoozed(selectedAgentConversationRow.contact?.metadata)),
    })
      ? selectedAgentConversationRow.id
      : null;

  const activeAgentConversations = agentConversations.filter((conv) => {
    if (!conv.channelId) return true;
    return channelsById.has(conv.channelId);
  });

  const contactIds = Array.from(new Set(activeAgentConversations.map((conversation) => conversation.contact.id)));
  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
  const contactTagRowsPromise = contactIds.length
    ? prisma.$queryRaw<Array<{ contactId: string; name: string; color: string }>>`
        SELECT
          ct."contactId" AS "contactId",
          t."name" AS "name",
          t."color" AS "color"
        FROM "ContactTag" ct
        INNER JOIN "Tag" t ON t."id" = ct."tagId"
        WHERE ct."workspaceId" = ${membership.workspace.id}
          AND ct."contactId" IN (${Prisma.join(contactIds)})
        ORDER BY ct."createdAt" ASC
      `
    : Promise.resolve([] as Array<{ contactId: string; name: string; color: string }>);
  // Ver la misma optimizacion en /api/cliente/chats/list: NO traer rawPayload (payload completo de
  // WhatsApp, ~776 KB para 40 filas). Solo se usa de fallback (texto del preview / nombre de
  // WhatsApp); se pide aparte para las pocas filas que lo necesitan.
  // LATERAL ... LIMIT 1 por chat (ver lib/ultimo-mensaje-de-chats). Esta pagina nunca filtro los
  // mensajes de sistema en la vista previa: se mantiene igual.
  const latestAgentMessageRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<FilaUltimoMensaje[]>(
        sqlUltimoMensajeDeChats({
          workspaceId: membership.workspace.id,
          conversationIds: activeAgentConversationIds,
          ocultarSistemaSalvoLlamadas: false,
          diasSinResponder: DIAS_DE_SIN_RESPONDER,
        }),
      )
    : Promise.resolve([] as FilaUltimoMensaje[]);
  if (contactIds.length > 0) {
    after(async () => {
      try {
        /*
          La configuracion del negocio se lee aca adentro, despues de responder: solo la usa este
          etiquetado. Antes era una consulta mas antes de pintar la pagina.
        */
        const workspace = await prisma.workspace.findUnique({
          where: { id: membership.workspace.id },
          select: { businessConfig: true },
        });
        const businessConfig =
          workspace &&
          workspace.businessConfig !== null &&
          typeof workspace.businessConfig === "object" &&
          !Array.isArray(workspace.businessConfig)
            ? (workspace.businessConfig as { autoTagNewLeads?: unknown; newLeadTagName?: unknown })
            : null;
        // Sin configuracion, o con el etiquetado apagado, no se hace nada (como antes).
        if (businessConfig === null || businessConfig.autoTagNewLeads === false) {
          return;
        }
        const newLeadTagName =
          typeof businessConfig.newLeadTagName === "string" ? businessConfig.newLeadTagName.trim() : "";

        /*
          Solo importa SI el contacto tiene algun saliente, no cuantos: EXISTS se detiene en el
          primero. Antes un COUNT(*) ... GROUP BY contaba todos los salientes de los 20 contactos
          en cada carga de la pagina.
        */
        const outboundRows = await prisma.$queryRaw<Array<{ contactId: string }>>`
          SELECT x."contactId" AS "contactId"
          FROM unnest(ARRAY[${Prisma.join(contactIds)}]::text[]) AS x("contactId")
          WHERE EXISTS (
            SELECT 1
            FROM "Message" m
            WHERE m."workspaceId" = ${membership.workspace.id}
              AND m."contactId" = x."contactId"
              AND m."direction" = 'OUTBOUND'
          )
        `;
        const conHistorial = new Set<string>(outboundRows.map((row) => row.contactId));

        /*
          Todos juntos, no uno por uno.

          Antes era una llamada por contacto y cada una hacia unas seis consultas: con 20 contactos
          en pantalla, 120 consultas -casi todas escrituras- cada vez que alguien abria o refrescaba
          los chats, y casi siempre para dejar todo como ya estaba. Ahora son seis en total, y
          cuando no hay nada que cambiar -el caso normal- no se escribe nada.
        */
        await syncLeadLifecycleForContacts({
          workspaceId: membership.workspace.id,
          contactIds,
          conHistorial,
          newLeadTagName,
        });
      } catch {
        // No bloqueamos la carga si falla la sincronización de tags en segundo plano.
      }
    });
  }

  // Al abrir una conversacion, marcamos sus mensajes entrantes como leidos (vistos).
  // La escritura se difiere con after() para que NO bloquee el render del chat; el badge
  // de no-leídos del chat abierto se fuerza a 0 en código más abajo, así la UI queda
  // correcta de inmediato aunque la escritura termine después de la respuesta.
  const selectedAgentConversationIdForRead =
    selectedChatRef?.source === "agent" ? selectedChatRef.conversationId : null;
  if (selectedAgentConversationIdForRead) {
    after(async () => {
      try {
        await prisma.message.updateMany({
          where: {
            workspaceId: membership.workspace.id,
            conversationId: selectedAgentConversationIdForRead,
            direction: "INBOUND",
            readAt: null,
            // Solo la dueña del chat lo marca leido (ver /api/cliente/chats/live).
            conversation: {
              OR: [{ assignedToUserId: null }, { assignedToUserId: access.userId }, { segundoAsesorId: access.userId }],
            },
          },
          data: { readAt: new Date() },
        });
      } catch {
        // No bloqueamos ni rompemos la carga si falla el marcado como leído.
      }
    });
  }

  const agentIncomingCountRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        incomingCount: number;
      }>>`
        WITH selected_conversations AS (
          SELECT c."id"
          FROM "Conversation" c
          WHERE c."workspaceId" = ${membership.workspace.id}
            AND c."id" IN (${Prisma.join(activeAgentConversationIds)})
        ),
        incoming AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${membership.workspace.id}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'INBOUND'
            AND m."readAt" IS NULL
            AND m."isStatusBroadcast" = false
            -- OJO: aca NO va el filtro de (rawPayload->>'source') <> 'activity'. Las notas de
            -- actividad se guardan SIEMPRE como OUTBOUND (ver conversation-activity.ts), asi que
            -- con el filtro de INBOUND de arriba ya quedan afuera: la condicion no podia
            -- coincidir nunca. Pero obligaba a Postgres a abrir el rawPayload de cada mensaje
            -- candidato -- que guarda el webhook ENTERO, varios KB -- solo para comprobar algo
            -- imposible. Medido el 29-jul-2026: esta consulta tardaba 18s en devolver 20 filas.
          GROUP BY m."conversationId"
        )
        SELECT
          sc."id" AS "conversationId",
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount"
        FROM selected_conversations sc
        LEFT JOIN incoming ON incoming."conversationId" = sc."id"
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        incomingCount: number;
      }>);

  const [agentIncomingCountRowsResult, latestAgentMessageRowsResult, contactTagRowsResult] = await Promise.allSettled([
    agentIncomingCountRowsPromise,
    latestAgentMessageRowsPromise,
    contactTagRowsPromise,
  ]);
  const agentIncomingCountRows =
    agentIncomingCountRowsResult.status === "fulfilled" ? agentIncomingCountRowsResult.value : [];
  const latestAgentMessageRows =
    latestAgentMessageRowsResult.status === "fulfilled" ? latestAgentMessageRowsResult.value : [];
  const contactTagRows =
    contactTagRowsResult.status === "fulfilled" ? contactTagRowsResult.value : [];

  if (process.env.NODE_ENV !== "production") {
    if (agentIncomingCountRowsResult.status === "rejected") {
      console.warn("[CHATS PAGE] agentIncomingCountRowsPromise failed", agentIncomingCountRowsResult.reason);
    }
    if (latestAgentMessageRowsResult.status === "rejected") {
      console.warn("[CHATS PAGE] latestAgentMessageRowsPromise failed", latestAgentMessageRowsResult.reason);
    }
  }
  const latestAgentMessageByConversationId = new Map(
    latestAgentMessageRows.map((row) => [row.conversationId, row]),
  );

  // rawPayload SOLO para las filas que lo usan de fallback (preview sin content o contacto sin
  // nombre). Se pide aparte para no traer el JSON grande de todas. Mismo patron que la API de lista.
  const contactNameByConversationIdSsr = new Map(
    agentConversations.map((conversation) => [conversation.id, conversation.contact.name?.trim() ?? ""]),
  );
  // Por el id del mensaje ya elegido: sin repetir el barrido de todos los mensajes de esos chats.
  const messageIdsNeedingPayloadSsr = latestAgentMessageRows
    .filter((row) => !row.content?.trim() || !(contactNameByConversationIdSsr.get(row.conversationId) ?? ""))
    .map((row) => row.messageId);
  const payloadByConversationIdSsr = new Map<string, unknown>();
  if (messageIdsNeedingPayloadSsr.length > 0) {
    try {
      const payloadRows = await prisma.$queryRaw<Array<{ conversationId: string; rawPayload: unknown }>>(
        sqlPayloadDeMensajes({ workspaceId: membership.workspace.id, messageIds: messageIdsNeedingPayloadSsr }),
      );
      for (const row of payloadRows) {
        payloadByConversationIdSsr.set(row.conversationId, row.rawPayload);
      }
    } catch {
      // Si falla, cae a phone/type-label: no rompemos el render por un fallback.
    }
  }

  const agentIncomingCountById = new Map(agentIncomingCountRows.map((row) => [row.conversationId, row.incomingCount]));
  const contactTagsByContactId = new Map<string, Array<{ label: string; color: string }>>();
  for (const row of contactTagRows) {
    const currentTags = contactTagsByContactId.get(row.contactId) ?? [];
    contactTagsByContactId.set(row.contactId, [
      ...currentTags,
      {
        label: row.name,
        color: row.color,
      },
    ]);
  }

  const selectedAgentConversation =
    selectedChatRef?.source === "agent"
      ? activeAgentConversations.find((item) => item.id === selectedChatRef.conversationId) || null
      : null;
  const selectedConnectionChannelId = conexionElegida.startsWith("channel:")
    ? conexionElegida.slice("channel:".length)
    : "";

  // Los avatares NO se piden aquí: este bloque disparaba hasta 10 fetches EN
  // PARALELO por carga (sin timeout ni cortacircuitos), y con varias pestañas
  // abiertas saturaba a evogo (cada /user/avatar cuelga ~75s cuando WhatsApp
  // rate-limitea). El refresco de fotos lo maneja SOLO el sistema throttled
  // `scheduleContactAvatarRefresh` (máx 4, timeout 8s, cortacircuitos) que se
  // dispara desde el route de la lista de chats. Ver [[contact-avatars-on-demand]].

  const agentRows: UnifiedConversation[] = activeAgentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const latestMessage = latestAgentMessageByConversationId.get(conversation.id);
    const avatarUrl = conversation.contact.avatarUrl ?? null;
    const activeProductContext = toActiveProductContextSummary(conversation.activeProductContext);
    const tags = mergeConversationTags(
      contactTagsByContactId.get(conversation.contact.id) ?? [],
      getConversationContextTags(activeProductContext),
    );

    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      contactId: conversation.contact.id,
      channelId: conversation.channelId || undefined,
      channelName: linkedChannel?.name?.trim() || null,
      label: latestMessage
        ? resolveStoredAgentContactLabel({
            contactName: conversation.contact.name,
            phoneNumber: conversation.contact.phoneNumber,
            rawPayload: payloadByConversationIdSsr.get(conversation.id),
          })
        : getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      tags,
      avatarUrl,
      crmStage: conversation.contact.crmStage ?? null,
      assignedToName: conversation.assignedTo?.name?.trim() || conversation.assignedTo?.email || null,
      assignedToUserId: conversation.assignedToUserId ?? null,
      automationPaused: conversation.automationPaused,
      status: conversation.status ?? null,
      noReasignarAt: conversation.noReasignarAt?.toISOString() ?? null,
      noReasignarPor: conversation.noReasignarPor ?? null,
      // El chat abierto se marca como leído (vía after()); su badge va a 0 de inmediato.
      incomingCount:
        conversation.id === selectedAgentConversationIdForRead
          ? 0
          : agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestMessage
        ? resolveStoredAgentMessagePreview({
            content: latestMessage.content,
            deletedAt: latestMessage.deletedAt,
            rawPayload: payloadByConversationIdSsr.get(conversation.id),
          })
        : null,
      lastMessageType: latestMessage?.type ?? null,
      lastMessageDirection: latestMessage?.direction ?? null,
      sinResponderDesde: latestMessage?.sinResponderDesde ?? null,
      lastMessageStatus: latestMessage?.status ?? null,
      lastMessageAt: latestMessage?.createdAt ?? null,
      activeProductContext,
      // Toda fila de la tanda cumple el filtro (false); solo el chat abierto que no lo cumple, true.
      fueraDeLaVista: conversation.id === idDelChatAbiertoFueraDeLaVista,
    };
  });

  const officialRows: UnifiedConversation[] = officialChatsData.conversations.map((conversation) => ({
    key: `official:${conversation.id}`,
    source: "official",
    conversationId: conversation.id,
    label: conversation.contact.name?.trim() || conversation.contact.phoneNumber?.trim() || conversation.contact.waId,
    secondaryLabel: conversation.contact.phoneNumber?.trim() || conversation.contact.waId,
    // OJO: va la ficha del CRM, no el id de la tabla oficial. Todo lo que cuelga del contacto
    // (etapa, etiquetas, seguimientos, "Qué decir ahora") busca en Contact: con el id oficial
    // no encontraba nada y el chat salía siempre como "Nuevo" y sin guion.
    contactId: conversation.contact.crmContactId ?? undefined,
    tags: [],
    avatarUrl: null,
    // Chapita de etapa igual que en el canal viejo: sin esto la asesora no sabia si el chat
    // estaba Nuevo, Frio o Tibio sin abrirlo.
    crmStage: conversation.contact.crmStage ?? null,
    incomingCount: selectedChatRef?.source === "official" && selectedChatRef.conversationId === conversation.id
      ? 0
      : conversation.incomingCount ?? 0,
    // El badge de quien atiende: antes iba fijo en null y toda la columna salia "---".
    assignedToName: conversation.assignedTo?.name?.trim() || conversation.assignedTo?.email || null,
    // Los chats de la API oficial no tienen canal propio: salen todos por la linea oficial.
    channelName: channels.find((channel) => channel.provider === "OFFICIAL_API")?.name?.trim() || null,
    lastMessage: conversation.lastMessage?.content ?? null,
    lastMessageType: conversation.lastMessage?.type ?? null,
    lastMessageDirection: conversation.lastMessage?.direction ?? null,
    sinResponderDesde: conversation.sinResponderDesde ?? null,
    lastMessageAt: conversation.lastMessage?.createdAt ?? null,
    activeProductContext: null,
  }));

  const selectedConnectionKey = conexionElegida;
  const selectedConnectionChannel = selectedConnectionChannelId
    ? channelsById.get(selectedConnectionChannelId) ?? null
    : null;
  const shouldIncludeOfficialRows =
    !selectedConnectionChannelId || selectedConnectionChannel?.provider === "OFFICIAL_API";
  /*
    Los telefonos se tapan ACA, del lado del servidor.

    Enmascararlos en la pantalla no serviria: el numero real ya habria viajado al navegador y se
    leeria con las herramientas de desarrollo. Tapar lo que ya llego no es tapar.

    Se tapa el titulo tambien, porque cuando el cliente no tiene nombre guardado el titulo ES su
    numero.
  */
  const taparSiHaceFalta = (filas: UnifiedConversation[]): UnifiedConversation[] =>
    modoMonitoreo
      ? filas.map((fila) => ({
          ...fila,
          label: enmascararSiEsTelefono(fila.label),
          secondaryLabel: enmascararTelefono(fila.secondaryLabel),
        }))
      : filas;

  const mergedPorFecha = taparSiHaceFalta(
    dedupeAndSortConversationListRows([
      ...agentRows,
      ...(shouldIncludeOfficialRows ? officialRows : []),
    ]),
  )
      // La base ya filtro por `q` (nombre, numero y mensajes, igual que /list): volver a filtrar por
      // lo visible solo hace falta en monitoreo, donde el numero va tapado.
      .filter((item) => {
        if (!searchQuery || !modoMonitoreo) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.label.toLowerCase().includes(q) ||
        item.secondaryLabel.toLowerCase().includes(q) ||
        (item.lastMessage || "").toLowerCase().includes(q)
      );
    });
  /*
    "Esperando": el orden de la lista de esperas (el que mas lleva primero), como /list, y no el del
    ultimo mensaje. El chat abierto por enlace que no esta esperando va arriba, para que se pueda abrir,
    pero marcado `fueraDeLaVista`: no cumple el filtro (no esta esperando) y la lista no lo cuenta.
  */
  const merged = paginaDeEsperando
    ? [
        ...mergedPorFecha
          .filter((item) => item.key === selectedChatKeyParam && !paginaDeEsperando.claves.includes(item.key))
          .map((item) => ({ ...item, fueraDeLaVista: true })),
        ...ordenarSegunEspera(mergedPorFecha, paginaDeEsperando.claves),
      ]
    : mergedPorFecha;

  const selectedUnified = selectedChatKeyParam
    ? merged.find((item) => item.key === selectedChatKeyParam) || null
    : null;

  // Un chat abierto desde el buscador o un deep-link puede NO estar en el lote cargado
  // (merged), asi que selectedUnified queda null y el compositor perdia el boton de
  // adjuntar (+) y el de audio. selectedChatRef SIEMPRE trae source+id de la clave del
  // chat, asi que sirve de respaldo para que el compositor no dependa de que la
  // conversacion este en la lista.
  const agentComposerConversationId =
    selectedUnified?.source === "agent"
      ? selectedUnified.conversationId
      : selectedChatRef?.source === "agent"
        ? selectedChatRef.conversationId
        : null;
  const agentComposerAgentId =
    (selectedUnified?.source === "agent" ? selectedUnified.agentId : null) ??
    selectedAgentConversation?.agentId ??
    "";
  const selectedEvolutionInstanceName =
    selectedUnified?.source === "agent" && selectedUnified.channelId
      ? channelsById.get(selectedUnified.channelId)?.evolutionInstanceName?.trim() || null
      : null;
  const evolutionGlobalWebsocketEventsEnabled = process.env.WEBSOCKET_GLOBAL_EVENTS === "true";
  // Los empleados (no managers) solo reciben realtime del chat asignado que tienen abierto:
  // no se suscriben a todos los canales ni a los eventos globales del workspace.
  const realtimeGlobalEventsEnabled = evolutionGlobalWebsocketEventsEnabled && isManager;
  const realtimeInstanceNames = isManager
    ? evolutionInstanceNames
    : selectedEvolutionInstanceName
      ? [selectedEvolutionInstanceName]
      : [];
  const chatsRealtimeSyncEnabled = Boolean(
    evolutionSettings.apiBaseUrl &&
      evolutionSettings.apiToken,
  );

  // Realtime de los canales Evolution API: cada uno usa SU socket.io, aparte del WebSocket
  // nativo de evogo (que sigue manejando ChatsRealtimeSync sin cambios).
  //
  // Antes esto se montaba SOLO para el canal seleccionado en el filtro, asi que un canal
  // Evolution API que no estuvieras mirando de frente no tenia realtime: sus mensajes recien
  // aparecian cuando pasaba el poll de respaldo (medido: el evento nunca llegaba y la fila se
  // actualizaba ~8s despues por /list). Se veia como "evoapi es mas lento que evogo", pero no
  // era el gateway: era que no habia socket escuchando.
  //
  // Se sigue la misma politica que evogo (ver realtimeInstanceNames): los managers escuchan
  // todos los canales; los empleados solo el del chat que tienen abierto.
  const realtimeApiChannelIds = isManager
    ? channels.map((channel) => channel.id)
    : selectedUnified?.source === "agent" && selectedUnified.channelId
      ? [selectedUnified.channelId]
      : [];
  const apiGateways = (() => {
    const seenInstanceNames = new Set<string>();
    const gateways: Array<{ key: string; baseUrl: string; instanceName: string; apiKey: string | null }> = [];

    for (const channelId of realtimeApiChannelIds) {
      const channel = channelsById.get(channelId);
      if (!channel) {
        continue;
      }

      const gateway = readGatewayConnection(channel.metadata);
      const instanceName = channel.evolutionInstanceName?.trim();
      if (!instanceName || gateway?.kind !== "EVOLUTION_API") {
        continue;
      }

      // Dos canales pueden apuntar a la misma instancia: un solo socket alcanza.
      if (seenInstanceNames.has(instanceName)) {
        continue;
      }
      seenInstanceNames.add(instanceName);

      gateways.push({
        key: channel.id,
        baseUrl: gateway.baseUrl,
        instanceName,
        apiKey: gateway.apiToken || null,
      });
    }

    return gateways;
  })();

  // Los dos gateways de WhatsApp traen historial, cada uno a su manera (Evolution API lee su
  // base y responde en el momento; evogo se lo pide al celular del usuario y contesta despues,
  // por el evento HISTORYSYNC). La API oficial no tiene historial que traer, y ese caso ya lo
  // filtra `source === "agent"` mas abajo.
  const selectedChannelKeepsHistory = (() => {
    const channelId = selectedUnified?.source === "agent" ? selectedUnified.channelId : null;
    const channel = channelId ? channelsById.get(channelId) : null;
    return Boolean(channel?.evolutionInstanceName);
  })();
  const chatListHref = `/cliente/chats${
    selectedConnectionKey ||
    searchQuery ||
    assignedFilter !== "all" ||
    statusFilter !== "open" ||
    paramsDeFiltros(filtros).length > 0 ||
    pideEspera
      ? `?${new URLSearchParams([
          ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
          ...(searchQuery ? [["q", searchQuery]] : []),
          // Se omite "all", que es el default REAL desde el 15-09-2026: omitir "mine" devolvia
          // la bandeja a "Todas" sola. Ver chat-inbox-conversation-utils, que tenia el mismo error.
          ...(assignedFilter !== "all" ? [["assigned", assignedFilter]] : []),
          ...(statusFilter !== "open" ? [["status", statusFilter]] : []),
          // Los filtros nuevos viajan igual que los viejos: sin esto, abrir un chat los borraba.
          ...paramsDeFiltros(filtros),
          // Y "Esperando": volver a la lista no saca de la vista.
          ...(pideEspera ? [["espera", "1"]] : []),
        ]).toString()}`
      : ""
  }`;
  const selectedChatHref = selectedUnified
    ? `/cliente/chats?${new URLSearchParams([
        ["chatKey", selectedUnified.key],
        ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
        ...(searchQuery ? [["q", searchQuery]] : []),
        ...(assignedFilter !== "all" ? [["assigned", assignedFilter]] : []),
        ...(statusFilter !== "open" ? [["status", statusFilter]] : []),
        ...paramsDeFiltros(filtros),
        ...(pideEspera ? [["espera", "1"]] : []),
        ...(messagePage > 1 ? [["messagePage", String(messagePage)]] : []),
      ]).toString()}`
    : "";
  let selectedConversation: {
    id: string;
    label: string;
    secondaryLabel: string;
    tags?: Array<{
      label: string;
      color: string;
    }>;
    avatarUrl?: string | null;
    contactId?: string | null;
    contactName?: string | null;
    automationPaused?: boolean;
    loadMoreHref?: string | null;
    loadMoreCursor?: string | null;
    hasMoreMessages?: boolean;
    cacheKey?: string | null;
    isPreview?: boolean;
    /** El mensaje fijado del chat (solo CRM), igual que lo manda /live. */
    mensajeFijado?: MensajeFijado | null;
    /** El candado "No reasignar" (ISO y quien), igual que lo manda /live. */
    noReasignarAt?: string | null;
    noReasignarPor?: string | null;
    messages: Array<{
        id: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        editedAt?: Date | null;
        deletedAt?: Date | null;
        authorType: "user" | "bot";
        outboundStatusLabel: string | null;
        type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "CONTACTS" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
        mediaUrl?: string | null;
        rawPayload?: unknown;
      }>;
  } | null = null;

  /*
    Etapa actual del CRM para el contacto del chat abierto. Se pide JUNTO con el detalle de abajo,
    no despues: el contacto ya se sabe por la fila (en los dos casos selectedConversation.contactId
    sale de selectedUnified.contactId).
  */
  const selectedContactId = selectedUnified ? selectedUnified.contactId ?? null : null;
  const selectedContactRowPromise = selectedContactId
    ? (async () => {
        try {
          const rows = await prisma.$queryRaw<Array<{ crmStage: string; metadata: unknown }>>`
            SELECT c."crmStage"::text AS "crmStage", c."metadata" AS "metadata"
            FROM "Contact" c
            WHERE c."id" = ${selectedContactId}
              AND c."workspaceId" = ${membership.workspace.id}
            LIMIT 1
          `;
          return rows[0] ?? null;
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  if (selectedUnified?.source === "agent") {
    const selectedTags = getConversationContextTags(selectedUnified.activeProductContext ?? null);
    const previewText = selectedUnified.lastMessage?.trim() || getConversationPreviewLabel(selectedUnified.lastMessageType);
    const previewDirection = selectedUnified.lastMessageDirection || "INBOUND";
    const previewCreatedAt = selectedUnified.lastMessageAt ?? new Date();

    // Cargamos los últimos 10 mensajes en el servidor para que el chat aparezca completo
    // y con scroll abajo desde el primer pintado (sin esperar al fetch de /live). El /live
    // solo queda para realtime/refresco. Los mediaUrl van tal cual están guardados (la
    // resolución/auto-reparación pesada la hace el /live de seguimiento, ~2.5s después).
    const detail = await loadAgentConversationDetail({
      workspaceId: membership.workspace.id,
      conversationId: selectedUnified.conversationId,
      batchSize: 10,
    });

    const detailMessages = detail?.messages.map((message) => ({
      id: message.id,
      externalId: message.externalId,
      content: message.content,
      direction: message.direction,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      authorType: (message.direction === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
      // Venia fijo en null: los acuses solo funcionaban en el canal de API oficial, y en los
      // chats de WhatsApp NUNCA se vio un check aunque la base tuviera el estado correcto.
      outboundStatusLabel: message.direction === "OUTBOUND" ? message.status : null,
      type: (message.type ?? "TEXT") as NonNullable<UnifiedConversation["lastMessageType"]>,
      mediaUrl: message.mediaUrl,
      reactionEmoji: message.reactionEmoji,
      transcripcion: message.transcripcion,
      rawPayload: message.rawPayload,
    }));

    const previewMessages = previewText
      ? [{
          id: `${selectedUnified.key}:preview`,
          content: previewText,
          direction: previewDirection,
          createdAt: previewCreatedAt,
          authorType: (previewDirection === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
          outboundStatusLabel: null,
          type: (selectedUnified.lastMessageType ?? "TEXT") as NonNullable<UnifiedConversation["lastMessageType"]>,
          mediaUrl: null,
          rawPayload: null,
        }]
      : [];

    const hasRealMessages = Boolean(detailMessages && detailMessages.length > 0);

    selectedConversation = {
      id: selectedUnified.conversationId,
      label: selectedUnified.label,
      secondaryLabel: selectedUnified.secondaryLabel,
      tags: selectedUnified.tags ?? selectedTags,
      avatarUrl: selectedUnified.avatarUrl ?? null,
      contactId: selectedContactId,
      contactName: selectedUnified.label,
      automationPaused: detail?.automationPaused ?? selectedAgentConversation?.automationPaused ?? false,
      cacheKey: selectedUnified.key,
      messages: hasRealMessages ? detailMessages! : previewMessages,
      hasMoreMessages: hasRealMessages ? Boolean(detail?.hasMoreMessages) : false,
      loadMoreCursor: hasRealMessages ? detail?.loadMoreCursor ?? null : null,
      loadMoreHref: null,
      // Si trajimos mensajes reales NO es preview: el chat se muestra completo de una.
      isPreview: !hasRealMessages,
      mensajeFijado: detail?.mensajeFijado ?? null,
      // Del detalle (recien leido) y, si no vino, de la fila: el chat abierto nace con su candado.
      noReasignarAt: detail ? detail.noReasignarAt : selectedUnified.noReasignarAt ?? null,
      noReasignarPor: detail ? detail.noReasignarPor : selectedUnified.noReasignarPor ?? null,
    };
  } else if (selectedUnified?.source === "official") {
    const detail = officialChatsData.selectedConversation;
    const detailMessages = detail?.messages.map((message) => ({
      id: message.id,
      content: message.content,
      direction: message.direction,
      createdAt: message.createdAt,
      editedAt: null,
      deletedAt: null,
      authorType: (message.direction === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
      outboundStatusLabel: message.direction === "OUTBOUND" ? message.status : null,
      type: message.type,
      mediaUrl: message.mediaUrl,
      rawPayload: message.rawPayload,
      errorDetail: message.errorDetail ?? null,
    })) ?? [];

    const previewText = selectedUnified.lastMessage?.trim() || getConversationPreviewLabel(selectedUnified.lastMessageType);
    const previewDirection = selectedUnified.lastMessageDirection || "INBOUND";
    const previewCreatedAt = selectedUnified.lastMessageAt ?? new Date();
    const previewMessages = previewText
      ? [{
          id: `${selectedUnified.key}:preview`,
          content: previewText,
          direction: previewDirection,
          createdAt: previewCreatedAt,
          editedAt: null,
          deletedAt: null,
          authorType: (previewDirection === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
          outboundStatusLabel: null,
          type: (selectedUnified.lastMessageType ?? "TEXT") as NonNullable<UnifiedConversation["lastMessageType"]>,
          mediaUrl: null,
          rawPayload: null,
        }]
      : [];
    const hasRealMessages = detailMessages.length > 0;

    selectedConversation = {
      id: selectedUnified.conversationId,
      label: selectedUnified.label,
      secondaryLabel: selectedUnified.secondaryLabel,
      tags: selectedUnified.tags ?? [],
      avatarUrl: selectedUnified.avatarUrl ?? null,
      contactId: selectedUnified.contactId ?? null,
      contactName: selectedUnified.label,
      automationPaused: Boolean(officialChatsData.selectedConversation?.automationPaused),
      cacheKey: selectedUnified.key,
      messages: hasRealMessages ? detailMessages : previewMessages,
      hasMoreMessages: false,
      loadMoreCursor: null,
      loadMoreHref: null,
      isPreview: !hasRealMessages,
      mensajeFijado: detail?.mensajeFijado ?? null,
    };
  }

  const selectedContactRow = await selectedContactRowPromise;
  const selectedContactCrmStage = selectedContactRow?.crmStage ?? "NUEVO";
  // Si a este cliente le falta que alguien diga si se cerro la venta (ver crm-stage-sync).
  const selectedCierrePendiente = tieneCierrePendiente(selectedContactRow?.metadata);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <ChatsAutoRefresh
        intervalMs={60000}
        enabled
        realtimeEnabled={chatsRealtimeSyncEnabled}
        selectedConversationKey={selectedUnified?.key ?? null}
        /*
          Red de seguridad por si el altavoz se cae, nada mas.

          Cada tick vuelve a pedir la pantalla entera (79 kB). Con 8 segundos, Magilus -que tiene 36
          chats abiertos de la API oficial- la pedia siete veces por minuto por pestaña aunque no
          pasara nada. Los mensajes de Meta ya avisan por el altavoz (webhooks/meta/official-api),
          asi que el tick solo cubre un socket caido. Los canales WAHA no lo necesitan: para ese
          mismo caso esta el refresco general de 60s.
        */
        officialRefreshMs={officialChatsData.conversations.length > 0 ? 60000 : 0}
      />
      {/*
        El altavoz (WAHA y API oficial) y el sonido de mensaje nuevo ya no se montan aca: viven en el
        marco de la app (app-shell), para que suenen en todas las pantallas. Montarlos tambien aca
        abriria un segundo socket y cada mensaje sonaria dos veces.
      */}
      <ChatsRealtimeSync
        enabled={chatsRealtimeSyncEnabled}
        apiBaseUrl={evolutionSettings.apiBaseUrl}
        apiKey={evolutionSettings.apiToken || null}
        instanceNames={realtimeInstanceNames}
        activeInstanceName={selectedEvolutionInstanceName}
        selectedConversationKey={selectedUnified?.key ?? null}
        selectedConversationPhoneNumber={selectedUnified?.source === "agent" ? selectedUnified.secondaryLabel : null}
        globalEventsEnabled={realtimeGlobalEventsEnabled}
      />
      {apiGateways.map((gateway) => (
        <ChatsEvolutionApiRealtime
          key={gateway.key}
          enabled
          baseUrl={gateway.baseUrl}
          instanceName={gateway.instanceName}
          apiKey={gateway.apiKey}
          selectedConversationKey={selectedUnified?.key ?? null}
          selectedConversationPhoneNumber={selectedUnified?.source === "agent" ? selectedUnified.secondaryLabel : null}
        />
      ))}
      <PushSubscriptionManager enabled={chatsRealtimeSyncEnabled} />
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <SharedInbox
        /*
         * La lista de chats se arma UNA vez al montar y despues vive del lado del cliente (para
         * que el realtime la mueva sin recargar). Al cambiar de filtro eso jugaba en contra:
         * seguian a la vista los chats del filtro anterior mientras "Mias 1" ya decia 1. Con la
         * clave, cambiar de filtro rearma la lista desde cero y no queda nada viejo.
         */
        /*
          Los filtros de etapa y "sin responder" tambien van en la clave. Sin ellos, elegir
          "Descartado" ponia la chapita pero la lista seguia con los chats de antes: la bandeja solo
          agrega y actualiza, nunca quita, asi que nada sacaba a los que no eran descartados.
        */
        /*
          Solo la linea en la clave. Pestaña, estado y filtros YA NO vuelven a montar la bandeja:
          cambiar de filtro no navega (la bandeja pide /list y cambia la URL), y si el servidor
          vuelve a armar la pagina con otra vista, la bandeja reemplaza la lista sola
          (filtrosDelServidor + assignedFilter + statusFilter). Montarla de nuevo eran 3-8 pedidos
          mas por toque (conteos, la lista repetida, filtros guardados, precargas).
        */
        key={selectedConnectionKey}
        filtrosDelServidor={paramsDeFiltros(filtros)
          .map(([clave, valor]) => `${clave}=${valor}`)
          .join("&")}
        esperaDelServidor={pideEspera}
        searchAction="/cliente/chats"
        selectedConversationId={selectedUnified?.key ?? ""}
        mobileConversationActive={Boolean(selectedChatKeyParam)}
        selectedConnectionKey={selectedConnectionKey}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        isManager={isManager}
        // Quien monitorea tiene las pestañas y los filtros de un jefe, pero solo eso: no es jefe.
        veTodoElEquipo={modoMonitoreo}
        // Los que quien mira fijo arriba de su bandeja (hasta 3, como WhatsApp).
        chatsFijados={chatsFijados}
        pastillasIniciales={pastillasIniciales}
        usuarioActualId={access.userId}
        // Bloquear contactos: solo dueño y admin (ver lib/bloqueo-de-contactos).
        puedeBloquear={access.isOwner || access.role === "ADMIN"}
        chatSignature={chatSignature}
        initialConversationBatchSize={conversationListTake}
        initialHasMoreConversations={hasMoreConversationItems}
        initialConversationOffset={paginaDeEsperando ? paginaDeEsperando.nextOffset : agentConversationsConsumidas.length}
        conversationListApiPath="/api/cliente/chats/list"
        searchQuery={searchQuery}
        messageScrollBehavior={scrollMode === CHAT_MESSAGE_SCROLL_PRESERVE_QUERY ? "preserve" : "bottom"}
        conversations={merged.map((item) => ({
          id: item.key,
          source: item.source,
          agentId: item.agentId ?? null,
          contactId: item.contactId ?? null,
          label: item.label,
          secondaryLabel: item.secondaryLabel,
          tags: item.tags ?? [],
          // Sin esto la pastilla de etapa de la fila quedaba vieja: al cambiar la etapa desde el
          // chat se refresca la página, pero el item del servidor no traía crmStage, así que el
          // merge se quedaba con el valor anterior (cambiabas a Caliente y la lista seguía en Frío).
          crmStage: item.crmStage ?? null,
          channelType: "whatsapp",
          incomingCount: item.incomingCount ?? 0,
          avatarUrl: item.avatarUrl ?? null,
          assignedToName: item.assignedToName ?? null,
          // Barra del chat al instante al tocar la fila (solo las filas del canal propio los traen).
          ...(item.source === "agent"
            ? {
                assignedToUserId: item.assignedToUserId ?? null,
                automationPaused: item.automationPaused ?? false,
                status: item.status ?? null,
                noReasignarAt: item.noReasignarAt ?? null,
                noReasignarPor: item.noReasignarPor ?? null,
              }
            : {}),
          channelName: item.channelName ?? null,
          lastMessage: item.lastMessage,
          lastMessageType: item.lastMessageType ?? null,
          lastMessageDirection: item.lastMessageDirection,
          // Sin esto la primera carga llega sin "sin responder desde" (solo lo traeria /list).
          sinResponderDesde: item.sinResponderDesde ?? null,
          lastMessageStatus: item.lastMessageStatus,
          lastMessageAt: item.lastMessageAt,
          // Solo llega la marca: la bandeja todavia no esconde nada con ella (pastillas, parte 2).
          ...(item.fueraDeLaVista !== undefined ? { fueraDeLaVista: item.fueraDeLaVista } : {}),
          href: `/cliente/chats?chatKey=${encodeURIComponent(item.key)}${selectedConnectionKey ? `&connection=${encodeURIComponent(selectedConnectionKey)}` : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${assignedFilter !== "all" ? `&assigned=${assignedFilter}` : ""}${statusFilter !== "open" ? `&status=${statusFilter}` : ""}${paramsDeFiltros(filtros)
            .map(([clave, valor]) => `&${clave}=${encodeURIComponent(valor)}`)
            .join("")}${pideEspera ? "&espera=1" : ""}`,
        }))}
        // La etapa viaja CON la conversación abierta: es la que usa "Qué decir ahora" para
        // elegir el guion. Sin esto el panel abría en blanco por no saber en qué etapa está.
        selectedConversation={
          selectedConversation
            ? {
                ...selectedConversation,
                crmStage: selectedContactCrmStage ?? null,
                cierrePendiente: selectedCierrePendiente,
              }
            : selectedConversation
        }
        selectedConversationTags={selectedConversation?.tags ?? []}
        backHref={chatListHref}
        headerBadge={null}
        headerActions={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <ChatHeaderActions
              key={`header-actions:${selectedConversation.id}:${selectedAgentConversation?.status ?? "OPEN"}`}
              contactId={selectedContactId ?? null}
              stage={selectedContactCrmStage as CrmStage}
              conversationId={selectedConversation.id}
              automationPaused={Boolean(selectedConversation.automationPaused)}
              status={selectedAgentConversation?.status ?? "OPEN"}
              returnTo={selectedChatHref}
              toggleAutomationAction={toggleConversationAutomationAction}
            />
          ) : selectedUnified?.source === "official" && selectedConversation ? (
            <ChatHeaderActions
              key={`header-actions:${selectedConversation.id}:${officialChatsData.selectedConversation?.status ?? "OPEN"}`}
              // La ficha del CRM del mismo cliente (la enlaza el puente al entrar el mensaje).
              // Sin ella la cabecera mostraba "Nuevo" fijo y sin poder cambiarlo: un lead que
              // escribia al numero nuevo se quedaba sin etapa.
              contactId={officialChatsData.selectedConversation?.contact.crmContactId ?? null}
              stage={(officialChatsData.selectedConversation?.contact.crmStage ?? "NUEVO") as CrmStage}
              conversationId={selectedConversation.id}
              automationPaused={Boolean(selectedConversation.automationPaused)}
              status={officialChatsData.selectedConversation?.status ?? "OPEN"}
              returnTo={selectedChatHref}
              toggleAutomationAction={toggleOfficialApiConversationAutomationAction}
              source="official"
            />
          ) : null
        }
        headerBar={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <BarraDeAccionesDelChat
              key={`header-bar:${selectedConversation.id}:${selectedAgentConversation?.status ?? "OPEN"}`}
              contactId={selectedContactId ?? null}
              stage={selectedContactCrmStage as CrmStage}
              conversationId={selectedConversation.id}
              automationPaused={Boolean(selectedConversation.automationPaused)}
              status={selectedAgentConversation?.status ?? "OPEN"}
              returnTo={selectedChatHref}
              toggleAutomationAction={toggleConversationAutomationAction}
              assignee={selectedAgentConversation?.assignedTo ?? null}
            />
          ) : selectedUnified?.source === "official" && selectedConversation ? (
            <BarraDeAccionesDelChat
              key={`header-bar:${selectedConversation.id}:${officialChatsData.selectedConversation?.status ?? "OPEN"}`}
              contactId={officialChatsData.selectedConversation?.contact.crmContactId ?? null}
              stage={(officialChatsData.selectedConversation?.contact.crmStage ?? "NUEVO") as CrmStage}
              conversationId={selectedConversation.id}
              automationPaused={Boolean(selectedConversation.automationPaused)}
              status={officialChatsData.selectedConversation?.status ?? "OPEN"}
              returnTo={selectedChatHref}
              toggleAutomationAction={toggleOfficialApiConversationAutomationAction}
              source="official"
              assignee={officialChatsData.selectedConversation?.assignedTo ?? null}
            />
          ) : null
        }
        contactPanelHeaderActions={
          /* Descargar el PDF, copiar la conversacion y traer el historial. Van en la ficha y no en
             la barra del chat: se usan cuando uno se sienta a mirar un caso, no todos los dias.
             "Traer historial" solo lo expone el canal viejo. */
          selectedUnified?.key ? (
            <MenuDelContacto
              key={`panel-menu:${selectedUnified.key}`}
              chatKey={selectedUnified.key}
              label={selectedUnified.label}
              phone={selectedUnified.secondaryLabel}
              conversationId={selectedConversation?.id ?? null}
              puedeTraerHistorial={
                selectedUnified.source === "agent" && Boolean(selectedConversation) && selectedChannelKeepsHistory
              }
            />
          ) : null
        }
        contactPanelActions={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <AssignChatControl
              key={`panel-assign:${selectedConversation.id}`}
              conversationId={selectedConversation.id}
              assignee={selectedAgentConversation?.assignedTo ?? null}
              segundoAsesor={selectedAgentConversation ? (selectedAgentConversation.segundoAsesor ?? null) : undefined}
            />
          ) : selectedUnified?.source === "official" && selectedConversation ? (
            // Mismo selector que el canal viejo: el equipo se reparte los chats de Ventas 2
            // igual que los de Ventas 1, sin tener que acordarse de quien iba cada uno.
            <AssignChatControl
              key={`panel-assign:official:${selectedConversation.id}`}
              conversationId={selectedConversation.id}
              assignee={officialChatsData.selectedConversation?.assignedTo ?? null}
              source="official"
            />
          ) : null
        }
        /*
          Sin cuadro de escribir en modo monitoreo.

          El panel ya sabe dibujarse sin el -es opcional-, asi que no hay que apagar boton por
          boton: se va el texto, los adjuntos, el microfono y las respuestas rapidas de una vez.
          El servidor igual rechaza el envio; esto es para que no se intente.
        */
        composer={modoMonitoreo ? undefined : {
          action: sendUnifiedChatReplyAction,
          hiddenFields: selectedUnified
            ? [
                { name: "source", value: selectedUnified.source },
                { name: "conversationId", value: selectedUnified.conversationId },
                { name: "agentId", value: selectedUnified.agentId ?? "" },
                ...(selectedChatHref ? [{ name: "returnTo", value: selectedChatHref }] : []),
              ]
            : [],
          // OJO: audio y media se mandan SIEMPRE, aunque al cargar la pagina no hubiera ningun
          // chat en la URL. Son la plantilla (a que endpoint subir y que accion ejecutar); el
          // conversationId real lo reapunta el cliente al chat abierto (effectiveComposer en
          // shared-inbox), que tambien los apaga en los chats de la API oficial.
          //
          // Antes iban condicionados a que el SERVIDOR ya conociera el chat, asi que en el flujo
          // normal (entrar a Chats y hacer CLICK en una conversacion) nunca se creaban: el "+"
          // de adjuntar y el microfono no aparecian y no se podian mandar catalogos ni fotos
          // hasta recargar la pagina.
          audio: {
            uploadPath: "/api/cliente/chats/upload-audio",
            source: "agent",
            conversationId: agentComposerConversationId ?? "",
            agentId: agentComposerAgentId,
            returnTo: selectedChatHref ?? "",
            sendAction: sendChatAudioReplyAction,
          },
          media: {
            uploadPath: "/api/cliente/chats/upload-media",
            source: "agent",
            conversationId: agentComposerConversationId ?? "",
            agentId: agentComposerAgentId,
            returnTo: selectedChatHref ?? "",
            sendAction: sendChatMediaReplyAction,
          },
        }}
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription="Cuando lleguen mensajes por tus canales, apareceran aqui en una sola bandeja."
        emptySelectionTitle="Tus conversaciones"
        emptySelectionDescription="Selecciona un chat de la lista para comenzar"
      />
    </section>
  );
}
