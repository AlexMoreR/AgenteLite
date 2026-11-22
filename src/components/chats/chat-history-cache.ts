"use client";

import type { SharedInboxMessageItem, SharedInboxSelectedConversation } from "./chat-inbox-types";
import { alCambiarElDueno, duenoDelGuardado } from "./guardado-local/dueno";
import { MAX_HORAS_DEL_GUARDADO } from "./guardado-local/reglas";

type CachedMessageItem = Omit<SharedInboxMessageItem, "createdAt" | "editedAt" | "deletedAt"> & {
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
};

type CachedConversation = Omit<SharedInboxSelectedConversation, "messages"> & {
  messages: CachedMessageItem[];
  cachedAt: number;
};

type ConversationCacheStore = {
  version: 1;
  conversations: Record<string, CachedConversation>;
};

// v2: la v1 guardaba los adjuntos en base64 (ver stripBase64Attachments). Se cambia la clave
// para no arrastrar esas entradas infladas; la v1 se borra al arrancar para liberar su espacio.
// v3 (P5, T2): la llave lleva el dueño (negocio + usuario + version, ver guardado-local/dueno.ts).
// Sin dueño no se lee ni se guarda nada. La v2 (sin dueño) se borra: cada chat se pide una vez mas.
const PREFIJO_DE_LA_LLAVE = "aglite:chat-history-cache:v3:";
const LEGACY_STORAGE_KEYS = ["aglite:chat-history-cache:v1", "aglite:chat-history-cache:v2"];
/*
  v4 (22-nov-2026, velocidad de Chats): UNA llave por chat. La v3 guardaba los 80 chats juntos en una
  sola llave (1,8 M de caracteres) y cada guardado la volvia a escribir entera: ~20 ms en un PC y
  unos 80 ms en un celular, con la pantalla trabada, en cada mensaje que llegaba o salia. Ahora se
  escribe solo el chat que cambio (pocos kB). La v3 se pasa a la v4 la primera vez que se lee.
  Formato: "aglite:chat-history-cache:v4:<dueño>|<clave del chat>". El "|" separa: el dueño y la
  clave llevan ":" y ningun id lleva "|".
*/
const PREFIJO_POR_CHAT = "aglite:chat-history-cache:v4:";
/** Nunca se muestra una copia con mas de esto, ni siquiera con ignoreFreshness. */
const CADUCIDAD_DURA_MS = MAX_HORAS_DEL_GUARDADO * 3_600_000;

function llaveDelStore(dueno: string) {
  return `${PREFIJO_DE_LA_LLAVE}${dueno}`;
}

function prefijoDelDueno(dueno: string) {
  return `${PREFIJO_POR_CHAT}${dueno}|`;
}

function llaveDelChat(dueno: string, clave: string) {
  return `${prefijoDelDueno(dueno)}${clave}`;
}
const VISITED_STORAGE_KEY = "aglite:chat-visited:v1";
// Sin el base64 cada chat pesa unos pocos KB en vez de cientos, asi que entran todos y dejamos
// de desalojar. Con el limite viejo (20) y 37 chats, abrir uno echaba a otro y reabrirlo
// obligaba a pedirlo de nuevo al servidor.
const MAX_CACHE_ENTRIES = 80;
const MAX_VISITED_ENTRIES = 200;
/*
  Guardar en el navegador (05-11-2026, "la bandeja se pega"): antes se guardaba el chat ENTERO en
  cada cambio -tambien en cada pagina de mensajes viejos- y con 120 ms de espera, en medio del
  scroll. Ahora se guardan solo los ultimos MAX_MENSAJES_POR_CHAT, con mas espera entre guardados y
  cuando el navegador esta desocupado (requestIdleCallback).
*/
const CACHE_SAVE_DEBOUNCE_MS = 600;
const CACHE_SAVE_IDLE_TIMEOUT_MS = 2000;
export const MAX_MENSAJES_POR_CHAT = 50;

const pendingConversationSaves = new Map<string, SharedInboxSelectedConversation>();
let pendingSaveTimer: number | null = null;
let pendingIdleHandle: number | null = null;
let cachedStore: ConversationCacheStore | null = null;
/** De quien es `cachedStore`: si el dueño cambia, la copia en memoria no sirve. */
let cachedStoreDueno: string | null = null;
let cachedVisitedStore: Record<string, number> | null = null;
let storageListenerAttached = false;
/*
  Lo que esta escrito en el navegador, chat por chat (la misma referencia que en `cachedStore`).
  writeStore compara contra esto y escribe solo los chats que cambiaron y borra los que salieron.
  Se arma al leer el guardado y se olvida junto con `cachedStore`.
*/
let persistidos = new Map<string, CachedConversation>();

function isBrowser() {
  return typeof window !== "undefined";
}

/** Lo que vive en memoria se olvida al cambiar el dueño (lo del navegador ya lo borro dueno.ts). */
function olvidarLoDeMemoria() {
  pendingConversationSaves.clear();
  if (pendingSaveTimer !== null && isBrowser()) {
    window.clearTimeout(pendingSaveTimer);
  }
  pendingSaveTimer = null;
  cachedStore = null;
  cachedStoreDueno = null;
  cachedVisitedStore = null;
  persistidos = new Map();
}
alCambiarElDueno(olvidarLoDeMemoria);

function invalidateCaches(event?: StorageEvent) {
  if (
    event &&
    event.key &&
    !event.key.startsWith("aglite:chat-history-cache") &&
    event.key !== VISITED_STORAGE_KEY &&
    event.key !== "aglite:dueno-del-guardado"
  ) {
    return;
  }

  cachedStore = null;
  cachedStoreDueno = null;
  cachedVisitedStore = null;
  persistidos = new Map();
}

function ensureStorageListeners() {
  if (!isBrowser() || storageListenerAttached) {
    return;
  }

  window.addEventListener("storage", invalidateCaches);
  storageListenerAttached = true;
}

function readStore(): ConversationCacheStore {
  ensureStorageListeners();

  // Sin dueño (o apagado) no se lee nada: ni lo del navegador ni lo que quedo en memoria.
  const dueno = isBrowser() ? duenoDelGuardado() : null;
  if (!dueno) {
    return { version: 1, conversations: {} };
  }

  if (cachedStore && cachedStoreDueno === dueno) {
    return cachedStore;
  }
  cachedStore = null;

  // La cache v1 quedaria ocupando espacio muerto (medido: 1.3 MB) sin que nadie la lea.
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(legacyKey);
    } catch {
      // Sin permisos de storage no hay nada que limpiar.
    }
  }

  const conversations: Record<string, CachedConversation> = {};
  const leidos = new Map<string, CachedConversation>();
  try {
    const almacen = window.localStorage;
    const prefijo = prefijoDelDueno(dueno);

    // Lo de la v3 (todos juntos en una llave) se pasa a una llave por chat, una sola vez.
    const raw = almacen.getItem(llaveDelStore(dueno));
    if (raw !== null) {
      try {
        const viejo = JSON.parse(raw) as ConversationCacheStore | null;
        if (viejo && viejo.version === 1 && typeof viejo.conversations === "object" && viejo.conversations !== null) {
          for (const [clave, conversacion] of Object.entries(viejo.conversations)) {
            if (esCopiaValida(conversacion)) {
              conversations[clave] = conversacion;
            }
          }
        }
      } catch {
        // Ilegible: se descarta, cada chat se vuelve a pedir.
      }
      try {
        almacen.removeItem(llaveDelStore(dueno));
      } catch {
        // Sin permiso para borrar: se vuelve a intentar la proxima vez.
      }
    }

    const claves: string[] = [];
    for (let indice = 0; indice < almacen.length; indice += 1) {
      const clave = almacen.key(indice);
      if (clave?.startsWith(prefijo)) {
        claves.push(clave);
      }
    }
    for (const llave of claves) {
      const clave = llave.slice(prefijo.length);
      try {
        const conversacion = JSON.parse(almacen.getItem(llave) ?? "null") as CachedConversation | null;
        if (!clave || !esCopiaValida(conversacion)) {
          almacen.removeItem(llave);
          continue;
        }
        // Si la v3 tambien lo traia, gana la copia mas nueva.
        const deLaV3 = conversations[clave];
        if (!deLaV3 || conversacion.cachedAt >= deLaV3.cachedAt) {
          conversations[clave] = conversacion;
        }
        if (conversations[clave] === conversacion) {
          leidos.set(clave, conversacion);
        }
      } catch {
        // Un chat ilegible no tumba a los demas.
      }
    }
  } catch {
    return { version: 1, conversations: {} };
  }

  const store: ConversationCacheStore = { version: 1, conversations };
  cachedStore = store;
  cachedStoreDueno = dueno;
  persistidos = leidos;
  // Lo que vino de la v3 (o gano sobre la v4) queda escrito ya en su propia llave.
  if (Object.keys(conversations).length !== leidos.size) {
    writeStore(trimStore(store));
  }
  return cachedStore;
}

function esCopiaValida(valor: unknown): valor is CachedConversation {
  if (!valor || typeof valor !== "object") return false;
  const copia = valor as Partial<CachedConversation>;
  return typeof copia.id === "string" && Array.isArray(copia.messages) && typeof copia.cachedAt === "number";
}

function writeStore(store: ConversationCacheStore) {
  if (!isBrowser()) {
    return;
  }

  // Sin dueño no se guarda nada, ni en memoria: la proxima lectura tampoco tendria dueño.
  const dueno = duenoDelGuardado();
  if (!dueno) {
    cachedStore = null;
    cachedStoreDueno = null;
    persistidos = new Map();
    return;
  }
  if (cachedStoreDueno !== dueno) {
    // Lo anotado era de otro dueño (sus llaves ya las borro dueno.ts).
    persistidos = new Map();
  }
  cachedStore = store;
  cachedStoreDueno = dueno;

  let almacen: Storage;
  try {
    almacen = window.localStorage;
  } catch {
    return;
  }

  // Los que salieron (recortados o borrados): se borra su llave.
  for (const clave of [...persistidos.keys()]) {
    if (!(clave in store.conversations)) {
      try {
        almacen.removeItem(llaveDelChat(dueno, clave));
      } catch {
        // Sigue con los demas.
      }
      persistidos.delete(clave);
    }
  }

  // Solo se escriben los que cambiaron: guardarPendientes pone un objeto nuevo en cada chat que cambia.
  for (const [clave, conversacion] of Object.entries(store.conversations)) {
    if (persistidos.get(clave) === conversacion) {
      continue;
    }
    const texto = JSON.stringify(conversacion);
    if (escribirChat(almacen, dueno, clave, texto)) {
      persistidos.set(clave, conversacion);
      continue;
    }
    /*
      Sin espacio (cuota): se quedan la mitad de los chats, los guardados mas recientemente (siempre
      con este), y se intenta UNA vez mas. Antes el guardado quedaba roto y todos los chats volvian a
      pedirse al servidor.
    */
    for (const sobrante of mitadMasVieja(store, clave)) {
      delete store.conversations[sobrante];
      try {
        almacen.removeItem(llaveDelChat(dueno, sobrante));
      } catch {
        // Sigue con los demas.
      }
      persistidos.delete(sobrante);
    }
    if (escribirChat(almacen, dueno, clave, texto)) {
      persistidos.set(clave, conversacion);
      continue;
    }
    // Callarlo hacia que el sintoma (abrir un chat va lento) no tuviera ninguna pista.
    console.warn("[chat-cache] no se pudo guardar la cache de chats", {
      chats: Object.keys(store.conversations).length,
      kb: Math.round(texto.length / 1024),
    });
  }
}

function escribirChat(almacen: Storage, dueno: string, clave: string, texto: string) {
  try {
    almacen.setItem(llaveDelChat(dueno, clave), texto);
    return true;
  } catch {
    return false;
  }
}

/** La mitad de los chats guardados hace mas tiempo (por cachedAt), sin contar `quedarse`. */
function mitadMasVieja(store: ConversationCacheStore, quedarse: string): string[] {
  const entries = Object.entries(store.conversations).sort((left, right) => right[1].cachedAt - left[1].cachedAt);
  const conservar = new Set(entries.slice(0, Math.floor(entries.length / 2)).map(([clave]) => clave));
  conservar.add(quedarse);
  return entries.map(([clave]) => clave).filter((clave) => !conservar.has(clave));
}

function readVisitedStore(): Record<string, number> {
  ensureStorageListeners();

  if (cachedVisitedStore) {
    return cachedVisitedStore;
  }

  if (!isBrowser()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(VISITED_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, number> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    cachedVisitedStore = parsed;
    return parsed;
  } catch {
    return {};
  }
}

function writeVisitedStore(store: Record<string, number>) {
  cachedVisitedStore = store;

  // Sin dueño tampoco se anota que chats se visitaron (se borraria al fijar el dueño igual).
  if (!isBrowser() || !duenoDelGuardado()) {
    return;
  }

  try {
    window.localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

function trimVisitedStore(store: Record<string, number>) {
  const entries = Object.entries(store);
  if (entries.length <= MAX_VISITED_ENTRIES) {
    return store;
  }

  const sorted = entries.sort((left, right) => right[1] - left[1]).slice(0, MAX_VISITED_ENTRIES);
  return Object.fromEntries(sorted);
}

function normalizeVisitedKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function normalizeConversationCacheKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

export function markConversationAsVisited(conversationId: string) {
  const normalizedConversationId = normalizeVisitedKey(conversationId);
  if (!normalizedConversationId) {
    return;
  }

  const store = readVisitedStore();
  store[normalizedConversationId] = Date.now();
  writeVisitedStore(trimVisitedStore(store));
}

export function hasConversationBeenVisited(conversationId: string) {
  const normalizedConversationId = normalizeVisitedKey(conversationId);
  if (!normalizedConversationId) {
    return false;
  }

  const store = readVisitedStore();
  return normalizedConversationId in store;
}

function trimStore(store: ConversationCacheStore) {
  const entries = Object.entries(store.conversations);
  if (entries.length <= MAX_CACHE_ENTRIES) {
    return store;
  }

  const sorted = entries.sort((left, right) => right[1].cachedAt - left[1].cachedAt).slice(0, MAX_CACHE_ENTRIES);
  return {
    version: 1 as const,
    conversations: Object.fromEntries(sorted),
  };
}

function normalizeSerializableDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.toISOString();
}

/**
 * Saca del rawPayload el archivo adjunto en base64 antes de guardarlo en localStorage.
 *
 * Evolution manda el archivo COMPLETO codificado dentro del payload
 * (`evolution.data.Message.base64`). Medido en produccion: 296 KB en un solo mensaje, 352 de
 * los 360 KB que ocupaba ese chat. El navegador nunca lo lee —los adjuntos se muestran con
 * `mediaUrl` y las miniaturas con `jpegThumbnail`— pero se cacheaba igual, inflando la cache
 * ~170x. Con 1.3 MB ocupados solo entraban 20 de los 37 chats, asi que abrir un chat
 * desalojaba a otro y reabrirlo obligaba a pedirlo de nuevo al servidor: por eso algunos
 * chats abrian al instante y otros no.
 *
 * OJO: `jpegThumbnail` NO se toca, se usa para la vista previa (ver chat-inbox-media.ts).
 */
function stripBase64Attachments(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripBase64Attachments(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // Solo el adjunto crudo: la miniatura (jpegThumbnail) tiene otra clave y se conserva.
    if (key === "base64" && typeof item === "string") {
      continue;
    }
    result[key] = stripBase64Attachments(item, depth + 1);
  }

  return result;
}

function serializeConversation(conversation: SharedInboxSelectedConversation): CachedConversation {
  // Se recorta ANTES de copiar: con 300 mensajes cargados no se copian los 300 para tirar 250.
  conversation = recortarParaGuardar(conversation);
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      rawPayload: stripBase64Attachments(message.rawPayload),
      createdAt: normalizeSerializableDate(message.createdAt) ?? new Date().toISOString(),
      editedAt: normalizeSerializableDate(message.editedAt),
      deletedAt: normalizeSerializableDate(message.deletedAt),
    })),
    cachedAt: Date.now(),
  };
}

function normalizeConversationStoreKey(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function getMessageCreatedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  return typeof message.createdAt === "string" ? new Date(message.createdAt).getTime() : message.createdAt.getTime();
}

function toCachedMessageItem(
  message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
): CachedMessageItem {
  return {
    ...message,
    // Los mensajes que entran en vivo pasan por aca: sin esto el base64 se vuelve a colar.
    rawPayload: stripBase64Attachments(message.rawPayload),
    createdAt: typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    editedAt:
      "editedAt" in message && message.editedAt
        ? typeof message.editedAt === "string"
          ? message.editedAt
          : message.editedAt.toISOString()
        : null,
    deletedAt:
      "deletedAt" in message && message.deletedAt
        ? typeof message.deletedAt === "string"
          ? message.deletedAt
          : message.deletedAt.toISOString()
        : null,
  };
}

function areCachedTagListsEqual(
  left: SharedInboxSelectedConversation["tags"],
  right: SharedInboxSelectedConversation["tags"],
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

function getMessageEditedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  if (!("editedAt" in message) || !message.editedAt) {
    return null;
  }

  return typeof message.editedAt === "string" ? new Date(message.editedAt).getTime() : message.editedAt.getTime();
}

function getMessageDeletedAtTime(message: CachedMessageItem | SharedInboxSelectedConversation["messages"][number]) {
  if (!("deletedAt" in message) || !message.deletedAt) {
    return null;
  }

  return typeof message.deletedAt === "string" ? new Date(message.deletedAt).getTime() : message.deletedAt.getTime();
}

/** Cuando el cliente escucho un audio nuestro (lo deja el acuse 4 de WAHA en el payload). */
function leerReproducidoAt(message: unknown): string | null {
  const payload = (message as { rawPayload?: unknown }).rawPayload;
  const valor = payload && typeof payload === "object" ? (payload as { reproducidoAt?: unknown }).reproducidoAt : null;
  return typeof valor === "string" ? valor : null;
}

function areMergedMessagesEqual(
  left: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
  right: CachedMessageItem | SharedInboxSelectedConversation["messages"][number],
) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    // La reaccion cambia un mensaje que YA existe: sin compararla, el merge daba los dos mensajes
    // por iguales, se quedaba con el viejo y el emoji no aparecia hasta recargar.
    (left.reactionEmoji ?? null) === (right.reactionEmoji ?? null) &&
    // Igual la transcripcion: llega un minuto despues que el audio. Sin compararla, el merge se
    // quedaba con el mensaje viejo y el texto no aparecia nunca.
    (left.transcripcion ?? null) === (right.transcripcion ?? null) &&
    // Lo mismo con el audio escuchado por el cliente: vive en el payload y cambia un mensaje viejo.
    leerReproducidoAt(left) === leerReproducidoAt(right) &&
    getMessageCreatedAtTime(left) === getMessageCreatedAtTime(right) &&
    getMessageEditedAtTime(left) === getMessageEditedAtTime(right) &&
    getMessageDeletedAtTime(left) === getMessageDeletedAtTime(right)
  );
}

function areCachedMessagesEqual(left: CachedMessageItem, right: CachedMessageItem) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    (left.transcripcion ?? null) === (right.transcripcion ?? null) &&
    left.createdAt === right.createdAt &&
    left.editedAt === right.editedAt &&
    left.deletedAt === right.deletedAt
  );
}

function areCachedConversationsEqual(left: CachedConversation, right: CachedConversation) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.contactId === right.contactId &&
    left.contactName === right.contactName &&
    left.automationPaused === right.automationPaused &&
    left.loadMoreHref === right.loadMoreHref &&
    left.loadMoreCursor === right.loadMoreCursor &&
    left.hasMoreMessages === right.hasMoreMessages &&
    left.cacheKey === right.cacheKey &&
    left.isPreview === right.isPreview &&
    areCachedTagListsEqual(left.tags, right.tags) &&
    left.messages.length === right.messages.length &&
    left.messages.every((message, index) => areCachedMessagesEqual(message, right.messages[index]!))
  );
}

function mergeCachedMessages(
  existing: CachedMessageItem[] | SharedInboxSelectedConversation["messages"],
  next: CachedMessageItem[] | SharedInboxSelectedConversation["messages"],
) {
  const messages = new Map<string, CachedMessageItem>();

  for (const message of existing) {
    messages.set(message.id, toCachedMessageItem(message));
  }

  for (const message of next) {
    const existingMessage = messages.get(message.id);
    if (existingMessage && areMergedMessagesEqual(existingMessage, message)) {
      continue;
    }

    messages.set(message.id, toCachedMessageItem(message));
  }

  return Array.from(messages.values()).sort((left, right) => {
    const leftAt = getMessageCreatedAtTime(left);
    const rightAt = getMessageCreatedAtTime(right);

    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }

    return left.id.localeCompare(right.id);
  });
}

export function mergeConversationSnapshots(
  existing: SharedInboxSelectedConversation | null,
  next: SharedInboxSelectedConversation | null,
) {
  if (!existing) {
    return next;
  }

  if (!next) {
    return existing;
  }

  if (existing.isPreview && !next.isPreview) {
    return next;
  }

  if (next.isPreview && !existing.isPreview) {
    return existing;
  }

  const nextMessagesById = new Map(next.messages.map((message) => [message.id, message]));
  const mergedMessages: SharedInboxSelectedConversation["messages"] = [];

  for (const existingMessage of existing.messages) {
    const nextMessage = nextMessagesById.get(existingMessage.id);
    if (!nextMessage) {
      mergedMessages.push(existingMessage);
      continue;
    }

    if (areMergedMessagesEqual(existingMessage, nextMessage)) {
      mergedMessages.push(existingMessage);
    } else {
      mergedMessages.push(nextMessage);
    }

    nextMessagesById.delete(existingMessage.id);
  }

  for (const nextMessage of nextMessagesById.values()) {
    mergedMessages.push(nextMessage);
  }

  const mergedTags = next.tags !== undefined ? next.tags : existing.tags;

  return {
    ...existing,
    ...next,
    ...cursorDelHistorial(existing, next),
    tags: mergedTags,
    messages: mergedMessages.sort((left, right) => {
      const leftAt = getMessageCreatedAtTime(left);
      const rightAt = getMessageCreatedAtTime(right);

      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }

      return left.id.localeCompare(right.id);
    }),
  };
}

function mergeCachedConversations(existing: CachedConversation | null, next: CachedConversation): CachedConversation {
  if (!existing) {
    return recortarParaGuardar(next);
  }

  return recortarParaGuardar({
    ...existing,
    ...next,
    ...cursorDelHistorial(existing, next),
    messages: mergeCachedMessages(existing.messages, next.messages),
    cachedAt: Date.now(),
  });
}

type ConMensajesYCursor = {
  messages: Array<CachedMessageItem | SharedInboxSelectedConversation["messages"][number]>;
  loadMoreCursor?: string | null;
  loadMoreHref?: string | null;
  hasMoreMessages?: boolean;
};

function mensajeMasViejo(conversation: ConMensajesYCursor) {
  let masViejo = Number.POSITIVE_INFINITY;
  for (const message of conversation.messages) {
    const at = getMessageCreatedAtTime(message);
    if (Number.isFinite(at) && at < masViejo) {
      masViejo = at;
    }
  }
  return masViejo;
}

/**
 * Hasta donde ya se cargo el historial, al juntar dos copias del mismo chat.
 *
 * Antes ganaba siempre el cursor de la copia NUEVA. Cuando llegaba un mensaje, /live traia solo los
 * mas recientes con su cursor, y ese cursor pisaba el de la copia que ya tenia los viejos cargados:
 * al subir se volvian a pedir mensajes que ya estaban, se encadenaban cargas y el chat brincaba a
 * una posicion vieja. Ahora el cursor es el de la copia que llega MAS atras en el tiempo.
 */
export function cursorDelHistorial(existing: ConMensajesYCursor, next: ConMensajesYCursor) {
  const fuente = fuenteDelCursor(existing, next);
  return {
    loadMoreCursor: fuente.loadMoreCursor ?? null,
    loadMoreHref: fuente.loadMoreHref ?? null,
    // Con cursor y sin el dato, se supone que hay mas: si no hay, el servidor devuelve vacio.
    hasMoreMessages: fuente.hasMoreMessages ?? Boolean(fuente.loadMoreCursor),
  };
}

function fuenteDelCursor(existing: ConMensajesYCursor, next: ConMensajesYCursor) {
  if (mensajeMasViejo(existing) >= mensajeMasViejo(next)) {
    return next;
  }
  /*
    La copia de antes llega mas atras, pero solo vale si las dos se TOCAN: el mensaje mas viejo de
    la nueva tiene que estar en la de antes. Si no (una copia de hace dias y los ultimos de hoy),
    entre las dos hay un hueco, y con el cursor viejo esos mensajes del medio no se pedirian nunca.
  */
  let primeroDeLaNueva: ConMensajesYCursor["messages"][number] | null = null;
  for (const message of next.messages) {
    if (!esMensajeDelServidor(message.id)) {
      continue;
    }
    if (!primeroDeLaNueva || getMessageCreatedAtTime(message) < getMessageCreatedAtTime(primeroDeLaNueva)) {
      primeroDeLaNueva = message;
    }
  }
  if (!primeroDeLaNueva) {
    return existing;
  }
  const idDelPrimero = primeroDeLaNueva.id;
  return existing.messages.some((message) => message.id === idDelPrimero) ? existing : next;
}

function mensajeMasViejoDelServidor(conversation: ConMensajesYCursor) {
  let masViejo: ConMensajesYCursor["messages"][number] | null = null;
  for (const message of conversation.messages) {
    if (!esMensajeDelServidor(message.id)) {
      continue;
    }
    if (!masViejo || getMessageCreatedAtTime(message) < getMessageCreatedAtTime(masViejo)) {
      masViejo = message;
    }
  }
  return masViejo;
}

/**
 * Dos copias del mismo chat se TOCAN si el mensaje mas viejo de una esta en la otra: juntas forman
 * un historial seguido, sin mensajes faltantes en el medio.
 */
export function copiasSeTocan(una: ConMensajesYCursor, otra: ConMensajesYCursor) {
  const masViejoDeOtra = mensajeMasViejoDelServidor(otra);
  if (masViejoDeOtra && una.messages.some((message) => message.id === masViejoDeOtra.id)) {
    return true;
  }
  const masViejoDeUna = mensajeMasViejoDelServidor(una);
  return Boolean(masViejoDeUna && otra.messages.some((message) => message.id === masViejoDeUna.id));
}

/**
 * Sobre que copia guardada se pone lo que trae /live (chats, parte 2, 06-11-2026).
 *
 * La copia tiene hasta MAX_MENSAJES_POR_CHAT mensajes y el /live de apertura solo los ultimos 10.
 * Antes el /live la reemplazaba: el chat pasaba de 50 a 10 mensajes en pantalla, la vista saltaba
 * y, si esos 10 median poco, se disparaba sola una carga de historial. Ahora, si las dos copias se
 * tocan, la copia es la base y se juntan (el cursor queda en el mas viejo de la copia, ver
 * cursorDelHistorial). Si hay un hueco entre las dos, no hay base y se usa solo el /live, como
 * antes: mejor 10 mensajes que un historial con mensajes faltantes.
 *
 * `paginaAnterior`: la pagina se pidio con el cursor de lo que se ve, asi que empalma justo antes
 * del mensaje mas viejo de la copia aunque no compartan ninguno.
 *
 * Quien llama tiene que haber comprobado que las dos son del MISMO chat.
 */
export function copiaComoBase<T extends ConMensajesYCursor>(
  copia: T | null,
  live: ConMensajesYCursor,
  opciones?: { paginaAnterior?: boolean },
): T | null {
  if (!copia) {
    return null;
  }
  return opciones?.paginaAnterior || copiasSeTocan(copia, live) ? copia : null;
}

/** Un id que el servidor reconoce como mensaje (no una llamada metida en el hilo ni uno optimista). */
function esMensajeDelServidor(id: string) {
  return Boolean(id) && !id.startsWith("llamada:") && !id.startsWith("optimistic");
}

/**
 * La copia que se guarda en el navegador lleva como mucho MAX_MENSAJES_POR_CHAT mensajes: los mas
 * nuevos. El cursor pasa a apuntar al mas viejo que quedo, asi al abrir el chat desde la copia y
 * subir se piden justo los que se recortaron, sin saltear ninguno.
 */
export function recortarParaGuardar<T extends ConMensajesYCursor>(conversation: T): T {
  if (conversation.messages.length <= MAX_MENSAJES_POR_CHAT) {
    return conversation;
  }
  const messages = conversation.messages.slice(-MAX_MENSAJES_POR_CHAT);
  const primeroDelServidor = messages.find((message) => esMensajeDelServidor(message.id));
  return {
    ...conversation,
    messages,
    loadMoreCursor: primeroDelServidor?.id ?? conversation.loadMoreCursor ?? null,
    // El enlace viejo apuntaba a otra posicion del historial: con la copia recortada ya no sirve.
    loadMoreHref: null,
    hasMoreMessages: true,
  };
}

function hydrateConversation(conversation: CachedConversation): SharedInboxSelectedConversation {
  return {
    id: conversation.id,
    label: conversation.label,
    secondaryLabel: conversation.secondaryLabel,
    tags: conversation.tags,
    avatarUrl: conversation.avatarUrl ?? null,
    automationPaused: conversation.automationPaused,
    loadMoreHref: conversation.loadMoreHref ?? null,
    loadMoreCursor: conversation.loadMoreCursor ?? null,
    // Sin esto, un chat abierto desde la copia no podia pedir mensajes viejos hasta que llegara /live.
    hasMoreMessages: conversation.hasMoreMessages,
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
      editedAt: message.editedAt ? new Date(message.editedAt) : null,
      deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
    })),
    isPreview: conversation.isPreview,
  };
}

export function saveConversationToCache(conversation: SharedInboxSelectedConversation) {
  if (!isBrowser()) {
    return;
  }

  const conversationKey = normalizeConversationStoreKey(conversation.id);
  // Sin dueño ni siquiera queda esperando: no se leeria ni se guardaria.
  if (!conversationKey || !duenoDelGuardado()) {
    return;
  }

  pendingConversationSaves.set(conversationKey, conversation);

  if (pendingSaveTimer !== null) {
    window.clearTimeout(pendingSaveTimer);
  }

  pendingSaveTimer = window.setTimeout(() => {
    pendingSaveTimer = null;
    // Ya hay un guardado esperando que el navegador se desocupe: ese se lleva lo ultimo.
    if (pendingIdleHandle !== null) {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      pendingIdleHandle = window.requestIdleCallback(
        () => {
          pendingIdleHandle = null;
          guardarPendientes();
        },
        { timeout: CACHE_SAVE_IDLE_TIMEOUT_MS },
      );
      return;
    }
    guardarPendientes();
  }, CACHE_SAVE_DEBOUNCE_MS);
}

function guardarPendientes() {
  if (pendingConversationSaves.size === 0) {
    return;
  }

  const store = readStore();
  const visitedStore = readVisitedStore();
  let storeChanged = false;
  let visitedChanged = false;

  for (const pendingConversation of pendingConversationSaves.values()) {
    const cachedConversation = serializeConversation(pendingConversation);
    const existingConversation = store.conversations[pendingConversation.id] ?? null;
    const mergedConversation = mergeCachedConversations(existingConversation, cachedConversation);

    if (!existingConversation || !areCachedConversationsEqual(existingConversation, mergedConversation)) {
      store.conversations[pendingConversation.id] = mergedConversation;
      storeChanged = true;
    }

    visitedStore[normalizeConversationStoreKey(pendingConversation.id)] = Date.now();
    visitedChanged = true;

    if (pendingConversation.cacheKey && pendingConversation.cacheKey !== pendingConversation.id) {
      delete store.conversations[pendingConversation.cacheKey];
      storeChanged = true;
      visitedStore[normalizeConversationStoreKey(pendingConversation.cacheKey)] = Date.now();
      visitedChanged = true;
    }
  }

  pendingConversationSaves.clear();
  if (storeChanged) {
    writeStore(trimStore(store));
  }
  if (visitedChanged) {
    writeVisitedStore(trimVisitedStore(visitedStore));
  }
}

// Si la caché supera este tiempo, no la usamos para el render inicial: evita mostrar
// un "chat viejo" al recargar tras mucho tiempo. La navegación entre chats la mantiene
// fresca (se reescribe en cada update) y al abrir un chat se refresca con /live, así que
// una ventana amplia hace que reabrir un chat ya visitado sea instantáneo sin riesgo de
// quedarse con contenido obsoleto (el SSR + /live lo corrigen en cuanto llegan).
const CACHE_FRESHNESS_MS = 1_800_000; // 30 minutos

export function readConversationFromCache(
  conversationId: string,
  options?: { ignoreFreshness?: boolean },
) {
  if (!conversationId) {
    return null;
  }

  // Sin dueño (login, otro usuario, apagado) no sale nada guardado, tampoco lo que espera guardarse.
  if (!isBrowser() || !duenoDelGuardado()) {
    return null;
  }

  const store = readStore();
  const ahora = Date.now();
  const vigente = (copia: CachedConversation | null | undefined) =>
    copia && typeof copia.cachedAt === "number" && ahora - copia.cachedAt <= CADUCIDAD_DURA_MS ? copia : null;

  /*
    Un chat recien guardado espera en `pendingConversationSaves` (600 ms mas la espera de
    inactividad) antes de llegar al navegador. Sin mirar aca, un chat recien precargado parecia no
    estar en la cache y al tocarlo salia vacio (06-11-2026). Se devuelve lo mismo que quedara
    guardado: la copia guardada junto con la nueva (la nueva sola podria traer menos mensajes).
    Leer no escribe nada en el navegador: el guardado sigue esperando su turno.
  */
  const pendiente = pendingConversationSaves.get(normalizeConversationStoreKey(conversationId));
  if (pendiente) {
    const guardada = vigente(store.conversations[pendiente.id]);
    return hydrateConversation(mergeCachedConversations(guardada, serializeConversation(pendiente)));
  }

  const normalizedConversationId = normalizeConversationCacheKey(conversationId);
  // Se busca por la clave tal cual y por la version sin prefijo ("agent:xxx" -> "xxx").
  // Habia un tercer intento con `split(":").slice(1).join(":")` que era redundante con el
  // anterior cuando el id trae prefijo y, cuando NO lo trae, producia cadena vacia: una
  // busqueda por clave "" que solo podia devolver una entrada equivocada.
  const cached =
    store.conversations[conversationId] ??
    store.conversations[normalizedConversationId] ??
    null;

  if (!cached) {
    return null;
  }

  // Caducidad dura (P5, T2): con mas de 24 h no se muestra NUNCA, tampoco con ignoreFreshness. Una
  // copia sin fecha tampoco.
  if (!vigente(cached)) {
    return null;
  }

  // Para mostrar (ignoreFreshness) devolvemos la caché aunque tenga mas de 30 min: reabrir un chat
  // es instantáneo y el /live de seguimiento la refresca enseguida. La frescura solo se
  // usa para decidir si el warmup debe volver a pedir el historial.
  if (
    !options?.ignoreFreshness &&
    typeof cached.cachedAt === "number" &&
    Date.now() - cached.cachedAt > CACHE_FRESHNESS_MS
  ) {
    return null;
  }

  return hydrateConversation(cached);
}

export function clearConversationCache() {
  if (!isBrowser()) {
    return;
  }

  pendingConversationSaves.clear();
  if (pendingSaveTimer !== null) {
    window.clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }

  cachedStore = null;
  cachedStoreDueno = null;
  cachedVisitedStore = {};
  persistidos = new Map();

  try {
    // Todas las copias de chats de este navegador, de cualquier dueño.
    const claves: string[] = [];
    for (let indice = 0; indice < window.localStorage.length; indice += 1) {
      const clave = window.localStorage.key(indice);
      if (clave?.startsWith("aglite:chat-history-cache")) {
        claves.push(clave);
      }
    }
    for (const clave of claves) {
      window.localStorage.removeItem(clave);
    }
  } catch {
    // Ignore storage failures so cache cleanup never breaks the UI.
  }
}

export function clearConversationFromCache(conversationId: string) {
  if (!isBrowser()) {
    return;
  }

  const normalizedConversationId = normalizeConversationCacheKey(conversationId);
  if (!normalizedConversationId) {
    return;
  }

  pendingConversationSaves.delete(normalizedConversationId);
  pendingConversationSaves.delete(`agent:${normalizedConversationId}`);
  pendingConversationSaves.delete(`official:${normalizedConversationId}`);

  try {
    const store = readStore();
    const nextConversations: Record<string, CachedConversation> = {};

    for (const [key, conversation] of Object.entries(store.conversations)) {
      const normalizedKey = normalizeConversationCacheKey(key);
      const normalizedStoredId = normalizeConversationCacheKey(conversation.id);
      const normalizedCacheKey = conversation.cacheKey ? normalizeConversationCacheKey(conversation.cacheKey) : "";

      if (
        normalizedKey === normalizedConversationId ||
        normalizedStoredId === normalizedConversationId ||
        normalizedCacheKey === normalizedConversationId
      ) {
        continue;
      }

      nextConversations[key] = conversation;
    }

    writeStore({
      version: 1,
      conversations: nextConversations,
    });

    const visitedStore = readVisitedStore();
    delete visitedStore[normalizedConversationId];
    delete visitedStore[`agent:${normalizedConversationId}`];
    delete visitedStore[`official:${normalizedConversationId}`];
    writeVisitedStore(visitedStore);
  } catch {
    // Ignore storage failures so cache cleanup never breaks the UI.
  }
}
