import type {
  AssignedFilter,
  StatusFilter,
  LiveConversationListSnapshot,
  LiveConversationSnapshot,
  SharedInboxConversationItem,
  SharedInboxConversationItemLike,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";
import { getMessagePreviewText, isActivityMessage } from "./chat-inbox-format";
import { mergeConversationSnapshots } from "./chat-history-cache";
import { siguienteSinResponderDesde } from "@/features/chats/domain/sin-responder";

export function normalizeLiveConversationSnapshot(value: unknown): LiveConversationSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    messages?: Array<{ createdAt?: string | Date; editedAt?: string | Date | null; deletedAt?: string | Date | null } & Record<string, unknown>>;
  };

  if (typeof data.id !== "string" || !Array.isArray(data.messages)) {
    return null;
  }

  return {
    ...(value as SharedInboxSelectedConversation),
    id: data.id,
    // Normalizar a ASC (oldest-first) para que la conversación siga el orden natural.
    messages: data.messages
      .map((message) => ({
        ...(message as SharedInboxMessageItem),
        createdAt: new Date(message.createdAt || Date.now()),
        editedAt: message.editedAt ? new Date(message.editedAt) : null,
        deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
      }))
      .sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }),
  };
}

export function normalizeLiveConversationListSnapshot(value: unknown): LiveConversationListSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    lastMessageAt?: string | Date | null;
  };

  if (typeof data.id !== "string") {
    return null;
  }

  return {
    ...(value as SharedInboxConversationItem),
    id: data.id,
    lastMessageAt: data.lastMessageAt ? new Date(data.lastMessageAt) : null,
  };
}

export function getConversationLastMessageTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function normalizeConversationItem(item: SharedInboxConversationItemLike, fallbackHref = ""): SharedInboxConversationItem {
  const resolvedId =
    typeof item.id === "string" && item.id.trim()
      ? item.id
      : typeof item.key === "string" && item.key.trim()
        ? item.key
        : typeof item.conversationId === "string" && item.conversationId.trim()
          ? item.conversationId
          : "";
  const lastMessageAt = item.lastMessageAt ? new Date(item.lastMessageAt) : null;
  return {
    ...item,
    id: resolvedId,
    source: item.source === "official" ? "official" : "agent",
    label: item.label ?? "",
    secondaryLabel: item.secondaryLabel ?? "",
    lastMessage: item.lastMessage ?? null,
    href: item.href?.trim() || fallbackHref,
    lastMessageAt: lastMessageAt && Number.isFinite(lastMessageAt.getTime()) ? lastMessageAt : null,
    // El badge del canal (glifo verde de WhatsApp) depende de channelType. La lista base y la
    // paginación vienen de /api/cliente/chats/list, que NO envía channelType → el badge
    // desaparecía y solo reaparecía en los chats tocados por realtime (que sí lo infieren).
    // Lo inferimos acá, el único funnel por el que pasan TODOS los items del cliente.
    channelType: item.channelType ?? inferChannelTypeFromId(resolvedId),
  };
}

export function normalizeConversationItems(
  items: SharedInboxConversationItemLike[],
  fallbackHrefFactory: (item: SharedInboxConversationItemLike) => string = () => "",
): SharedInboxConversationItem[] {
  return items.map((item) => normalizeConversationItem(item, fallbackHrefFactory(item)));
}

export function buildConversationItemHrefFromParams(
  searchAction: string,
  selectedConnectionKey: string,
  searchQuery: string,
  conversation: SharedInboxConversationItemLike,
  assignedFilter: AssignedFilter = "mine",
  statusFilter: StatusFilter = "open",
  /** Etapa, sin responder y etiquetas (paramsDeFiltros): sin ellos, abrir el chat los borraba de la URL. */
  filtrosExtra: Array<[string, string]> = [],
  /** La vista "Esperando" (`espera=1`): abrir un chat no saca de la vista. */
  espera = false,
) {
  const chatKey =
    (typeof conversation.id === "string" && conversation.id.trim()) ||
    (typeof conversation.key === "string" && conversation.key.trim()) ||
    (typeof conversation.conversationId === "string" && conversation.conversationId.trim()) ||
    "";

  if (!chatKey) {
    return "";
  }

  const params = new URLSearchParams();
  params.set("chatKey", chatKey);
  if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  /*
    Se omite cuando es "all", que es el default REAL desde el 15-09-2026.

    Este comentario decia lo contrario -"el servidor lee la ausencia como mine"- y ya no era
    cierto: ese dia se invirtio el defecto de la pagina a "Todas" para quien mira el negocio.
    `appsidebar` se actualizo; este armador de enlaces se quedo con la condicion vieja.

    El resultado, estando en "Mias": cada enlace de conversacion soltaba el `assigned=mine`, el
    servidor leia la ausencia como "Todas" y la bandeja se devolvia sola a "Todas" sin que nadie
    tocara el filtro (Alex, 28-09-2026). El mismo bug que el comentario decia haber arreglado,
    pero al otro lado.
  */
  if (assignedFilter !== "all") params.set("assigned", assignedFilter);
  if (statusFilter !== "open") params.set("status", statusFilter);
  for (const [clave, valor] of filtrosExtra) params.set(clave, valor);
  if (espera) params.set("espera", "1");
  const qs = params.toString();
  return qs ? `${searchAction}?${qs}` : searchAction;
}

/* ------------------------------------------------------------------------------------------------
   LA VISTA "ESPERANDO" EN LA BANDEJA (parte 4 de "Esperando respuesta")

   Funciones puras: las usan la pastilla (appsidebar) y la bandeja (shared-inbox), y las prueba
   scripts/check-espera-bandeja.mjs sin navegador.
------------------------------------------------------------------------------------------------ */

/** Lo que trae `espera` de /counts (ver features/chats/domain/espera-de-chats.ts). */
type EsperaDelConteo = {
  mine: number;
  all: number;
  chats: Array<{ key: string; desde: string; mia: boolean }>;
};

/**
 * Con que asignacion queda la bandeja al tocar "Esperando": Todas o Mias, nada mas, para que el
 * numero de la pastilla y la lista coincidan. La asesora, siempre Mias. Quien ve al equipo conserva
 * Mias si esta en Mias; desde "Sin asignar", "Por asesora", una lista guardada o con condiciones
 * (`sueltaLaVista`), Todas.
 */
export function asignacionDeEsperando(
  assignedFilter: AssignedFilter,
  puedeVerEquipo: boolean,
  sueltaLaVista = false,
): "all" | "mine" {
  if (!puedeVerEquipo) return "mine";
  if (sueltaLaVista) return "all";
  return assignedFilter === "mine" ? "mine" : "all";
}

/** El numero de la pastilla: `espera.mine` en Mias y `espera.all` en Todas. Sin dato, null (sin numero). */
export function numeroDeEsperando(
  espera: Pick<EsperaDelConteo, "mine" | "all"> | null | undefined,
  asignacion: "all" | "mine",
): number | null {
  if (!espera) return null;
  const numero = asignacion === "mine" ? espera.mine : espera.all;
  return typeof numero === "number" && Number.isFinite(numero) ? numero : null;
}

/**
 * La direccion de la bandeja al tocar "Esperando" o, estando en Esperando, Todas/Mias.
 *
 * Con `espera` va `espera=1` con la asignacion (Todas o Mias) y la linea; se sueltan el estado, las
 * condiciones y la lista guardada: la lista Esperando no los usa y el numero no los cuenta. Sin
 * `espera` queda la bandeja de siempre con esa asignacion. La busqueda se conserva (con texto la
 * busqueda manda, igual que en /list).
 */
export function hrefDeEsperando(input: {
  searchAction: string;
  selectedConnectionKey?: string;
  searchQuery?: string;
  asignacion: "all" | "mine";
  espera: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.selectedConnectionKey) params.set("connection", input.selectedConnectionKey);
  if (input.searchQuery?.trim()) params.set("q", input.searchQuery.trim());
  if (input.asignacion !== "all") params.set("assigned", input.asignacion);
  if (input.espera) params.set("espera", "1");
  const qs = params.toString();
  return qs ? `${input.searchAction}?${qs}` : input.searchAction;
}

/**
 * La espera de /counts sin los chats que esta pantalla ACABA de contestar.
 *
 * La espera del servidor se guarda 60 s: un chat contestado recien vuelve a salir hasta un minuto
 * despues. `contestadas` es clave -> cuando se contesto (ms). Un chat contestado se descarta solo
 * mientras su espera empezo antes de esa respuesta; si el cliente volvio a escribir despues, vuelve.
 * Pasado `vigenciaMs` (la memoria del servidor ya se renovo) manda otra vez lo que dice /counts.
 */
export function esperaSinContestadas<T extends EsperaDelConteo>(
  espera: T | null | undefined,
  contestadas: ReadonlyMap<string, number>,
  ahora: number,
  vigenciaMs: number,
): T | null {
  if (!espera) return null;
  if (contestadas.size === 0) return espera;
  const chats = (espera.chats ?? []).filter((chat) => {
    const contestadaEn = contestadas.get(chat.key);
    if (contestadaEn === undefined || ahora - contestadaEn > vigenciaMs) return true;
    const desde = Date.parse(chat.desde);
    return Number.isFinite(desde) && desde > contestadaEn;
  });
  if (chats.length === (espera.chats ?? []).length) return espera;
  const quitadas = (espera.chats ?? []).filter((chat) => !chats.includes(chat));
  return {
    ...espera,
    chats,
    mine: Math.max(0, espera.mine - quitadas.filter((chat) => chat.mia).length),
    all: Math.max(0, espera.all - quitadas.length),
  };
}

/**
 * Que hacer con la lista "Esperando" cuando llega un /counts nuevo, sin pedir nada para decidirlo.
 *
 * - `items`: la lista sin los chats que ya no esperan (salen sin pedir nada). Mismo arreglo si no
 *   cambio nada, para no re-dibujar.
 * - `pedirLista`: true solo si llego una clave que la lista no tiene Y que no se pidio antes en
 *   esta vista (`yaPedidas`). Asi un ciclo de /counts agrega como mucho UN /list, y ninguno si no
 *   entro nada nuevo. En Mias solo cuentan los chats de quien mira.
 */
export function sincronizarConEspera<T extends { id: string }>(input: {
  items: T[];
  espera: Pick<EsperaDelConteo, "chats"> | null | undefined;
  asignacion: AssignedFilter;
  yaPedidas: ReadonlySet<string>;
}): { items: T[]; faltan: string[]; pedirLista: boolean } {
  // Sin dato no se decide nada: la lista queda como esta.
  if (!input.espera) return { items: input.items, faltan: [], pedirLista: false };
  const claves = new Set(input.espera.chats.map((chat) => chat.key));
  const items = input.items.filter((item) => claves.has(item.id));
  const enLaLista = new Set(items.map((item) => item.id));
  const faltan = input.espera.chats
    .filter((chat) => (input.asignacion === "mine" ? chat.mia : true))
    .map((chat) => chat.key)
    .filter((clave) => !enLaLista.has(clave));
  return {
    items: items.length === input.items.length ? input.items : items,
    faltan,
    pedirLista: faltan.some((clave) => !input.yaPedidas.has(clave)),
  };
}

/**
 * Junta la primera pagina que manda el servidor en Esperando con lo que ya estaba cargado.
 *
 * El orden es el del servidor (el que mas lleva esperando primero): primero la pagina en su orden
 * y despues lo cargado al bajar que no vino en ella. Si el servidor dice que no hay mas, la lista
 * es la pagina y nada mas: lo que no vino ya no espera.
 */
export function juntarPaginaDeEsperando<T extends { id: string }>(
  actuales: T[],
  pagina: T[],
  hayMas: boolean,
): T[] {
  if (!hayMas) return pagina;
  const enLaPagina = new Set(pagina.map((item) => item.id));
  return [...pagina, ...actuales.filter((item) => !enLaPagina.has(item.id))];
}

export function extractConversationIdFromKey(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

export function conversationIdMatchesKey(key: string, conversationId: string) {
  const normalizedKey = key.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedKey || !normalizedConversationId) {
    return false;
  }

  if (normalizedKey === normalizedConversationId) {
    return true;
  }

  return extractConversationIdFromKey(normalizedKey) === normalizedConversationId;
}

export function findConversationItemBySnapshotId(
  items: SharedInboxConversationItem[],
  snapshotId: string,
  source?: SharedInboxConversationItem["channelType"],
) {
  const normalizedSnapshotId = snapshotId.trim();
  if (!normalizedSnapshotId) {
    return null;
  }

  return (
    items.find((item) => conversationIdMatchesKey(item.id, normalizedSnapshotId)) ??
    (source === "whatsapp_official"
      ? items.find((item) => item.id === normalizedSnapshotId)
      : null)
  );
}

// El id de conversación ya viene prefijado por canal ("official:" = API oficial, resto =
// WhatsApp por whatsmeow). Sirve de último recurso para no perder el badge del canal cuando
// un update de realtime no trae channelType y el item existente no se pudo casar.
function inferChannelTypeFromId(
  id: string | null | undefined,
): SharedInboxConversationItem["channelType"] {
  return id?.startsWith("official:") ? "whatsapp_official" : "whatsapp";
}

/*
  "Sin responder desde" de una fila despues de un mensaje que llega en vivo, cuando el aviso no
  trae el dato del servidor. Parte del valor que ya tenia la fila (`actual`):
  - sin direccion no se sabe nada del mensaje: queda como estaba;
  - si no, manda la regla de siguienteSinResponderDesde (saliente valida la quita, SYSTEM y
    FAILED no cambian nada, entrante mantiene la fecha del primero).
  La burbuja local que fallo trae "error" en vez de "FAILED": es lo mismo.
*/
function sinResponderTrasMensaje(
  actual: SharedInboxConversationItem["sinResponderDesde"],
  mensaje: {
    direccion: "INBOUND" | "OUTBOUND" | null | undefined;
    tipo: string | null | undefined;
    status: string | null | undefined;
    fecha: Date | string | null | undefined;
  },
): SharedInboxConversationItem["sinResponderDesde"] {
  if (mensaje.direccion !== "INBOUND" && mensaje.direccion !== "OUTBOUND") {
    return actual;
  }
  return siguienteSinResponderDesde<Date | string | null>(actual ?? null, {
    direccion: mensaje.direccion,
    tipo: mensaje.tipo,
    status: mensaje.status === "error" ? "FAILED" : mensaje.status,
    fecha: mensaje.fecha ?? null,
  });
}

export function buildConversationItemFromSnapshot(
  snapshot: LiveConversationSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  /*
    Las notas de actividad no son el ultimo mensaje de la fila.

    "Fulana tomo esta conversacion al responder", "movio la etapa a Frio": son marcas del
    historial, para leer DENTRO del chat. En la fila de la lista pisaban al mensaje de verdad, y
    lo que uno necesita ver ahi es lo ultimo que se dijeron -es como decide a cual entrar-.

    El servidor ya las descarta al armar la lista; aca no, y por eso volvian a aparecer apenas se
    abria el chat: esta funcion reconstruye la fila con lo que tiene cargado el panel, donde las
    notas SI estan porque ahi se muestran.
  */
  const latestMessage =
    [...snapshot.messages].reverse().find((mensaje) => !isActivityMessage(mensaje)) ?? null;
  const resolvedId = existing?.id ?? snapshot.id;
  const nextItem: SharedInboxConversationItem = {
    id: resolvedId,
    source: existing?.source ?? "agent",
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    channelId: snapshot.channelId ?? existing?.channelId ?? null,
    // El realtime no manda el nombre de la linea: sin conservar el que ya tenia, un mensaje
    // nuevo hacia desaparecer la etiqueta de la fila (Alex, 22-sep-2026).
    channelName: snapshot.channelName ?? existing?.channelName ?? null,
    label: snapshot.label ?? existing?.label ?? snapshot.id,
    secondaryLabel: snapshot.secondaryLabel ?? existing?.secondaryLabel ?? "",
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: existing?.channelType ?? inferChannelTypeFromId(resolvedId),
    // Preservar la etapa del CRM: sin esto, un update de realtime reconstruía el item SIN
    // crmStage y la pastillita "Frío/Tibio" de la fila desaparecía al cambiar de etapa.
    crmStage: snapshot.crmStage ?? existing?.crmStage ?? null,
    /*
      El dueño sale del chat abierto, que lo trae fresco en cada refresco.

      Antes se conservaba SIEMPRE el que ya tenia la fila, asi que un cambio de dueño no llegaba
      nunca: la fila decia una asesora y el panel de la derecha otra. Cuando el chat viene sin el
      dato -no todos los caminos lo mandan- se conserva el de antes, que es mejor que borrarlo.
    */
    assignedToName:
      snapshot.assignedTo !== undefined
        ? snapshot.assignedTo?.name?.trim() || snapshot.assignedTo?.email || null
        : existing?.assignedToName ?? null,
    // Lo que usa la barra del chat al tocar la fila: fresco del chat abierto, o el que ya tenia.
    assignedToUserId:
      snapshot.assignedTo !== undefined ? snapshot.assignedTo?.id ?? null : existing?.assignedToUserId,
    // El segundo asesor, igual: fresco si el chat lo trae, y si no el que ya tenia la fila.
    segundoAsesorId: snapshot.segundoAsesorId !== undefined ? snapshot.segundoAsesorId : existing?.segundoAsesorId,
    segundoAsesorNombre:
      snapshot.segundoAsesorId !== undefined ? snapshot.segundoAsesorNombre ?? null : existing?.segundoAsesorNombre,
    automationPaused: snapshot.automationPaused ?? existing?.automationPaused,
    status: snapshot.status ?? existing?.status ?? null,
    // Esta funcion solo actualiza la conversacion abierta: el usuario la esta viendo,
    // asi que no hay mensajes sin leer.
    incomingCount: 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: latestMessage ? getMessagePreviewText(latestMessage) : existing?.lastMessage ?? null,
    lastMessageType: latestMessage?.type ?? existing?.lastMessageType ?? null,
    lastMessageDirection: latestMessage?.direction ?? existing?.lastMessageDirection ?? null,
    // El chulito de la fila. Sin esto, en el chat el mensaje pasaba a ENTREGADO (dos chulitos) y
    // en la lista se quedaba en ENVIADO (uno) hasta recargar la pagina.
    lastMessageStatus:
      latestMessage?.outboundStatusLabel ?? existing?.lastMessageStatus ?? null,
    lastMessageAt: latestMessage?.createdAt ?? existing?.lastMessageAt ?? null,
    // Abrir el chat borra el contador verde (arriba), pero NO la marca "Sin responder": esa solo
    // la quita una respuesta de verdad.
    sinResponderDesde: latestMessage
      ? sinResponderTrasMensaje(existing?.sinResponderDesde, {
          direccion: latestMessage.direction,
          tipo: latestMessage.type,
          status: latestMessage.outboundStatusLabel,
          fecha: latestMessage.createdAt,
        })
      : existing?.sinResponderDesde,
    href: existing?.href ?? "",
  };

  return nextItem;
}

export function buildConversationItemFromListSnapshot(
  snapshot: LiveConversationListSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  const lastMessage = snapshot.lastMessage?.trim() || null;
  const isMediaPreviewType =
    snapshot.lastMessageType === "AUDIO" ||
    snapshot.lastMessageType === "IMAGE" ||
    snapshot.lastMessageType === "VIDEO" ||
    snapshot.lastMessageType === "STICKER" ||
    snapshot.lastMessageType === "DOCUMENT";

  return {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? (snapshot.channelType === "whatsapp_official" ? "official" : "agent"),
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    channelId: snapshot.channelId ?? existing?.channelId ?? null,
    // El realtime no manda el nombre de la linea: sin conservar el que ya tenia, un mensaje
    // nuevo hacia desaparecer la etiqueta de la fila (Alex, 22-sep-2026).
    channelName: snapshot.channelName ?? existing?.channelName ?? null,
    label: snapshot.label ?? existing?.label ?? snapshot.id,
    secondaryLabel: snapshot.secondaryLabel ?? existing?.secondaryLabel ?? "",
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: snapshot.channelType ?? existing?.channelType ?? inferChannelTypeFromId(existing?.id ?? snapshot.id),
    // Preservar/actualizar la etapa del CRM: el snapshot la trae fresca (p.ej. al cambiar a
    // "Tibio") y, si no, se conserva la del existing en vez de perder la pastillita de la fila.
    crmStage: snapshot.crmStage ?? existing?.crmStage ?? null,
    assignedToName: snapshot.assignedToName ?? existing?.assignedToName ?? null,
    assignedToUserId:
      snapshot.assignedToUserId !== undefined ? snapshot.assignedToUserId : existing?.assignedToUserId,
    // Una actualizacion en vivo que no trae el segundo asesor no lo borra.
    segundoAsesorId: snapshot.segundoAsesorId !== undefined ? snapshot.segundoAsesorId : existing?.segundoAsesorId,
    segundoAsesorNombre:
      snapshot.segundoAsesorId !== undefined ? snapshot.segundoAsesorNombre ?? null : existing?.segundoAsesorNombre,
    automationPaused: snapshot.automationPaused ?? existing?.automationPaused,
    status: snapshot.status ?? existing?.status ?? null,
    incomingCount: snapshot.incomingCount ?? existing?.incomingCount ?? 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: lastMessage || (isMediaPreviewType ? null : existing?.lastMessage ?? null),
    lastMessageType: snapshot.lastMessageType ?? existing?.lastMessageType ?? null,
    lastMessageDirection: snapshot.lastMessageDirection ?? existing?.lastMessageDirection ?? null,
    lastMessageStatus: snapshot.lastMessageStatus ?? existing?.lastMessageStatus ?? null,
    // No usar existing como fallback para lastMessageAt: si el snapshot trae null pero existing
    // tiene una fecha vieja, el item quedaría anclado en su posición anterior en el sort.
    lastMessageAt: snapshot.lastMessageAt ?? null,
    /*
      Si el aviso trae el dato del servidor (incluido null = ya contestado) manda ese. Si no, se
      calcula con el mensaje que trae. NO usar `??`: un null perderia contra el valor viejo y la
      marca quedaria pegada.
    */
    sinResponderDesde:
      snapshot.sinResponderDesde !== undefined
        ? snapshot.sinResponderDesde
        : sinResponderTrasMensaje(existing?.sinResponderDesde, {
            direccion: snapshot.lastMessageDirection,
            tipo: snapshot.lastMessageType,
            status: snapshot.lastMessageStatus,
            fecha: snapshot.lastMessageAt,
          }),
    href: existing?.href ?? "",
  };
}

/**
 * `ordenDelServidor`: la vista "Esperando" va ordenada por quien mas lleva esperando, no por el
 * ultimo mensaje. Ahi no se reordena nada y un chat que no esta en la lista no entra por aca: lo
 * trae /list, que es quien sabe si espera.
 */
type OpcionesDeOrden = { ordenDelServidor?: boolean };

export function sortConversationItems(items: SharedInboxConversationItem[], opciones: OpcionesDeOrden = {}) {
  if (opciones.ordenDelServidor) return [...items];
  return [...items].sort((left, right) => {
    const leftAt = getConversationLastMessageTimestamp(left.lastMessageAt);
    const rightAt = getConversationLastMessageTimestamp(right.lastMessageAt);
    return rightAt - leftAt;
  });
}

export function insertConversationItemByTimestamp(
  items: SharedInboxConversationItem[],
  item: SharedInboxConversationItem,
  opciones: OpcionesDeOrden = {},
) {
  // En "Esperando" no se mete un chat por su fecha: la lista queda como estaba.
  if (opciones.ordenDelServidor) return items;
  const itemAt = getConversationLastMessageTimestamp(item.lastMessageAt);
  let insertIndex = 0;

  while (insertIndex < items.length && getConversationLastMessageTimestamp(items[insertIndex]?.lastMessageAt) > itemAt) {
    insertIndex += 1;
  }

  return [
    ...items.slice(0, insertIndex),
    item,
    ...items.slice(insertIndex),
  ];
}

export function updateConversationItemInSortedList(
  current: SharedInboxConversationItem[],
  snapshotId: string,
  nextItem: SharedInboxConversationItem,
  opciones: OpcionesDeOrden = {},
) {
  const currentIndex = current.findIndex((item) => conversationIdMatchesKey(item.id, snapshotId));
  if (currentIndex === -1) {
    const nextItems = insertConversationItemByTimestamp(current, nextItem, opciones);
    return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
      ? current
      : nextItems;
  }

  const currentItem = current[currentIndex];
  if (areConversationListItemsEqual(currentItem, nextItem)) {
    return current;
  }

  const currentAt = getConversationLastMessageTimestamp(currentItem.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(nextItem.lastMessageAt);

  // En "Esperando" la fila se actualiza en su lugar: no sube por tener un mensaje nuevo.
  if (currentAt === nextAt || opciones.ordenDelServidor) {
    const nextItems = [...current];
    nextItems[currentIndex] = nextItem;
    return nextItems;
  }

  const withoutCurrent = current.filter((_, index) => index !== currentIndex);
  const nextItems = insertConversationItemByTimestamp(withoutCurrent, nextItem);

  return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
    ? current
    : nextItems;
}

export function mergeConversationListItem(
  next: SharedInboxConversationItem,
  existing?: SharedInboxConversationItem | null,
) {
  if (!existing) {
    return next;
  }

  const existingAt = getConversationLastMessageTimestamp(existing.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(next.lastMessageAt);

  // La etapa del CRM no viaja en los snapshots de realtime; si el update entrante no la trae,
  // conservamos la que ya teniamos para que el badge no desaparezca hasta la proxima carga.
  const crmStage = next.crmStage ?? existing.crmStage ?? null;
  /*
    "Sin responder" sale de `next` siempre que lo traiga, tambien cuando `existing` es mas nuevo:
    si no, un envio propio que fallo dejaria la marca quitada para siempre en vez de volver con el
    siguiente refresco del servidor. Solo si `next` no trae el dato se conserva el de antes.
  */
  const sinResponderDesde =
    next.sinResponderDesde !== undefined ? next.sinResponderDesde : existing.sinResponderDesde;

  if (existingAt <= nextAt) {
    return { ...next, crmStage, sinResponderDesde };
  }

  return {
    ...next,
    crmStage,
    sinResponderDesde,
    incomingCount: Math.max(existing.incomingCount ?? 0, next.incomingCount ?? 0),
    // Si ya tenemos una versión más reciente del preview en memoria, debemos
    // conservarla completa para no mezclar contenido viejo con timestamps nuevos.
    lastMessage: existing.lastMessage ?? next.lastMessage ?? null,
    lastMessageType: existing.lastMessageType ?? next.lastMessageType ?? null,
    lastMessageDirection: existing.lastMessageDirection ?? next.lastMessageDirection ?? null,
    lastMessageStatus: existing.lastMessageStatus ?? next.lastMessageStatus ?? null,
    lastMessageAt: existing.lastMessageAt ?? next.lastMessageAt ?? null,
  };
}

export function areTagListsEqual(
  left: SharedInboxConversationItem["tags"],
  right: SharedInboxConversationItem["tags"],
) {
  if (left === right) {
    return true;
  }

  if ((left?.length ?? 0) !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < (left?.length ?? 0); index += 1) {
    const leftTag = left?.[index];
    const rightTag = right?.[index];

    if (!leftTag || !rightTag || leftTag.label !== rightTag.label || leftTag.color !== rightTag.color) {
      return false;
    }
  }

  return true;
}

export function areConversationListItemsEqual(
  left: SharedInboxConversationItem,
  right: SharedInboxConversationItem,
) {
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.agentId === right.agentId &&
    left.contactId === right.contactId &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.assignedToName === right.assignedToName &&
    // Los de la barra del chat: si no, quedaba el valor viejo para dibujarla al tocar la fila.
    (left.assignedToUserId ?? null) === (right.assignedToUserId ?? null) &&
    (left.segundoAsesorId ?? null) === (right.segundoAsesorId ?? null) &&
    (left.segundoAsesorNombre ?? null) === (right.segundoAsesorNombre ?? null) &&
    (left.automationPaused ?? null) === (right.automationPaused ?? null) &&
    // La linea y el estado tambien: si no, la fila que llegaba sin linea se quedaba asi aunque la
    // recarga la trajera, y la linea "aparecia al rato" o nunca (Alex, 02-10-2026).
    (left.channelName ?? null) === (right.channelName ?? null) &&
    (left.status ?? null) === (right.status ?? null) &&
    // Sin esto, un cambio de etapa que no toca el ultimo mensaje se considera "igual" y el badge
    // no se refresca hasta recargar.
    (left.crmStage ?? null) === (right.crmStage ?? null) &&
    left.lastMessage === right.lastMessage &&
    left.lastMessageType === right.lastMessageType &&
    left.lastMessageDirection === right.lastMessageDirection &&
    // Sin esto, pasar de ENVIADO a ENTREGADO se considera "la misma fila" y el chulito no cambia.
    (left.lastMessageStatus ?? null) === (right.lastMessageStatus ?? null) &&
    getConversationLastMessageTimestamp(left.lastMessageAt) === getConversationLastMessageTimestamp(right.lastMessageAt) &&
    // Por tiempo (puede venir como Date o como texto): sin esto, quitar o poner la marca "Sin
    // responder" se consideraba "la misma fila" y no se veia.
    getConversationLastMessageTimestamp(left.sinResponderDesde) === getConversationLastMessageTimestamp(right.sinResponderDesde) &&
    left.incomingCount === right.incomingCount &&
    left.channelType === right.channelType &&
    left.href === right.href &&
    areTagListsEqual(left.tags ?? [], right.tags ?? [])
  );
}

export function areMessageItemsEqual(
  left: SharedInboxMessageItem,
  right: SharedInboxMessageItem,
) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    left.rawPayload === right.rawPayload &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    (left.editedAt?.getTime() ?? 0) === (right.editedAt?.getTime() ?? 0) &&
    (left.deletedAt?.getTime() ?? 0) === (right.deletedAt?.getTime() ?? 0)
  );
}

function sonLaMismaLlamada(
  left: SharedInboxSelectedConversation["ultimaLlamada"],
  right: SharedInboxSelectedConversation["ultimaLlamada"],
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.id === right.id &&
    left.etiqueta === right.etiqueta &&
    left.pendiente === right.pendiente &&
    left.noContesto === right.noContesto &&
    left.resumen === right.resumen &&
    left.calledAt === right.calledAt &&
    left.intento === right.intento
  );
}

export function areSelectedConversationsEqual(
  left: SharedInboxSelectedConversation,
  right: SharedInboxSelectedConversation,
) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.contactId === right.contactId &&
    left.contactName === right.contactName &&
    left.avatarUrl === right.avatarUrl &&
    left.automationPaused === right.automationPaused &&
    /*
      Los datos de la cabecera y de la ficha tambien cuentan como cambio.

      El chat se abre primero con lo que hay en la cache del navegador, que no guarda el estado ni
      la asignacion, y despues llega /live con los datos de verdad. Si esta comparacion no los
      miraba, la respuesta fresca se descartaba por "igual" y quedaban los de la cache: un chat
      resuelto mostraba "Resolver" en vez de "Reabrir" (Alex, 02-10-2026) y la asignada tardaba
      en aparecer o salia la de antes.
    */
    (left.status ?? null) === (right.status ?? null) &&
    (left.crmStage ?? null) === (right.crmStage ?? null) &&
    Boolean(left.cierrePendiente) === Boolean(right.cierrePendiente) &&
    (left.channelId ?? null) === (right.channelId ?? null) &&
    (left.channelName ?? null) === (right.channelName ?? null) &&
    (left.assignedTo?.id ?? null) === (right.assignedTo?.id ?? null) &&
    (left.assignedTo?.name ?? null) === (right.assignedTo?.name ?? null) &&
    (left.segundoAsesorId ?? null) === (right.segundoAsesorId ?? null) &&
    (left.segundoAsesorNombre ?? null) === (right.segundoAsesorNombre ?? null) &&
    Boolean(left.canImportHistory) === Boolean(right.canImportHistory) &&
    // La ultima llamada llega con /live: sin esto, si los mensajes eran los mismos de la cache, la
    // respuesta se descartaba por "igual" y el aviso no aparecia.
    sonLaMismaLlamada(left.ultimaLlamada, right.ultimaLlamada) &&
    // El fijado llega con /live: sin esto, fijar o desfijar no se veia hasta que cambiara otra cosa.
    (left.mensajeFijado?.id ?? null) === (right.mensajeFijado?.id ?? null) &&
    (left.mensajeFijado?.texto ?? null) === (right.mensajeFijado?.texto ?? null) &&
    (left.mensajeFijado?.tipo ?? null) === (right.mensajeFijado?.tipo ?? null) &&
    left.loadMoreHref === right.loadMoreHref &&
    left.loadMoreCursor === right.loadMoreCursor &&
    left.hasMoreMessages === right.hasMoreMessages &&
    left.cacheKey === right.cacheKey &&
    left.isPreview === right.isPreview &&
    areTagListsEqual(left.tags ?? [], right.tags ?? []) &&
    left.messages.length === right.messages.length &&
    left.messages.every((message, index) => areMessageItemsEqual(message, right.messages[index]!))
  );
}

export function mergeConversationSnapshotIfChanged(
  existing: SharedInboxSelectedConversation | null,
  next: SharedInboxSelectedConversation | null,
) {
  const merged = mergeConversationSnapshots(existing, next);
  if (!existing || !merged) {
    return merged;
  }

  return areSelectedConversationsEqual(existing, merged) ? existing : merged;
}

export function updateConversationItemByContact(
  current: SharedInboxConversationItem[],
  contactId: string,
  updater: (item: SharedInboxConversationItem) => SharedInboxConversationItem,
) {
  let changed = false;
  const nextItems = current.map((item) => {
    if (item.contactId !== contactId) {
      return item;
    }

    changed = true;
    return updater(item);
  });

  return changed ? nextItems : current;
}
