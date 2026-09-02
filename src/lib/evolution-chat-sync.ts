import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  WAHA_GATEWAY_KIND,
  comoMensajeDeEvolution,
  listarChatsWaha,
  mensajesDeChatWaha,
} from "@/lib/waha";
import { prisma } from "@/lib/prisma";
import {
  ensureEvolutionInstanceFullHistory,
  readGatewayConnection,
  resolveEvolutionMessageMediaUrl,
  type EvolutionConnection,
} from "@/lib/evolution";
import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";
import { fetchEvolutionGoMediaDataUrl } from "@/lib/evolution";
import { getEvolutionSettings } from "@/lib/system-settings";
import {
  extractEvolutionFromMe,
  extractEvolutionMessageId,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionMediaUrl,
  extractEvolutionRemoteJid,
  isEvolutionStatusBroadcastPayload,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";

type UnknownRecord = Record<string, unknown>;

export type EvolutionChatSyncCandidate = {
  fingerprint: string;
  kind: "CONTACT" | "CONVERSATION";
  remotePhoneNumber: string;
  remoteDisplayName: string | null;
  remoteJid: string | null;
  remoteJidAlt: string | null;
  remoteItemId: string | null;
  summary: string;
  needsContact: boolean;
  needsConversation: boolean;
  needsMessages: boolean;
  messagePreview: Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
    content: string | null;
    createdAt: string;
    mediaUrl: string | null;
  }>;
};

export type EvolutionChatSyncScanResult =
  | {
      ok: true;
      kind: "none";
      message: string;
    }
  | {
      ok: true;
      kind: "batch";
      message: string;
      candidates: EvolutionChatSyncCandidate[];
    };

export type EvolutionChatSyncApplyResult =
  | {
      ok: true;
      message: string;
      contactId: string;
      conversationId: string;
      createdContact: boolean;
      createdConversation: boolean;
      messagesImported: number;
    }
  | {
      ok: false;
      error: string;
    };

type EvolutionChatSyncImportedMessageDraft = {
  externalId: string;
  direction: "INBOUND" | "OUTBOUND";
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
  status: "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  content: string | null;
  mediaUrl: string | null;
  createdAt: Date;
  rawPayload: unknown;
  sentAt: Date | null;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function normalizeRemoteJidLike(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const phoneFromJid = normalizePhoneFromJid(normalized);
  return phoneFromJid ? `${phoneFromJid}@s.whatsapp.net` : null;
}

function extractRemoteJidAltFromChat(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const direct =
    readString(record.remoteJidAlt) ||
    readString(asRecord(record.key)?.remoteJidAlt) ||
    readString(asRecord(record.lastMessage)?.remoteJidAlt) ||
    readString(asRecord(asRecord(record.lastMessage)?.key)?.remoteJidAlt) ||
    readString(asRecord(record.data)?.remoteJidAlt) ||
    readString(asRecord(asRecord(record.data)?.key)?.remoteJidAlt);

  return direct || null;
}

function extractPreferredPhoneFromChat(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return getComparablePhoneFromString(typeof value === "string" ? value : null);
  }

  const remoteJid = readString(record.remoteJid);
  const remoteJidAlt = extractRemoteJidAltFromChat(record);

  if (remoteJid?.includes("@lid") && remoteJidAlt) {
    const altPhone = getComparablePhoneFromString(remoteJidAlt);
    if (altPhone) {
      return altPhone;
    }
  }

  if (remoteJidAlt) {
    const altPhone = getComparablePhoneFromString(remoteJidAlt);
    if (altPhone) {
      return altPhone;
    }
  }

  const preferredKeys = [
    "phoneNumber",
    "phone",
    "waId",
    "wuid",
    "ownerJid",
    "owner",
    "number",
    "chatId",
    "jid",
    "participant",
    "from",
    "remoteJid",
  ];

  for (const key of preferredKeys) {
    const candidate = getComparablePhoneFromString(readString(record[key]));
    if (candidate) {
      return candidate;
    }
  }

  for (const nestedKey of ["data", "contact", "instance", "sender", "message", "chat", "profile", "lastMessage"]) {
    const nested = extractPreferredPhoneFromChat(record[nestedKey]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function buildPhoneVariants(phoneNumber: string) {
  const normalized = normalizePhoneDigits(phoneNumber);
  if (!normalized) {
    return [];
  }

  return Array.from(
    new Set([
      normalized,
      `+${normalized}`,
      `${normalized}@s.whatsapp.net`,
      `+${normalized}@s.whatsapp.net`,
    ]),
  );
}

function isLikelyPlainPhone(value: string) {
  return /^\+?\d{7,15}$/.test(value.trim());
}

function getComparablePhoneFromString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const jidPhone = normalizePhoneFromJid(value);
  if (jidPhone) {
    return jidPhone;
  }

  if (isLikelyPlainPhone(value)) {
    return normalizePhoneDigits(value);
  }

  return null;
}

function extractComparablePhone(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return typeof value === "string" ? getComparablePhoneFromString(value) : null;
  }

  const preferredChatPhone = extractPreferredPhoneFromChat(record);
  if (preferredChatPhone) {
    return preferredChatPhone;
  }

  const directKeys = [
    "phoneNumber",
    "phone",
    "waId",
    "wuid",
    "ownerJid",
    "owner",
    "number",
    "remoteJidAlt",
    "remoteJid",
    "chatId",
    "jid",
    "participant",
    "from",
  ];

  for (const key of directKeys) {
    const candidate = getComparablePhoneFromString(readString(record[key]));
    if (candidate) {
      return candidate;
    }
  }

  for (const nestedKey of ["data", "contact", "key", "instance", "sender", "message", "chat", "profile"]) {
    const nested = extractComparablePhone(record[nestedKey]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractDisplayName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  const directKeys = ["name", "pushName", "push_name", "fullName", "displayName", "profileName", "label", "title"];
  for (const key of directKeys) {
    const candidate = readString(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  for (const nestedKey of ["data", "contact", "instance", "sender", "chat", "profile"]) {
    const nested = extractDisplayName(record[nestedKey]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractRemoteItemId(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  for (const key of ["remoteJid", "remoteJidAlt", "chatId", "id", "keyId", "jid"]) {
    const candidate = readString(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  for (const nestedKey of ["data", "contact", "key", "chat", "instance"]) {
    const nested = extractRemoteItemId(record[nestedKey]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractRemoteChatLastMessageAt(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const lastMessage = asRecord(record.lastMessage);
  const timestampValue =
    readNumber(lastMessage?.messageTimestamp) ??
    readNumber(record.updatedAt) ??
    readNumber(record.lastMessageAt) ??
    readNumber(record.messageTimestamp) ??
    readNumber(record.timestamp);

  if (!timestampValue) {
    return null;
  }

  const milliseconds = timestampValue > 1_000_000_000_000 ? timestampValue : timestampValue * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildCanonicalRemoteJid(phoneNumber: string) {
  const normalized = normalizePhoneDigits(phoneNumber);
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

function buildRemoteJidSearchVariants(remoteJid: string, remoteJidAlt?: string | null) {
  const preferredRemoteJid = remoteJidAlt?.trim() || remoteJid.trim();
  const searchOrder = [preferredRemoteJid, remoteJidAlt?.trim(), remoteJid.trim()]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim());

  const normalizedVariants = new Set<string>();

  for (const value of searchOrder) {
    normalizedVariants.add(value);

    const normalized = normalizeRemoteJidLike(value);
    if (normalized) {
      normalizedVariants.add(normalized);
    }
  }

  return Array.from(normalizedVariants);
}

function buildFallbackExternalId(input: {
  remoteJid: string | null;
  messageId: string | null;
  messageText: string | null;
  createdAt: Date | null;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  payload: unknown;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        remoteJid: input.remoteJid,
        messageId: input.messageId,
        messageText: input.messageText,
        createdAt: input.createdAt?.toISOString() ?? null,
        direction: input.direction,
        type: input.type,
        payload: input.payload,
      }),
    )
    .digest("hex");
}

function extractStableEvolutionMessageId(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    return extractEvolutionMessageId(payload);
  }

  const data = asRecord(record.data);
  const message = asRecord(record.message);

  const preferredKeyRecords = [
    asRecord(data?.key),
    asRecord(record.key),
    asRecord(message?.key),
    asRecord(asRecord(data?.message)?.key),
    asRecord(asRecord(record.lastMessage)?.key),
  ];

  for (const keyRecord of preferredKeyRecords) {
    const candidate = readString(keyRecord?.id);
    if (candidate) {
      return candidate;
    }
  }

  const fallbackIds = [
    readString(data?.keyId),
    readString(data?.messageId),
    readString(data?.id),
    readString(record.keyId),
    readString(record.messageId),
    readString(record.id),
  ];

  for (const candidate of fallbackIds) {
    if (candidate) {
      return candidate;
    }
  }

  return extractEvolutionMessageId(payload);
}

function buildEvolutionMessageSignature(payload: unknown) {
  const messageId = extractStableEvolutionMessageId(payload) ?? "";
  const createdAt = extractMessageTimestamp(payload)?.getTime() ?? 0;
  const direction = extractEvolutionFromMe(payload) ? "OUTBOUND" : "INBOUND";
  const type = extractEvolutionMessageType(payload);
  const text = extractEvolutionMessageText(payload)?.trim() ?? "";

  return createHash("sha256")
    .update(
      JSON.stringify({
        messageId,
        createdAt,
        direction,
        type,
        text,
      }),
    )
    .digest("hex");
}

function extractRecordList(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of ["response", "data", "result", "items", "contacts", "chats", "rows"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
    }
  }

  for (const key of ["response", "data", "result"]) {
    const nested = extractRecordList(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }

  for (const value of Object.values(record)) {
    const nested = extractRecordList(value);
    if (nested.length > 0) {
      return nested;
    }
  }

  const hasAnyExpectedField = ["phoneNumber", "phone", "waId", "wuid", "remoteJid", "remoteJidAlt", "chatId", "name", "pushName", "displayName"].some((key) =>
    Boolean(readString(record[key])),
  );

  return hasAnyExpectedField ? [record] : [];
}

function extractMessageRecordList(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of ["response", "data", "result", "items", "messages", "rows"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
    }
  }

  for (const key of ["response", "data", "result"]) {
    const nested = extractMessageRecordList(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }

  for (const value of Object.values(record)) {
    const nested = extractMessageRecordList(value);
    if (nested.length > 0) {
      return nested;
    }
  }

  const hasMessageShape =
    Boolean(readString(record.messageTimestamp)) ||
    Boolean(asRecord(record.key)) ||
    Boolean(asRecord(record.message)) ||
    Boolean(readString(record.status));

  return hasMessageShape ? [record] : [];
}

// Tope de seguridad para no entrar en un bucle infinito si Evolution reporta
// metadata de paginacion inconsistente.
const MAX_MESSAGE_PAGES = 100;

// Cantidad de mensajes mas recientes que importa la sincronizacion (no trae todo el
// historial: evita imports lentos de cientos/miles de mensajes).
const IMPORT_RECENT_MESSAGE_LIMIT = 20;

// Evolution API v2 responde /chat/findMessages como objeto paginado:
// { messages: { total, pages, currentPage, records: [...] } }. Sin leer esta
// metadata solo se importaria la primera pagina (historial truncado).
function extractMessagePagination(payload: unknown): { pages: number; currentPage: number } | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const data = asRecord(record.data);
  const containers = [
    asRecord(record.messages),
    asRecord(data?.messages),
    data,
    record,
  ];

  for (const container of containers) {
    if (!container) {
      continue;
    }

    const pages = readNumber(container.pages);
    const currentPage = readNumber(container.currentPage) ?? readNumber(container.page);
    if (pages !== null && currentPage !== null) {
      return { pages, currentPage };
    }
  }

  return null;
}

function extractMessageTimestamp(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const timestampValue =
    readNumber(record.messageTimestamp) ??
    readNumber(record.timestamp) ??
    readNumber(record.createdAt) ??
    readNumber(record.date) ??
    readNumber(asRecord(record.data)?.messageTimestamp) ??
    readNumber(asRecord(record.data)?.timestamp) ??
    readNumber(asRecord(record.message)?.messageTimestamp) ??
    readNumber(asRecord(record.message)?.timestamp);

  if (!timestampValue) {
    return null;
  }

  const milliseconds = timestampValue > 1_000_000_000_000 ? timestampValue : timestampValue * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeMessageStatus(value: unknown, direction: "INBOUND" | "OUTBOUND") {
  const raw = readString(value)?.toUpperCase() ?? "";

  if (raw.includes("DELIVER")) {
    return "DELIVERED";
  }

  if (raw.includes("READ")) {
    return "READ";
  }

  if (raw.includes("PEND")) {
    return "QUEUED";
  }

  if (raw.includes("QUEUE")) {
    return "QUEUED";
  }

  if (raw.includes("FAIL")) {
    return "FAILED";
  }

  if (raw.includes("RECEIV")) {
    return "RECEIVED";
  }

  if (raw.includes("SEND") || raw.includes("SENT")) {
    return "SENT";
  }

  return direction === "OUTBOUND" ? "SENT" : "RECEIVED";
}

function buildMessageRecordIdentity(message: UnknownRecord, jidHint?: string | null) {
  const payload = message as unknown;
  const directId =
    readString(asRecord(message)?.id) ||
    readString(asRecord(asRecord(message)?.key)?.id) ||
    readString(asRecord(asRecord(message)?.data)?.id);

  if (directId) {
    return `id:${directId}`;
  }

  const timestamp = extractMessageTimestamp(payload)?.getTime() ?? "";
  const direction = extractEvolutionFromMe(payload) ? "OUTBOUND" : "INBOUND";
  const type = extractEvolutionMessageType(payload);
  const text = extractEvolutionMessageText(payload) ?? "";
  const remoteJid =
    normalizeRemoteJidLike(extractEvolutionRemoteJid(payload)) ||
    normalizeRemoteJidLike(extractRemoteJidAltFromChat(message)) ||
    normalizeRemoteJidLike(extractRemoteJidAltFromChat(asRecord(message)?.key ?? null)) ||
    jidHint?.trim().toLowerCase() ||
    "";

  return `jid:${remoteJid}|ts:${timestamp}|dir:${direction}|type:${type}|text:${text.slice(0, 160)}`;
}

/**
 * Trae el historial de un chat desde WAHA y lo deja en el formato de Evolution.
 *
 * Pasa por el MISMO traductor que usa el webhook, asi un mensaje importado y uno que llega en
 * vivo quedan guardados igual. Escribir una conversion aparte era garantizar que con el tiempo el
 * historial mostrara las cosas distinto que el chat.
 */
async function fetchWahaChatMessageRecords(input: {
  connection: { baseUrl: string; apiToken: string };
  instanceName: string;
  remoteJid: string;
  limite: number;
}): Promise<UnknownRecord[]> {
  // WAHA habla en @c.us; el resto del CRM en @s.whatsapp.net.
  const telefono = input.remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!telefono) {
    return [];
  }

  /*
    Se prueban las DOS direcciones: "@c.us" y "@lid".

    Los leads que entran por un anuncio ocultan su numero y WhatsApp los identifica con un LID.
    WAHA guarda esa conversacion bajo "<lid>@lid", asi que preguntando solo por "@c.us" contestaba
    cero mensajes y el boton de historial parecia no traer nada. Comprobado el 2-sep-2026: para
    92599629176927, "@c.us" devolvia 0 mensajes y "@lid" devolvia 23.

    No se puede saber cual es cual mirando el numero -hay LIDs de 13 digitos, tan largos como un
    telefono real-, asi que se pide una y, si vuelve vacia, la otra.
  */
  const pedir = (chatId: string) =>
    mensajesDeChatWaha({
      connection: input.connection,
      sesion: input.instanceName,
      chatId,
      limite: input.limite,
    }).catch(() => [] as Array<Record<string, unknown>>);

  let crudos = await pedir(`${telefono}@c.us`);
  if (crudos.length === 0) {
    crudos = await pedir(`${telefono}@lid`);
  }

  return crudos
    .map((mensaje) => comoMensajeDeEvolution(input.instanceName, mensaje))
    .filter((mensaje): mensaje is Record<string, unknown> => Boolean(mensaje)) as UnknownRecord[];
}

async function fetchEvolutionChatMessageRecords(
  instanceName: string,
  remoteJid: string,
  remoteJidAlt?: string | null,
  options?: { maxPages?: number },
  connection?: EvolutionConnection | null,
) {
  if (connection?.kind === WAHA_GATEWAY_KIND) {
    return fetchWahaChatMessageRecords({
      connection: { baseUrl: connection.baseUrl, apiToken: connection.apiToken },
      instanceName,
      remoteJid,
      // El preview solo quiere una muestra; el import, todo lo que haya.
      limite: options?.maxPages && options.maxPages <= 1 ? 20 : 300,
    });
  }

  // El import necesita TODAS las paginas; el preview solo la primera (mas recientes),
  // para no disparar decenas de llamadas a Evolution solo para mostrar una muestra.
  const pageCap = Math.max(1, Math.min(options?.maxPages ?? MAX_MESSAGE_PAGES, MAX_MESSAGE_PAGES));
  const normalizedRemoteJids = buildRemoteJidSearchVariants(remoteJid, remoteJidAlt);
  const messagesById = new Map<string, UnknownRecord>();

  const filterMessagesForRemote = (messages: UnknownRecord[]) =>
    messages.filter((message) => {
      if (isEvolutionStatusBroadcastPayload(message)) {
        return false;
      }

      const messageRemoteJid = extractEvolutionRemoteJid(message);
      const messageRemoteJidAlt = extractRemoteJidAltFromChat(message) || extractRemoteJidAltFromChat(asRecord(message)?.key ?? null);
      const candidates = [messageRemoteJidAlt, messageRemoteJid]
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeRemoteJidLike(value) ?? value.trim().toLowerCase());

      if (!candidates.length) {
        return false;
      }

      if (normalizedRemoteJids.length === 0) {
        return false;
      }

      return candidates.some((candidate) => normalizedRemoteJids.includes(candidate));
    });

  for (const jid of normalizedRemoteJids) {
    let page = 1;

    // Recorre las paginas que reporte Evolution para esta variante de JID (hasta pageCap).
    // Si la respuesta no trae metadata de paginacion, se ejecuta una sola vez.
    while (page <= pageCap) {
      let directPayload: unknown;
      try {
        directPayload = await evolutionSyncRequest<unknown>(`/chat/findMessages/${instanceName}`, {
          method: "POST",
          body: JSON.stringify({
            where: {
              key: {
                remoteJid: jid,
              },
            },
            page,
          }),
        }, connection);
      } catch {
        // If Evolution rejects one lookup path, keep scanning the rest.
        break;
      }

      const directMessages = extractMessageRecordList(directPayload);
      const filteredDirectMessages = filterMessagesForRemote(directMessages);

      for (const message of filteredDirectMessages) {
        const messageId = buildMessageRecordIdentity(message, jid);
        if (!messagesById.has(messageId)) {
          messagesById.set(messageId, message);
        }
      }

      const pagination = extractMessagePagination(directPayload);
      const currentPage = pagination?.currentPage ?? page;
      const totalPages = pagination?.pages ?? 1;

      // Detener si: no hay mas registros, no hay paginacion declarada, o ya
      // alcanzamos la ultima pagina.
      if (directMessages.length === 0 || currentPage >= totalPages) {
        break;
      }

      page = currentPage + 1;
    }
  }

  if (!messagesById.size) {
    let fallbackPayload: unknown = null;
    try {
      fallbackPayload = await evolutionSyncRequest<unknown>(`/messages/fetch/${instanceName}`, {
        method: "GET",
      }, connection);
    } catch {
      fallbackPayload = null;
    }

    const fallbackMessages = extractMessageRecordList(fallbackPayload);
    const filteredFallbackMessages = filterMessagesForRemote(fallbackMessages);

    for (const message of filteredFallbackMessages) {
      const messageId =
        readString(asRecord(message)?.id) ||
        readString(asRecord(asRecord(message)?.key)?.id) ||
        `${JSON.stringify(message)}`;

      if (!messagesById.has(messageId)) {
        messagesById.set(messageId, message);
      }
    }
  }

  return Array.from(messagesById.values());
}
function buildEvolutionChatMessagePreviewFromPayload(payload: unknown): {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
  content: string | null;
  createdAt: string;
  mediaUrl: string | null;
} | null {
  const normalizedPayload = asRecord(payload);
  if (!normalizedPayload) {
    return null;
  }

  if (isEvolutionStatusBroadcastPayload(normalizedPayload)) {
    return null;
  }

  return {
    id:
      extractStableEvolutionMessageId(normalizedPayload) ||
      createHash("sha256").update(JSON.stringify(normalizedPayload)).digest("hex"),
    direction: extractEvolutionFromMe(normalizedPayload) ? "OUTBOUND" : "INBOUND",
    type: extractEvolutionMessageType(normalizedPayload),
    content: extractEvolutionMessageText(normalizedPayload),
    createdAt: (extractMessageTimestamp(normalizedPayload) ?? new Date()).toISOString(),
    mediaUrl: extractEvolutionMediaUrl(normalizedPayload),
  };
}

async function buildImportedEvolutionMessages(input: {
  instanceName: string;
  remoteJid: string;
  remoteJidAlt?: string | null;
  // Cantidad de mensajes mas recientes a importar. null = todo el historial.
  // undefined = valor por defecto (IMPORT_RECENT_MESSAGE_LIMIT).
  limit?: number | null;
  connection?: EvolutionConnection | null;
}) {
  const limit = input.limit === undefined ? IMPORT_RECENT_MESSAGE_LIMIT : input.limit;
  // Solo paginamos lo necesario: con ~45 mensajes por pagina, calculamos cuantas hacen
  // falta para cubrir el limite. Si limit es null (Todas), recorremos todo el historial.
  const maxPages = limit && limit > 0 ? Math.max(1, Math.ceil(limit / 45)) : MAX_MESSAGE_PAGES;

  const importedMessages: Array<{
    sourceIndex: number;
    draft: EvolutionChatSyncImportedMessageDraft;
  }> = [];
  const allRawMessages = await fetchEvolutionChatMessageRecords(
    input.instanceName,
    input.remoteJid,
    input.remoteJidAlt,
    { maxPages },
    input.connection,
  );
  const rawMessages =
    limit && limit > 0
      ? allRawMessages
          .slice()
          .sort((left, right) => {
            const leftTime = extractMessageTimestamp(left)?.getTime() ?? 0;
            const rightTime = extractMessageTimestamp(right)?.getTime() ?? 0;
            return rightTime - leftTime; // mas reciente primero
          })
          .slice(0, limit)
      : allRawMessages;

  const seenMessageSignatures = new Set<string>();
  const seenExternalIds = new Set<string>();

  for (const [sourceIndex, rawMessage] of rawMessages.entries()) {
    const payload = rawMessage as unknown;
    try {
      if (isEvolutionStatusBroadcastPayload(payload)) {
        continue;
      }

      const messageSignature = buildEvolutionMessageSignature(payload);
      if (seenMessageSignatures.has(messageSignature)) {
        continue;
      }

      const messageId = extractStableEvolutionMessageId(payload);
      const direction: "INBOUND" | "OUTBOUND" = extractEvolutionFromMe(payload) ? "OUTBOUND" : "INBOUND";
      const type = extractEvolutionMessageType(payload);
      const content = extractEvolutionMessageText(payload);
      let mediaUrl = extractEvolutionMediaUrl(payload);

      if (type === "IMAGE" || type === "AUDIO" || type === "VIDEO" || type === "STICKER" || type === "DOCUMENT") {
        const rawMediaUrl = mediaUrl;
        let resolvedMediaUrl: string | null = rawMediaUrl;
        try {
          resolvedMediaUrl = await resolveEvolutionMessageMediaUrl({
            instanceName: input.instanceName,
            messageId,
            mediaType: type,
            mediaUrl: rawMediaUrl,
            rawPayload: payload,
          });
        } catch {
          resolvedMediaUrl = rawMediaUrl;
        }

        // Persistir el binario en el almacenamiento propio (igual que el webhook) para
        // no depender de re-resoluciones y, sobre todo, para no guardar el data: base64
        // pesado en la columna de la BD. Si la persistencia no aplica (no es un data:
        // URL) o falla, conservamos una URL no-data como fallback de resolucion perezosa.
        const persistedMediaUrl = await persistChatMediaFromDataUrl({
          dataUrl: resolvedMediaUrl,
          mediaType: type,
        });

        if (persistedMediaUrl) {
          mediaUrl = persistedMediaUrl;
        } else if (resolvedMediaUrl && !resolvedMediaUrl.startsWith("data:")) {
          mediaUrl = resolvedMediaUrl;
        } else {
          mediaUrl = rawMediaUrl;
        }
      }

      seenMessageSignatures.add(messageSignature);
      const createdAt = extractMessageTimestamp(payload) ?? new Date();
      const externalId = messageId || buildFallbackExternalId({
        remoteJid: input.remoteJid,
        messageId,
        messageText: content,
        createdAt,
        direction,
        type,
        payload,
      });

      if (seenExternalIds.has(externalId)) {
        continue;
      }

      seenExternalIds.add(externalId);
      importedMessages.push({
        sourceIndex,
        draft: {
          externalId,
          direction,
          type,
          status: normalizeMessageStatus(readString((rawMessage as UnknownRecord).status) ?? readString(asRecord((rawMessage as UnknownRecord).data)?.status), direction),
          content,
          mediaUrl,
          createdAt,
          rawPayload: {
            source: "evolution-sync",
            evolution: payload,
          },
          sentAt: direction === "OUTBOUND" ? createdAt : null,
        },
      });
    } catch {
      // Skip malformed records so one bad message doesn't block the whole conversation.
    }
  }

  importedMessages.sort((left, right) => {
    const diff = left.draft.createdAt.getTime() - right.draft.createdAt.getTime();
    if (diff !== 0) {
      return diff;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  return importedMessages.map((entry) => entry.draft);
}

async function buildEvolutionChatMessagePreview(input: {
  instanceName: string;
  remoteJid: string;
  remoteJidAlt?: string | null;
  connection?: EvolutionConnection | null;
}): Promise<Array<{
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
  content: string | null;
  createdAt: string;
  mediaUrl: string | null;
}>> {
  const previewMessages: Array<{
    sourceIndex: number;
    preview: NonNullable<ReturnType<typeof buildEvolutionChatMessagePreviewFromPayload>>;
  }> = [];
  const seenPreviewSignatures = new Set<string>();
  const seenPreviewIds = new Set<string>();

  const enqueuePreview = (message: UnknownRecord, sourceIndex: number) => {
    if (isEvolutionStatusBroadcastPayload(message)) {
      return;
    }

    const messageSignature = buildEvolutionMessageSignature(message);
    if (seenPreviewSignatures.has(messageSignature)) {
      return;
    }

    const preview = buildEvolutionChatMessagePreviewFromPayload(message);
    if (!preview || seenPreviewIds.has(preview.id)) {
      return;
    }

    seenPreviewSignatures.add(messageSignature);
    seenPreviewIds.add(preview.id);
    previewMessages.push({
      sourceIndex,
      preview,
    });
  };

  // El preview es solo una muestra: con la primera pagina basta (Evolution la devuelve
  // con los mensajes mas recientes). Evita disparar las ~24 paginas del historial completo.
  const fallbackMessages = await fetchEvolutionChatMessageRecords(
    input.instanceName,
    input.remoteJid,
    input.remoteJidAlt,
    { maxPages: 1 },
    input.connection,
  );
  for (const [sourceIndex, message] of fallbackMessages.entries()) {
    enqueuePreview(message, sourceIndex);
  }

  // Orden cronologico ascendente y nos quedamos con los 25 MAS RECIENTES (no los mas
  // viejos): el array crudo viene "mas nuevo primero", por eso ordenamos y cortamos al final.
  return previewMessages
    .sort((left, right) => {
      const leftTime = new Date(left.preview.createdAt).getTime();
      const rightTime = new Date(right.preview.createdAt).getTime();

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.sourceIndex - right.sourceIndex;
    })
    .slice(-25)
    .map((entry) => entry.preview);
}

async function buildEvolutionChatSyncCandidateFromRemoteChat(input: {
  instanceName: string;
  remoteChat: UnknownRecord;
  remotePhoneNumber: string;
  kind: EvolutionChatSyncCandidate["kind"];
  summary: string;
  needsContact: boolean;
  needsConversation: boolean;
  connection?: EvolutionConnection | null;
}): Promise<EvolutionChatSyncCandidate> {
  const remoteDisplayName = extractDisplayName(input.remoteChat);
  const remoteItemId = extractRemoteItemId(input.remoteChat);
  const remoteJid =
    readString(input.remoteChat.remoteJid) ?? readString(input.remoteChat.remoteJidAlt) ?? buildCanonicalRemoteJid(input.remotePhoneNumber);
  let messagePreview: EvolutionChatSyncCandidate["messagePreview"] = [];

  if (remoteJid) {
    try {
      messagePreview = await buildEvolutionChatMessagePreview({
        instanceName: input.instanceName,
        remoteJid,
        remoteJidAlt: extractRemoteJidAltFromChat(input.remoteChat),
        connection: input.connection,
      });
    } catch {
      messagePreview = [];
    }
  }

  return {
    fingerprint: buildCandidateFingerprint({
      kind: input.kind,
      phoneNumber: input.remotePhoneNumber,
      remoteItemId,
    }),
    kind: input.kind,
    remotePhoneNumber: input.remotePhoneNumber,
    remoteDisplayName,
    remoteJid,
    remoteJidAlt: extractRemoteJidAltFromChat(input.remoteChat),
    remoteItemId,
    summary: input.summary,
    needsContact: input.needsContact,
    needsConversation: input.needsConversation,
    needsMessages: true,
    messagePreview,
  } satisfies EvolutionChatSyncCandidate;
}

function normalizeEvolutionPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

// La conexión por-canal (Evolution API del canal) tiene prioridad sobre el global.
async function evolutionSyncRequest<T>(
  path: string,
  init?: RequestInit,
  connection?: EvolutionConnection | null,
): Promise<T> {
  const settings = await getEvolutionSettings();
  const baseUrl = (connection?.baseUrl || settings.apiBaseUrl || "").replace(/\/+$/, "");
  const apiToken = connection?.apiToken || settings.apiToken || "";
  if (!baseUrl || !apiToken) {
    throw new Error("La configuracion global de WhatsApp no esta completa");
  }

  const response = await fetch(`${baseUrl}${normalizeEvolutionPath(path)}`, {
    ...init,
    headers: {
      apikey: apiToken,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Evolution API respondio con ${response.status}`);
  }

  const bodyText = await response.text().catch(() => "");
  if (!bodyText.trim()) {
    return null as T;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return bodyText as T;
  }
}

// Preguntarle al gateway que chats y mensajes tiene el telefono es exclusivo de Evolution API
// (Baileys): guarda el historial en su propia base y lo expone por findChats/findMessages.
// Evolution GO (whatsmeow) NO tiene esas rutas — contesta literalmente "404 page not found", y
// ese 404 subia como excepcion desde la server action y tumbaba la pantalla entera de Conexion
// ("No se pudo cargar esta pantalla", digest 1609115967).
//
// Los canales GO no se quedan sin sincronizacion: van por otro camino, el historial que el
// telefono ya nos mando al vincularse (ver scanEvolutionGoHistoryCandidates, mas abajo).
//
// Sin conexion por-canal se usa la configuracion global, que hoy apunta a evogo (GO).
/**
 * Si el gateway puede DECIRNOS que chats tiene.
 *
 * evogo no puede: no expone forma de listar chats ni mensajes, y por eso el boton "Sincronizar
 * chats" nunca funciono ahi (cae al camino de HISTORYSYNC, que le pide el historial al celular).
 * Evolution API y WAHA si guardan su propia base y la exponen.
 */
function supportsRemoteChatSync(connection: EvolutionConnection | null) {
  return connection?.kind === "EVOLUTION_API" || connection?.kind === WAHA_GATEWAY_KIND;
}

async function fetchEvolutionChats(instanceName: string, connection?: EvolutionConnection | null) {
  if (connection?.kind === WAHA_GATEWAY_KIND) {
    const chats = await listarChatsWaha({
      connection: { baseUrl: connection.baseUrl, apiToken: connection.apiToken },
      sesion: instanceName,
    });
    // Se devuelven con los nombres de campo que ya sabe leer el resto: `id` trae el JID y de ahi
    // sale el telefono, que es lo unico que hace falta para cruzarlo con los contactos locales.
    return chats.map((chat) => ({
      id: chat.id,
      remoteJid: chat.id,
      pushName: chat.nombre,
      profilePicUrl: chat.foto,
    })) as UnknownRecord[];
  }

  const payload = await evolutionSyncRequest<unknown>(`/chat/findChats/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({}),
  }, connection);

  return extractRecordList(payload);
}

function buildCandidateFingerprint(input: { kind: "CONTACT" | "CONVERSATION"; phoneNumber: string; remoteItemId: string | null }) {
  return `${input.kind}:${input.phoneNumber}:${input.remoteItemId ?? ""}`;
}

async function findLocalContactsByPhoneNumbers(workspaceId: string, phoneNumbers: string[]) {
  const variants = Array.from(new Set(phoneNumbers.flatMap((phoneNumber) => buildPhoneVariants(phoneNumber))));

  if (!variants.length) {
    return [];
  }

  return prisma.contact.findMany({
    where: {
      workspaceId,
      phoneNumber: {
        in: variants,
      },
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
    },
  });
}

async function findLocalConversationsByChannel(workspaceId: string, channelId: string) {
  return prisma.conversation.findMany({
    where: {
      workspaceId,
      channelId,
    },
    select: {
      id: true,
      contactId: true,
      lastMessageAt: true,
      _count: {
        select: {
          messages: true,
        },
      },
      contact: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

function buildPhoneLookupMap<T extends { phoneNumber: string }>(rows: T[]) {
  const map = new Map<string, T>();

  for (const row of rows) {
    const normalized = normalizePhoneDigits(row.phoneNumber);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, row);
    }
  }

  return map;
}

export async function scanEvolutionChatSyncCandidate(input: { workspaceId: string; channelId: string }) {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId,
      provider: "EVOLUTION",
    },
    select: {
      id: true,
      name: true,
      evolutionInstanceName: true,
      metadata: true,
    },
  });

  if (!channel?.evolutionInstanceName) {
    return {
      ok: false as const,
      error: "El canal no tiene una instancia Evolution valida.",
    };
  }

  const connection = readGatewayConnection(channel.metadata);
  if (!supportsRemoteChatSync(connection)) {
    return scanEvolutionGoHistoryCandidates({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      instanceName: channel.evolutionInstanceName,
    });
  }

  const remoteChats = await fetchEvolutionChats(channel.evolutionInstanceName, connection);

  const remotePhones = Array.from(
    new Set(
      remoteChats
        .map((item) => extractComparablePhone(item))
        .filter((phone): phone is string => Boolean(phone)),
    ),
  );

  if (!remotePhones.length) {
    if (remoteChats.length > 0) {
      return {
        ok: false as const,
        error: "Evolution devolvio chats, pero no pudimos leer un numero de telefono utilizable para compararlos.",
      };
    }

    return {
      ok: true as const,
      kind: "none" as const,
      message: "No encontramos chats comparables en Evolution para este canal.",
    };
  }

  const [localContacts, localConversations] = await Promise.all([
    findLocalContactsByPhoneNumbers(input.workspaceId, remotePhones),
    findLocalConversationsByChannel(input.workspaceId, input.channelId),
  ]);

  const localContactsByPhone = buildPhoneLookupMap(localContacts);
  const localConversationsByPhone = buildPhoneLookupMap(
    localConversations.map((conversation) => ({
      phoneNumber: conversation.contact.phoneNumber,
      lastMessageAt: conversation.lastMessageAt,
      messageCount: conversation._count.messages,
    })),
  );

  const candidates: EvolutionChatSyncCandidate[] = [];

  for (const remoteChat of remoteChats) {
    const remotePhoneNumber = extractComparablePhone(remoteChat);
    if (!remotePhoneNumber) {
      continue;
    }

    const localContact = localContactsByPhone.get(remotePhoneNumber);
    if (!localContact) {
      candidates.push(
        await buildEvolutionChatSyncCandidateFromRemoteChat({
          instanceName: channel.evolutionInstanceName,
          remoteChat,
          remotePhoneNumber,
          kind: "CONTACT",
          summary: extractDisplayName(remoteChat)
            ? `El contacto ${extractDisplayName(remoteChat)} (${remotePhoneNumber}) no existe en Chats.`
            : `El contacto ${remotePhoneNumber} no existe en Chats.`,
          needsContact: true,
          needsConversation: true,
          connection,
        }),
      );

      if (candidates.length >= 5) {
        break;
      }

      continue;
    }

    const localConversation = localConversationsByPhone.get(remotePhoneNumber);
    const remoteLastMessageAt = extractRemoteChatLastMessageAt(remoteChat);
    const localMessageCount = localConversation?.messageCount ?? 0;
    const localLastMessageAt = localConversation?.lastMessageAt ?? null;
    const hasMissingMessages =
      !localConversation ||
      localMessageCount === 0 ||
      !localLastMessageAt ||
      Boolean(remoteLastMessageAt && localLastMessageAt && remoteLastMessageAt.getTime() > localLastMessageAt.getTime());

    if (!localConversation || hasMissingMessages) {
      const needsConversation = !localConversation;
      candidates.push(
        await buildEvolutionChatSyncCandidateFromRemoteChat({
          instanceName: channel.evolutionInstanceName,
          remoteChat,
          remotePhoneNumber,
          kind: "CONVERSATION",
          connection,
          summary: needsConversation
            ? extractDisplayName(remoteChat)
              ? `El chat ${extractDisplayName(remoteChat)} (${remotePhoneNumber}) no tiene conversacion local.`
              : `El chat ${remotePhoneNumber} no tiene conversacion local.`
            : extractDisplayName(remoteChat)
              ? `El chat ${extractDisplayName(remoteChat)} (${remotePhoneNumber}) tiene mensajes faltantes en la base local.`
              : `El chat ${remotePhoneNumber} tiene mensajes faltantes en la base local.`,
          needsContact: false,
          needsConversation,
        }),
      );

      if (candidates.length >= 5) {
        break;
      }
    }
  }

  if (candidates.length > 0) {
    return {
      ok: true as const,
      kind: "batch" as const,
      message: "Mostramos hasta 5 coincidencias para revisar antes de agregar.",
      candidates,
    };
  }

  return {
    ok: true as const,
    kind: "none" as const,
    message: "No encontramos diferencias entre Evolution y la base local para este canal.",
  };
}

// Variante de sincronizacion dirigida a UN numero concreto. Primero ubica el chat en
// Evolution (findChats) para descubrir sus JIDs REALES (remoteJid + remoteJidAlt), que
// pueden ser @lid en vez de @s.whatsapp.net. Asi findMessages se consulta con ambas
// variantes: a veces @s.whatsapp.net no devuelve nada y el @lid/alt si. Si el chat no
// aparece en findChats, cae al JID canonico como ultimo recurso.
export async function scanEvolutionChatSyncCandidateByPhone(input: {
  workspaceId: string;
  channelId: string;
  phoneNumber: string;
}) {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId,
      provider: "EVOLUTION",
    },
    select: {
      id: true,
      name: true,
      evolutionInstanceName: true,
      metadata: true,
    },
  });

  if (!channel?.evolutionInstanceName) {
    return {
      ok: false as const,
      error: "El canal no tiene una instancia Evolution valida.",
    };
  }

  const connection = readGatewayConnection(channel.metadata);

  const normalizedPhone = normalizePhoneDigits(input.phoneNumber);
  if (!normalizedPhone) {
    return {
      ok: false as const,
      error: "El numero ingresado no es valido. Usa solo digitos con codigo de pais (ej: 573001234567).",
    };
  }

  if (!supportsRemoteChatSync(connection)) {
    return scanEvolutionGoHistoryCandidates({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      instanceName: channel.evolutionInstanceName,
      phoneNumber: normalizedPhone,
    });
  }

  const [localContacts, localConversations] = await Promise.all([
    findLocalContactsByPhoneNumbers(input.workspaceId, [normalizedPhone]),
    findLocalConversationsByChannel(input.workspaceId, input.channelId),
  ]);

  const localContact = buildPhoneLookupMap(localContacts).get(normalizedPhone);
  const localConversation = buildPhoneLookupMap(
    localConversations.map((conversation) => ({
      phoneNumber: conversation.contact.phoneNumber,
      lastMessageAt: conversation.lastMessageAt,
      messageCount: conversation._count.messages,
    })),
  ).get(normalizedPhone);

  const needsContact = !localContact;
  const needsConversation = !localConversation;
  const kind: EvolutionChatSyncCandidate["kind"] = needsContact ? "CONTACT" : "CONVERSATION";

  const summary = needsContact
    ? `El contacto ${normalizedPhone} no existe en Chats. Se importara con su historial de Evolution.`
    : needsConversation
      ? `El contacto ${normalizedPhone} existe pero no tiene conversacion en este canal. Se creara e importara su historial.`
      : `Se sincronizaran los mensajes faltantes de ${normalizedPhone}.`;

  // 1) Ubicar el chat real en Evolution para extraer remoteJid + remoteJidAlt (incl. @lid).
  let matchedRemoteChat: UnknownRecord | null = null;
  try {
    const remoteChats = await fetchEvolutionChats(channel.evolutionInstanceName, connection);
    matchedRemoteChat =
      remoteChats.find((chat) => {
        const chatPhone = normalizePhoneDigits(extractComparablePhone(chat));
        return chatPhone !== null && chatPhone === normalizedPhone;
      }) ?? null;
  } catch {
    matchedRemoteChat = null;
  }

  let candidate: EvolutionChatSyncCandidate;

  if (matchedRemoteChat) {
    // Reutiliza el builder del escaneo completo: extrae los JIDs reales del chat y
    // construye el preview consultando findMessages con remoteJid Y remoteJidAlt.
    candidate = await buildEvolutionChatSyncCandidateFromRemoteChat({
      instanceName: channel.evolutionInstanceName,
      remoteChat: matchedRemoteChat,
      remotePhoneNumber: normalizedPhone,
      kind,
      summary,
      needsContact,
      needsConversation,
      connection,
    });
    candidate.remoteDisplayName = candidate.remoteDisplayName ?? localContact?.name ?? null;
  } else {
    // Fallback: sin chat en findChats, probar al menos el JID canonico @s.whatsapp.net.
    const canonicalRemoteJid = buildCanonicalRemoteJid(normalizedPhone);
    if (!canonicalRemoteJid) {
      return {
        ok: false as const,
        error: "No se pudo construir el identificador de WhatsApp para ese numero.",
      };
    }

    let messagePreview: EvolutionChatSyncCandidate["messagePreview"] = [];
    try {
      messagePreview = await buildEvolutionChatMessagePreview({
        instanceName: channel.evolutionInstanceName,
        remoteJid: canonicalRemoteJid,
        remoteJidAlt: null,
        connection,
      });
    } catch {
      messagePreview = [];
    }

    candidate = {
      fingerprint: buildCandidateFingerprint({ kind, phoneNumber: normalizedPhone, remoteItemId: null }),
      kind,
      remotePhoneNumber: normalizedPhone,
      remoteDisplayName: localContact?.name ?? null,
      remoteJid: canonicalRemoteJid,
      remoteJidAlt: null,
      remoteItemId: null,
      summary,
      needsContact,
      needsConversation,
      needsMessages: true,
      messagePreview,
    };
  }

  // Si ninguna variante devolvio mensajes, informar "sin cambios".
  if (!candidate.messagePreview.length) {
    return {
      ok: true as const,
      kind: "none" as const,
      message: `No encontramos mensajes en Evolution para ${normalizedPhone} en este canal.`,
    };
  }

  return {
    ok: true as const,
    kind: "batch" as const,
    message: "Coincidencia lista para sincronizar.",
    candidates: [candidate],
  };
}

/**
 * Importa VARIOS chats de una pasada.
 *
 * Existe porque el escaneo de un canal recien vinculado ofrece una docena de chats y hacerlos
 * de a uno son doce vueltas de abrir-escanear-elegir-agregar. Cada chat se guarda por separado
 * (transaccion propia), asi que si el pedido se corta a la mitad lo ya importado queda.
 *
 * En Evolution GO ademas se lee el historial UNA sola vez para todos: son payloads de cientos
 * de KB y releerlos por chat era lo mismo doce veces.
 */
export async function applyEvolutionChatSyncCandidates(input: {
  workspaceId: string;
  channelId: string;
  candidates: EvolutionChatSyncCandidate[];
  importLimit?: number | null;
}): Promise<
  | { ok: true; chats: number; messages: number; failed: Array<{ phoneNumber: string; error: string }> }
  | { ok: false; error: string }
> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, workspaceId: input.workspaceId, provider: "EVOLUTION" },
    select: { id: true, agentId: true, evolutionInstanceName: true, metadata: true },
  });

  if (!channel?.evolutionInstanceName) {
    return { ok: false, error: "El canal no tiene una instancia Evolution valida para importar mensajes." };
  }

  const isGoGateway = !supportsRemoteChatSync(readGatewayConnection(channel.metadata));
  const historyChats = isGoGateway ? await readEvolutionGoHistoryChats(channel.evolutionInstanceName) : null;
  // Presupuesto de adjuntos COMPARTIDO por toda la tanda: cada descarga es una llamada al
  // gateway y un archivo en disco, y aca se importan doce chats seguidos con el usuario
  // esperando. Sin esto, un chat lleno de PDF se come el rato de todos los demas.
  const mediaBudget = { remaining: HISTORY_SYNC_BULK_MEDIA_LIMIT };

  let chats = 0;
  let messages = 0;
  const failed: Array<{ phoneNumber: string; error: string }> = [];

  for (const candidate of input.candidates) {
    try {
      const result = historyChats
        ? await applyEvolutionGoHistoryCandidate({
            workspaceId: input.workspaceId,
            channel: {
              id: channel.id,
              agentId: channel.agentId,
              evolutionInstanceName: channel.evolutionInstanceName,
            },
            candidate,
            importLimit: input.importLimit,
            historyChats,
            mediaBudget,
          })
        : await applyEvolutionChatSyncCandidate({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            candidate,
            importLimit: input.importLimit,
          });

      if (result.ok) {
        chats += 1;
        messages += "messagesImported" in result ? (result.messagesImported ?? 0) : 0;
      } else {
        failed.push({ phoneNumber: candidate.remotePhoneNumber, error: result.error });
      }
    } catch (error) {
      // Un chat que falla no puede tumbar la tanda: se anota y se sigue con el siguiente.
      failed.push({
        phoneNumber: candidate.remotePhoneNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: true, chats, messages, failed };
}

export async function applyEvolutionChatSyncCandidate(input: {
  workspaceId: string;
  channelId: string;
  candidate: EvolutionChatSyncCandidate;
  // Cantidad de mensajes mas recientes a importar. null = todo el historial.
  importLimit?: number | null;
}) {
  const candidate = input.candidate;

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId,
      provider: "EVOLUTION",
    },
    select: {
      id: true,
      agentId: true,
      evolutionInstanceName: true,
      name: true,
      metadata: true,
    },
  });

  if (!channel) {
    return {
      ok: false as const,
      error: "El canal ya no existe o no pertenece al workspace actual.",
    };
  }

  if (!channel.evolutionInstanceName) {
    return {
      ok: false as const,
      error: "El canal no tiene una instancia Evolution valida para importar mensajes.",
    };
  }

  const connection = readGatewayConnection(channel.metadata);

  // En Evolution GO los mensajes no se piden: ya llegaron solos en el history sync de la
  // vinculacion y estan guardados en WebhookEventLog. Ese es otro origen, mismo destino.
  if (!supportsRemoteChatSync(connection)) {
    return applyEvolutionGoHistoryCandidate({
      workspaceId: input.workspaceId,
      channel: {
        id: channel.id,
        agentId: channel.agentId,
        evolutionInstanceName: channel.evolutionInstanceName,
      },
      candidate,
      importLimit: input.importLimit,
    });
  }

  await ensureEvolutionInstanceFullHistory(channel.evolutionInstanceName);

  let importedMessages: EvolutionChatSyncImportedMessageDraft[];
  try {
    importedMessages = await buildImportedEvolutionMessages({
      instanceName: channel.evolutionInstanceName,
      remoteJid: candidate.remoteJid ?? buildCanonicalRemoteJid(candidate.remotePhoneNumber) ?? "",
      remoteJidAlt: candidate.remoteJidAlt,
      limit: input.importLimit,
      connection,
    });
  } catch {
    return {
      ok: false as const,
      error: "No se pudo leer el historial completo de Evolution para esta conversacion.",
    };
  }

  return persistEvolutionChatSyncCandidate({
    workspaceId: input.workspaceId,
    channel,
    candidate,
    importedMessages,
  });
}

/**
 * Crea (o completa) el contacto, la conversacion y los mensajes de un candidato ya resuelto.
 *
 * Es la mitad final —y comun— de las dos importaciones: la de Evolution API, que lee los
 * mensajes de findMessages, y la de Evolution GO, que los saca del history sync guardado. Lo
 * unico que cambia entre ambas es de donde salieron los mensajes.
 */
async function persistEvolutionChatSyncCandidate(input: {
  workspaceId: string;
  channel: { id: string; agentId: string | null };
  candidate: EvolutionChatSyncCandidate;
  importedMessages: EvolutionChatSyncImportedMessageDraft[];
}) {
  const { candidate, channel, importedMessages } = input;

  const contactAndConversation = await prisma.$transaction(async (tx) => {
    let contact = await tx.contact.findFirst({
      where: {
        workspaceId: input.workspaceId,
        phoneNumber: {
          in: buildPhoneVariants(candidate.remotePhoneNumber),
        },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
      },
    });

    let createdContact = false;
    let createdConversation = false;

    if (contact && candidate.remoteDisplayName && (!contact.name || !contact.name.trim())) {
      await tx.contact.update({
        where: { id: contact.id },
        data: { name: candidate.remoteDisplayName },
      });
      contact = {
        ...contact,
        name: candidate.remoteDisplayName,
      };
    }

    if (!contact) {
      // upsert y no create: dos mensajes del mismo numero nuevo pueden procesarse a la vez, los
      // dos ven "no existe" y los dos insertan. El segundo reventaba contra el indice unico
      // (Contact_workspaceId_phoneNumber_key) y se caia toda la sincronizacion. Asi, el que
      // llega segundo se encuentra la ficha que acaba de crear el primero.
      contact = await tx.contact.upsert({
        where: {
          workspaceId_phoneNumber: {
            workspaceId: input.workspaceId,
            phoneNumber: candidate.remotePhoneNumber,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          phoneNumber: candidate.remotePhoneNumber,
          name: candidate.remoteDisplayName ?? null,
        },
        update: {},
        select: {
          id: true,
          name: true,
          phoneNumber: true,
        },
      });
      createdContact = true;
    }

    let conversation = await tx.conversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        channelId: channel.id,
        contactId: contact.id,
      },
      select: {
        id: true,
        lastMessageAt: true,
      },
    });

    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          channelId: channel.id,
          contactId: contact.id,
          agentId: channel.agentId,
          status: "OPEN",
        },
        select: {
          id: true,
          lastMessageAt: true,
        },
      });
      createdConversation = true;
    }

    return {
      contactId: contact.id,
      conversationId: conversation.id,
      createdContact,
      createdConversation,
      messagesImported: importedMessages.length,
    };
  });

  if (!contactAndConversation) {
    return {
      ok: false as const,
      error: "No se pudo crear o resolver la conversacion para la coincidencia seleccionada.",
    };
  }

  const { contactId, conversationId, createdContact, createdConversation } = contactAndConversation;

  if (importedMessages.length > 0) {
    try {
      for (let index = 0; index < importedMessages.length; index += 50) {
        const batch = importedMessages.slice(index, index + 50);
        await prisma.message.createMany({
          data: batch.map((messageDraft) => ({
            workspaceId: input.workspaceId,
            conversationId,
            channelId: channel.id,
            contactId,
            agentId: channel.agentId,
            externalId: messageDraft.externalId,
            direction: messageDraft.direction,
            type: messageDraft.type,
            status: messageDraft.status,
            content: messageDraft.content,
            mediaUrl: messageDraft.mediaUrl,
            createdAt: messageDraft.createdAt,
            sentAt: messageDraft.sentAt ?? undefined,
            rawPayload: messageDraft.rawPayload as never,
          })),
          skipDuplicates: true,
        });
      }

      const latestMessageAt = importedMessages.at(-1)?.createdAt ?? null;
      if (latestMessageAt) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: latestMessageAt,
            status: "OPEN",
          },
        });
      }
    } catch {
      return {
        ok: false as const,
        error: "No se pudieron guardar todos los mensajes importados para esta conversacion.",
      };
    }
  }

  return {
    ok: true as const,
    message:
      importedMessages.length > 0
        ? createdContact
          ? createdConversation
            ? `Se agrego el contacto, su conversacion y ${importedMessages.length} mensajes.`
            : `Se agrego el contacto y se actualizaron ${importedMessages.length} mensajes.`
          : createdConversation
            ? `Se agrego la conversacion y ${importedMessages.length} mensajes.`
            : `Se actualizaron ${importedMessages.length} mensajes.`
        : createdContact
          ? createdConversation
            ? "Se agrego el contacto y su conversacion local."
            : "Se agrego el contacto local."
          : createdConversation
            ? "Se agrego la conversacion local."
            : "Se sincronizo la conversacion local.",
    ...contactAndConversation,
  };
}

// Rescate automatico para el webhook: cuando llega un evento de contacto/chat pero
// Evolution no emitio (o se perdio) el MESSAGES_UPSERT, traemos los mensajes recientes
// de ese telefono via la API de Evolution y los persistimos. Es idempotente: apply usa
// createMany con skipDuplicates por externalId, asi que reimportar no duplica.
export async function backfillEvolutionMessagesByPhone(input: {
  workspaceId: string;
  channelId: string;
  phoneNumber: string;
  // Cantidad de mensajes mas recientes a traer. Por defecto IMPORT_RECENT_MESSAGE_LIMIT (20).
  importLimit?: number | null;
}): Promise<
  | { ok: true; imported: number; created: boolean }
  | { ok: false; reason: string }
> {
  const scan = await scanEvolutionChatSyncCandidateByPhone({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    phoneNumber: input.phoneNumber,
  });

  if (!scan.ok) {
    return { ok: false, reason: scan.error };
  }

  if (scan.kind !== "batch" || !scan.candidates.length) {
    // "none": no hay mensajes en Evolution para ese numero en este canal.
    return { ok: true, imported: 0, created: false };
  }

  const result = await applyEvolutionChatSyncCandidate({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    candidate: scan.candidates[0],
    importLimit: input.importLimit === undefined ? IMPORT_RECENT_MESSAGE_LIMIT : input.importLimit,
  });

  if (!result.ok) {
    return { ok: false, reason: result.error };
  }

  return {
    ok: true,
    imported: result.messagesImported ?? 0,
    created: Boolean(result.createdContact || result.createdConversation),
  };
}

/** Tope de seguridad: no rellenar huecos mas viejos que esto. */
const GAP_SYNC_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de chats por reconexion, para no golpear al gateway si el hueco fue enorme. */
const GAP_SYNC_MAX_CHATS = 40;

/**
 * Rellena los mensajes que entraron mientras el canal estuvo caido.
 *
 * El problema real que resuelve: si el gateway se desconecta, los mensajes llegan a WhatsApp
 * pero nunca al CRM, y NADIE se entera — un mensaje que no llego no deja hueco visible. Por eso
 * las asesoras terminan abriendo WhatsApp para verificar, y mientras tengan que verificar, no
 * confian en el CRM.
 *
 * Antes existia un backfill automatico que tapaba esto de casualidad, pero era CIEGO: importaba
 * ante cualquier evento de contacto, sin saber si faltaba algo. Revivia chats borrados, mataba
 * la bienvenida y llenaba el CRM de contactos que nunca escribieron (26 en un solo dia).
 *
 * Este es el mismo objetivo, pero mirando: `findChats` devuelve `updatedAt` por chat, asi que se
 * traen SOLO los chats con movimiento dentro del hueco. Un chat viejo y quieto no se toca.
 */
export async function syncEvolutionMessagesSince(input: {
  workspaceId: string;
  channelId: string;
  since: Date;
}): Promise<
  | { ok: true; chats: number; imported: number; skippedTooOld?: true }
  | { ok: false; reason: string }
> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, workspaceId: input.workspaceId, provider: "EVOLUTION" },
    select: { id: true, evolutionInstanceName: true, metadata: true },
  });

  if (!channel?.evolutionInstanceName) {
    return { ok: false, reason: "canal sin instancia Evolution" };
  }

  // Un hueco de semanas no es una desconexion: es un canal que estuvo apagado. Rellenarlo
  // solo traeria ruido viejo, que es justo lo que queremos evitar. Eso lo decide un humano
  // desde Conexion.
  const gapMs = Date.now() - input.since.getTime();
  if (gapMs > GAP_SYNC_MAX_WINDOW_MS) {
    return { ok: true, chats: 0, imported: 0, skippedTooOld: true };
  }

  const connection = readGatewayConnection(channel.metadata);
  // En Evolution GO no hay findChats: no se puede saber que chats se movieron durante el hueco.
  if (!supportsRemoteChatSync(connection)) {
    return { ok: false, reason: "el gateway del canal (Evolution GO) no expone findChats" };
  }

  const remoteChats = await fetchEvolutionChats(channel.evolutionInstanceName, connection);

  // Solo los chats que se movieron durante el hueco. `updatedAt` lo trae findChats.
  const sinceMs = input.since.getTime();
  const touched: Array<{ phone: string; at: number }> = [];
  for (const item of remoteChats) {
    const record = asRecord(item);
    if (!record) continue;

    const rawUpdatedAt = record.updatedAt ?? record.updated_at;
    const updatedAtMs = typeof rawUpdatedAt === "string" ? new Date(rawUpdatedAt).getTime() : NaN;
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < sinceMs) {
      continue;
    }

    const phone = extractComparablePhone(record);
    if (phone) {
      touched.push({ phone, at: updatedAtMs });
    }
  }

  // Los mas recientes primero: si hay que recortar, que sobrevivan los que importan.
  touched.sort((left, right) => right.at - left.at);
  const phones = Array.from(new Set(touched.map((item) => item.phone))).slice(0, GAP_SYNC_MAX_CHATS);

  let imported = 0;
  for (const phone of phones) {
    try {
      const result = await backfillEvolutionMessagesByPhone({
        workspaceId: input.workspaceId,
        channelId: channel.id,
        phoneNumber: phone,
      });
      if (result.ok) {
        imported += result.imported;
      }
    } catch {
      // Un chat que falla no puede abortar el resto del rescate.
    }
  }

  return { ok: true, chats: phones.length, imported };
}

/** Tipos de contenido de whatsmeow que sabemos mapear desde un HISTORYSYNC. */
function readHistorySyncMessageType(message: Record<string, unknown> | null) {
  if (!message) return "TEXT" as const;
  if (asRecord(message.imageMessage)) return "IMAGE" as const;
  if (asRecord(message.videoMessage)) return "VIDEO" as const;
  if (asRecord(message.audioMessage)) return "AUDIO" as const;
  if (asRecord(message.documentMessage)) return "DOCUMENT" as const;
  if (asRecord(message.stickerMessage)) return "STICKER" as const;
  if (asRecord(message.locationMessage)) return "LOCATION" as const;
  return "TEXT" as const;
}

function readHistorySyncText(message: Record<string, unknown> | null) {
  if (!message) return null;
  const direct = readString(message.conversation);
  if (direct) return direct;

  for (const key of ["extendedTextMessage", "imageMessage", "videoMessage", "documentMessage"]) {
    const inner = asRecord(message[key]);
    const text = readString(inner?.text) || readString(inner?.caption);
    if (text) return text;
  }

  return null;
}

// ===========================================================================
// Traer chats en Evolution GO: el history sync que manda el telefono al vincular
// ===========================================================================
//
// evogo no tiene findChats ni findMessages (ver supportsRemoteChatSync), asi que no hay
// a quien preguntarle "que chats tiene este telefono". Pero no hace falta preguntar: al vincular
// un dispositivo nuevo, WhatsApp EMPUJA el historial reciente del celular y evogo nos lo manda
// como eventos HISTORYSYNC (INITIAL_STATUS_V3, PUSH_NAME, RECENT —el gordo, cientos de KB— y
// FULL). Ese evento ya se guarda entero en WebhookEventLog. O sea: el historial de un canal
// recien conectado YA ESTA en nuestra base; lo unico que faltaba era usarlo.
//
// Por eso, en un canal GO, "Sincronizar chats" no llama al gateway: lee esos eventos.
//
// Ojo con la diferencia respecto de persistEvolutionHistorySync (mas abajo, el camino
// automatico del webhook): aquel NO crea contactos ni conversaciones a proposito, porque un
// history sync trae chats que nadie pidio y asi fue como el CRM se lleno de 26 leads que nunca
// escribieron. Este camino SI crea, porque no es automatico: un administrador abrio Conexion,
// vio la lista y eligio ese chat.

/** Hasta cuando mirar hacia atras: el sync de vinculacion llega una sola vez, ese dia. */
const HISTORY_SYNC_LOOKBACK_DAYS = 60;
/**
 * Cuantos eventos se leen. El de la vinculacion (RECENT) pesa ~650 KB, asi que esto es RAM del
 * servidor —que es justo lo que le falta— y no conviene subirlo. Una vinculacion son 4 eventos,
 * asi que 8 cubre la ultima con margen; los pedidos manuales del boton del chat son chicos.
 */
const HISTORY_SYNC_MAX_EVENTS = 8;
/** Cuantos chats se ofrecen por escaneo (se avisa en el mensaje cuando se recorta). */
const HISTORY_SYNC_MAX_CANDIDATES = 12;
/** Cuantos chats del historial se revisan contra la base local, del mas reciente al mas viejo. */
const HISTORY_SYNC_MAX_CHATS_SCANNED = 40;
/** Tope de mensajes por chat: acota la RAM y el tamaño de los `in` contra la base. */
const HISTORY_SYNC_MAX_MESSAGES_PER_CHAT = 300;
const HISTORY_SYNC_PREVIEW_LIMIT = 12;
/** Tope de adjuntos por importacion: cada uno es una descarga + descifrado en el servidor. */
const HISTORY_SYNC_MEDIA_LIMIT = 25;
/** Tope de adjuntos para una tanda entera (importar todos): se reparte entre los chats. */
const HISTORY_SYNC_BULK_MEDIA_LIMIT = 60;

type EvolutionGoHistoryMessage = {
  externalId: string;
  webMessage: UnknownRecord;
  content: UnknownRecord | null;
  createdAt: Date;
  fromMe: boolean;
  pushName: string | null;
};

type EvolutionGoHistoryChat = {
  phoneNumber: string;
  displayName: string | null;
  messages: EvolutionGoHistoryMessage[];
};

// Grupos, canales y estados no son chats de CRM: nadie los va a atender desde aca.
function isSyncableHistoryChatId(value: string) {
  const normalized = value.toLowerCase();
  return (
    !normalized.includes("@g.us") &&
    !normalized.includes("@newsletter") &&
    !normalized.includes("@broadcast") &&
    !normalized.startsWith("status@")
  );
}

/**
 * El history sync identifica casi todos los chats por **@lid**, no por telefono.
 *
 * Un LID ("20131166085305@lid") es un identificador interno de WhatsApp: no se le puede
 * escribir y no sirve como ficha de contacto ([[evolution.ts]] ya lo sufrio al enviar). El
 * traductor viene en el MISMO evento, en `phoneNumberToLidMappings`:
 *
 *     { pnJID: "573008544903@s.whatsapp.net", lidJID: "97732165370048@lid" }
 */
function readHistoryLidToPhoneMap(payloads: unknown[]) {
  const lidToPhone = new Map<string, string>();

  for (const payload of payloads) {
    const mappings = asRecord(asRecord(asRecord(payload)?.data)?.Data)?.phoneNumberToLidMappings;
    if (!Array.isArray(mappings)) {
      continue;
    }

    for (const rawMapping of mappings) {
      const mapping = asRecord(rawMapping);
      const phone = getComparablePhoneFromString(
        readString(mapping?.pnJID) ?? readString(mapping?.PnJID) ?? "",
      );
      const lidDigits = (readString(mapping?.lidJID) ?? readString(mapping?.LidJID) ?? "")
        .split("@")[0]
        ?.replace(/\D/g, "");

      if (phone && lidDigits) {
        lidToPhone.set(lidDigits, phone);
      }
    }
  }

  return lidToPhone;
}

/** El telefono de un chat del historial: directo si es un JID normal, traducido si es un LID. */
function resolveHistoryChatPhone(chatId: string, lidToPhone: Map<string, string>) {
  const digits = chatId.split("@")[0]?.replace(/\D/g, "") ?? "";

  if (chatId.toLowerCase().includes("@lid")) {
    return lidToPhone.get(digits) ?? null;
  }

  // Un telefono real no pasa de 13 digitos con indicativo (misma regla que en evolution.ts).
  return digits.length >= 7 && digits.length <= 13 ? getComparablePhoneFromString(chatId) : null;
}

function readHistorySyncDisplayName(conversation: UnknownRecord | null, messages: EvolutionGoHistoryMessage[]) {
  const fromConversation =
    readString(conversation?.name) ??
    readString(conversation?.Name) ??
    readString(conversation?.displayName) ??
    readString(conversation?.DisplayName);

  if (fromConversation) {
    return fromConversation;
  }

  // El pushName es como se llama el cliente en WhatsApp; solo sirve el de SUS mensajes (en los
  // nuestros viene el nombre de nuestra propia linea).
  return messages.find((message) => !message.fromMe && message.pushName)?.pushName ?? null;
}

/**
 * Reconstruye los chats del telefono a partir de los eventos HISTORYSYNC ya guardados.
 *
 * Devuelve los chats ordenados por su ultimo mensaje (el mas fresco primero) y con los mensajes
 * en orden cronologico, deduplicados por externalId: los eventos se pisan entre si (RECENT y
 * FULL repiten conversaciones) y el mismo mensaje aparece en varios.
 */
async function readEvolutionGoHistoryChats(instanceName: string): Promise<EvolutionGoHistoryChat[]> {
  // Se filtra en la base por los eventos que TRAEN conversaciones, no por los mas recientes.
  // Una vinculacion emite un chorro de eventos HISTORYSYNC y casi todos son avisos de avance
  // ({ progress, syncType, chunkOrder }, 222 bytes): pidiendo "los ultimos 8" salian 8 de esos
  // y el que importa —el RECENT de ~650 KB, con los chats— quedaba afuera. Asi tambien se
  // evita traer esos payloads gigantes al servidor para descartarlos aca.
  const since = new Date(Date.now() - HISTORY_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const logs = await prisma.$queryRaw<Array<{ payload: unknown }>>`
    SELECT "payload"
    FROM "WebhookEventLog"
    WHERE "provider" = 'EVOLUTION'
      AND "instanceName" = ${instanceName}
      AND "createdAt" >= ${since}
      AND (
        jsonb_typeof("payload"->'data'->'Data'->'conversations') = 'array'
        OR jsonb_typeof("payload"->'data'->'Data'->'phoneNumberToLidMappings') = 'array'
      )
    ORDER BY "createdAt" DESC
    LIMIT ${HISTORY_SYNC_MAX_EVENTS}
  `;

  const chats = new Map<string, EvolutionGoHistoryChat>();
  const seenMessageIds = new Set<string>();
  // Primero el traductor de LID a telefono: sin el, casi ningun chat es identificable.
  const lidToPhone = readHistoryLidToPhoneMap(logs.map((log) => log.payload));
  let unresolvedLids = 0;

  for (const log of logs) {
    const conversations = asRecord(asRecord(asRecord(log.payload)?.data)?.Data)?.conversations;
    if (!Array.isArray(conversations)) {
      continue;
    }

    for (const rawConversation of conversations) {
      const conversationRecord = asRecord(rawConversation);
      const chatId = readString(conversationRecord?.ID) ?? readString(conversationRecord?.id) ?? "";
      if (!chatId || !isSyncableHistoryChatId(chatId)) {
        continue;
      }

      const phoneNumber = resolveHistoryChatPhone(chatId, lidToPhone);
      const rawMessages = conversationRecord?.messages ?? conversationRecord?.Messages;
      if (!phoneNumber) {
        // Un LID sin traduccion es un chat al que no le podriamos escribir: se cuenta y se deja.
        unresolvedLids += 1;
        continue;
      }

      if (!Array.isArray(rawMessages) || !rawMessages.length) {
        continue;
      }

      const chat = chats.get(phoneNumber) ?? { phoneNumber, displayName: null, messages: [] };

      for (const rawItem of rawMessages) {
        const webMessage = asRecord(asRecord(rawItem)?.message) ?? asRecord(asRecord(rawItem)?.Message);
        const key = asRecord(webMessage?.key) ?? asRecord(webMessage?.Key);
        const externalId = readString(key?.ID) ?? readString(key?.id);
        if (!webMessage || !externalId || seenMessageIds.has(externalId)) {
          continue;
        }
        seenMessageIds.add(externalId);

        // Buena parte de lo que trae el historial son avisos internos de WhatsApp
        // (`messageStubType`, sin bloque `message`): no tienen nada que mostrar y como
        // mensajes serian burbujas vacias en el chat.
        const content = asRecord(webMessage.message) ?? asRecord(webMessage.Message);
        if (!content) {
          continue;
        }

        const timestampSeconds = Number(webMessage.messageTimestamp ?? webMessage.MessageTimestamp);
        chat.messages.push({
          externalId,
          webMessage,
          content,
          createdAt:
            Number.isFinite(timestampSeconds) && timestampSeconds > 0
              ? new Date(timestampSeconds * 1000)
              : new Date(),
          fromMe: key?.fromMe === true || key?.FromMe === true,
          pushName: readString(webMessage.pushName) ?? readString(webMessage.PushName),
        });
      }

      chat.displayName = chat.displayName ?? readHistorySyncDisplayName(conversationRecord, chat.messages);
      chats.set(phoneNumber, chat);
    }
  }

  // Hay eventos guardados pero no salio ni un chat: es un problema de FORMA del payload, y sin
  // esto solo se ve "no hay historial". Nunca hay que leer el payload de evogo por una ruta
  // fija de memoria: whatsmeow cuelga los bloques mas adentro y con otras mayusculas.
  if (!chats.size && logs.length) {
    const inner = asRecord(asRecord(asRecord(logs[0]?.payload)?.data)?.Data);
    const conversations = inner?.conversations;
    const firstConversation = Array.isArray(conversations) ? asRecord(conversations[0]) : null;
    const firstMessage = Array.isArray(firstConversation?.messages) ? firstConversation.messages[0] : null;

    console.warn("[chat-sync] history_shape", {
      instanceName,
      eventos: logs.length,
      conversaciones: Array.isArray(conversations) ? conversations.length : null,
      lidsSinTraduccion: unresolvedLids,
      lidsConocidos: lidToPhone.size,
      conversacionKeys: firstConversation ? Object.keys(firstConversation).slice(0, 15) : null,
      conversacionId: firstConversation ? JSON.stringify(firstConversation.ID ?? firstConversation.id) : null,
      mensajeSample: JSON.stringify(firstMessage ?? null).slice(0, 500),
      lidMappingSample: JSON.stringify(
        Array.isArray(inner?.phoneNumberToLidMappings) ? inner.phoneNumberToLidMappings[0] : null,
      ),
    });
  }

  const result = Array.from(chats.values()).filter((chat) => chat.messages.length > 0);

  for (const chat of result) {
    chat.messages.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    if (chat.messages.length > HISTORY_SYNC_MAX_MESSAGES_PER_CHAT) {
      chat.messages = chat.messages.slice(-HISTORY_SYNC_MAX_MESSAGES_PER_CHAT);
    }
  }

  result.sort(
    (left, right) =>
      (right.messages.at(-1)?.createdAt.getTime() ?? 0) - (left.messages.at(-1)?.createdAt.getTime() ?? 0),
  );

  return result;
}

function buildEvolutionGoHistoryCandidate(input: {
  chat: EvolutionGoHistoryChat;
  kind: EvolutionChatSyncCandidate["kind"];
  summary: string;
  needsContact: boolean;
  needsConversation: boolean;
}): EvolutionChatSyncCandidate {
  const { chat } = input;

  return {
    fingerprint: buildCandidateFingerprint({
      kind: input.kind,
      phoneNumber: chat.phoneNumber,
      remoteItemId: null,
    }),
    kind: input.kind,
    remotePhoneNumber: chat.phoneNumber,
    remoteDisplayName: chat.displayName,
    remoteJid: buildCanonicalRemoteJid(chat.phoneNumber),
    remoteJidAlt: null,
    remoteItemId: null,
    summary: input.summary,
    needsContact: input.needsContact,
    needsConversation: input.needsConversation,
    needsMessages: true,
    messagePreview: chat.messages.slice(-HISTORY_SYNC_PREVIEW_LIMIT).map((message) => ({
      id: message.externalId,
      direction: message.fromMe ? ("OUTBOUND" as const) : ("INBOUND" as const),
      type: readHistorySyncMessageType(message.content),
      content: readHistorySyncText(message.content),
      createdAt: message.createdAt.toISOString(),
      mediaUrl: null,
    })),
  };
}

/**
 * "Escaneo" de un canal Evolution GO: compara el historial que mando el telefono contra lo que
 * hay en la base local, y ofrece los chats a los que les falta algo.
 */
async function scanEvolutionGoHistoryCandidates(input: {
  workspaceId: string;
  channelId: string;
  instanceName: string;
  phoneNumber?: string | null;
}): Promise<EvolutionChatSyncScanResult | { ok: false; error: string }> {
  const allChats = await readEvolutionGoHistoryChats(input.instanceName);
  const chats = input.phoneNumber
    ? allChats.filter((chat) => chat.phoneNumber === input.phoneNumber)
    : allChats;

  console.log("[chat-sync] history_scan", {
    instanceName: input.instanceName,
    chatsEnElHistorial: allChats.length,
    mensajes: allChats.reduce((total, chat) => total + chat.messages.length, 0),
    filtradoPorNumero: input.phoneNumber ?? null,
  });

  if (!chats.length) {
    return {
      ok: true as const,
      kind: "none" as const,
      message: input.phoneNumber
        ? `No encontramos a ${input.phoneNumber} en el historial que mando el telefono al vincular este canal.`
        : "Este canal no tiene historial guardado. WhatsApp lo manda una sola vez, cuando se vincula el telefono: si el canal se conecto hace tiempo, hay que volver a escanear el QR para que lo mande de nuevo.",
    };
  }

  const [localContacts, localConversations] = await Promise.all([
    findLocalContactsByPhoneNumbers(
      input.workspaceId,
      chats.map((chat) => chat.phoneNumber),
    ),
    findLocalConversationsByChannel(input.workspaceId, input.channelId),
  ]);
  const localContactsByPhone = buildPhoneLookupMap(localContacts);
  const localConversationsByPhone = buildPhoneLookupMap(
    localConversations.map((conversation) => ({
      phoneNumber: conversation.contact.phoneNumber,
      id: conversation.id,
    })),
  );

  const candidates: EvolutionChatSyncCandidate[] = [];
  let truncated = false;

  // El telefono puede traer decenas de chats y la mayoria pueden estar ya completos. Se miran
  // los mas recientes y hasta un tope: sin esto, un telefono con 200 chats viejos serian 200
  // consultas para no ofrecer nada.
  for (const chat of chats.slice(0, HISTORY_SYNC_MAX_CHATS_SCANNED)) {
    if (candidates.length >= HISTORY_SYNC_MAX_CANDIDATES) {
      truncated = true;
      break;
    }

    const localContact = localContactsByPhone.get(chat.phoneNumber);
    const localConversation = localConversationsByPhone.get(chat.phoneNumber) ?? null;

    // Cuantos de estos mensajes NO tenemos. Es exacto y barato (un count por chat), y evita
    // ofrecer un chat que ya esta completo solo porque el telefono lo volvio a mandar.
    const alreadyStored = await prisma.message.count({
      where: {
        channelId: input.channelId,
        externalId: { in: chat.messages.map((message) => message.externalId) },
      },
    });
    const missing = chat.messages.length - alreadyStored;

    if (localConversation && missing <= 0) {
      continue;
    }

    const label = chat.displayName ? `${chat.displayName} (${chat.phoneNumber})` : chat.phoneNumber;

    candidates.push(
      buildEvolutionGoHistoryCandidate({
        chat,
        kind: localContact ? "CONVERSATION" : "CONTACT",
        needsContact: !localContact,
        needsConversation: !localConversation,
        summary: !localContact
          ? `${label} no existe en Chats. Se creara con ${missing} mensajes del historial del telefono.`
          : !localConversation
            ? `${label} existe pero no tiene conversacion en este canal. Se creara con ${missing} mensajes.`
            : `A ${label} le faltan ${missing} mensajes del historial del telefono.`,
      }),
    );
  }

  if (!candidates.length) {
    return {
      ok: true as const,
      kind: "none" as const,
      message: "Los chats del historial de este telefono ya estan completos en la base local.",
    };
  }

  return {
    ok: true as const,
    kind: "batch" as const,
    message: truncated
      ? `Mostramos los ${candidates.length} chats mas recientes del historial del telefono; volve a escanear despues de importarlos para ver los que siguen.`
      : `Encontramos ${candidates.length} ${candidates.length === 1 ? "chat" : "chats"} en el historial que mando el telefono al vincular este canal.`,
    candidates,
  };
}

/** Cuantos adjuntos quedan por bajar. Se comparte cuando se importan varios chats seguidos. */
type HistoryMediaBudget = { remaining: number };

/** Convierte los mensajes del history sync en el mismo borrador que usa la importacion normal. */
async function buildEvolutionGoHistoryImportedMessages(input: {
  instanceName: string;
  channelId: string;
  messages: EvolutionGoHistoryMessage[];
  mediaBudget?: HistoryMediaBudget;
}): Promise<EvolutionChatSyncImportedMessageDraft[]> {
  // Los que ya estan guardados no se vuelven a armar: lo caro no es la fila, es bajar otra vez
  // sus adjuntos (WhatsApp los manda cifrados y hay que pedirle a evogo que los descifre).
  const stored = await prisma.message.findMany({
    where: {
      channelId: input.channelId,
      externalId: { in: input.messages.map((message) => message.externalId) },
    },
    select: { externalId: true },
  });
  const storedIds = new Set(stored.map((message) => message.externalId));

  const drafts: EvolutionChatSyncImportedMessageDraft[] = [];
  const mediaBudget = input.mediaBudget ?? { remaining: HISTORY_SYNC_MEDIA_LIMIT };

  for (const message of input.messages) {
    if (storedIds.has(message.externalId)) {
      continue;
    }

    const type = readHistorySyncMessageType(message.content);
    const isMedia = type === "IMAGE" || type === "VIDEO" || type === "AUDIO" || type === "DOCUMENT" || type === "STICKER";

    let mediaUrl: string | null = null;
    if (isMedia && message.content && mediaBudget.remaining > 0) {
      try {
        const dataUrl = await fetchEvolutionGoMediaDataUrl({
          instanceName: input.instanceName,
          message: message.content,
        });
        mediaUrl = await persistChatMediaFromDataUrl({ dataUrl, mediaType: type });
        if (mediaUrl) {
          mediaBudget.remaining -= 1;
        }
      } catch {
        // WhatsApp borra los archivos viejos de sus servidores: el mensaje se guarda igual,
        // con su texto y su fecha, aunque el adjunto ya no se pueda bajar.
        mediaUrl = null;
      }
    }

    drafts.push({
      externalId: message.externalId,
      direction: message.fromMe ? "OUTBOUND" : "INBOUND",
      type,
      status: message.fromMe ? "SENT" : "RECEIVED",
      content: readHistorySyncText(message.content),
      mediaUrl,
      createdAt: message.createdAt,
      sentAt: message.fromMe ? message.createdAt : null,
      rawPayload: { source: "evogo-history-sync", evolution: message.webMessage },
    });
  }

  return drafts;
}

/** La importacion de un chat elegido, en canales Evolution GO. */
async function applyEvolutionGoHistoryCandidate(input: {
  workspaceId: string;
  channel: { id: string; agentId: string | null; evolutionInstanceName: string };
  candidate: EvolutionChatSyncCandidate;
  importLimit?: number | null;
  // Historial ya leido (importar todos lo lee una vez para toda la tanda) y presupuesto de
  // adjuntos compartido. Sin ellos se lee aca y el tope es el de un solo chat.
  historyChats?: EvolutionGoHistoryChat[];
  mediaBudget?: HistoryMediaBudget;
}) {
  const phoneNumber = normalizePhoneDigits(input.candidate.remotePhoneNumber);
  const chats = input.historyChats ?? (await readEvolutionGoHistoryChats(input.channel.evolutionInstanceName));
  const chat = chats.find((item) => item.phoneNumber === phoneNumber);

  if (!chat) {
    return {
      ok: false as const,
      error: "Ese chat ya no aparece en el historial guardado del canal. Volve a escanear.",
    };
  }

  const limit = input.importLimit;
  const selected = typeof limit === "number" && limit > 0 ? chat.messages.slice(-limit) : chat.messages;

  const importedMessages = await buildEvolutionGoHistoryImportedMessages({
    instanceName: input.channel.evolutionInstanceName,
    channelId: input.channel.id,
    messages: selected,
    mediaBudget: input.mediaBudget,
  });

  return persistEvolutionChatSyncCandidate({
    workspaceId: input.workspaceId,
    channel: input.channel,
    candidate: {
      ...input.candidate,
      remotePhoneNumber: phoneNumber ?? input.candidate.remotePhoneNumber,
      remoteDisplayName: input.candidate.remoteDisplayName ?? chat.displayName,
    },
    importedMessages,
  });
}

/**
 * Guarda los mensajes que llegan en un evento HISTORYSYNC de Evolution GO.
 *
 * Se dispara con POST /chat/history-sync (ver el boton de traer historial). El payload trae
 * `data.Data.conversations[].messages[].message`, cada uno un WebMessageInfo de whatsmeow.
 *
 * Dos decisiones que importan:
 *
 * 1. **No despierta al agente.** Estos mensajes NO pasan por el camino normal del webhook: si lo
 *    hicieran, el bot le contestaria a conversaciones de hace semanas. Ese fue exactamente el
 *    daño del backfill automatico que se quito (revivia chats y mataba la bienvenida).
 *
 * 2. **No crea contactos ni conversaciones.** Solo rellena chats que YA existen. Un history sync
 *    puede traer conversaciones enteras que nadie pidio, y crear contactos de ahi es lo que
 *    llenó el CRM de 26 leads que nunca escribieron. Si el chat no esta, se ignora.
 */
export async function persistEvolutionHistorySync(input: {
  workspaceId: string;
  channelId: string;
  instanceName: string;
  payload: unknown;
}): Promise<{ imported: number; chats: number; media: number }> {
  const root = asRecord(input.payload);
  const conversations = asRecord(asRecord(root?.data)?.Data)?.conversations;
  if (!Array.isArray(conversations)) {
    return { imported: 0, chats: 0, media: 0 };
  }

  let imported = 0;
  let chats = 0;
  let media = 0;

  for (const rawConversation of conversations) {
    const conversationRecord = asRecord(rawConversation);
    const phoneNumber = getComparablePhoneFromString(readString(conversationRecord?.ID) ?? "");
    const rawMessages = conversationRecord?.messages;
    if (!phoneNumber || !Array.isArray(rawMessages) || !rawMessages.length) {
      continue;
    }

    // Solo chats que ya existen: ver el punto 2 del comentario de arriba.
    const conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        contact: { phoneNumber: { in: buildPhoneVariants(phoneNumber) } },
      },
      select: { id: true, contactId: true },
    });

    if (!conversation) {
      continue;
    }

    chats += 1;

    for (const rawItem of rawMessages) {
      const webMessage = asRecord(asRecord(rawItem)?.message);
      const key = asRecord(webMessage?.key);
      const externalId = readString(key?.ID);
      if (!webMessage || !externalId) {
        continue;
      }

      const content = asRecord(webMessage.message);
      const timestampSeconds = Number(webMessage.messageTimestamp);
      const createdAt = Number.isFinite(timestampSeconds) && timestampSeconds > 0
        ? new Date(timestampSeconds * 1000)
        : new Date();

      const messageType = readHistorySyncMessageType(content);
      const isMedia =
        messageType === "IMAGE" ||
        messageType === "VIDEO" ||
        messageType === "AUDIO" ||
        messageType === "DOCUMENT" ||
        messageType === "STICKER";

      // Se pregunta ANTES de bajar nada. El boton se aprieta varias veces (cada una va mas atras
      // en el historial) y WhatsApp reenvia mensajes que ya teniamos: bajar sus adjuntos otra vez
      // seria descargar los catalogos de 7-15 MB en cada intento y duplicar archivos en disco.
      const existing = await prisma.message.findFirst({
        where: { channelId: input.channelId, externalId },
        select: { id: true, mediaUrl: true },
      });

      // Ya esta completo: nada que hacer.
      if (existing && (!isMedia || existing.mediaUrl)) {
        continue;
      }

      // Los adjuntos hay que bajarlos aparte: WhatsApp los guarda cifrados y evogo no expone
      // una URL, asi que sin esto quedaria el tipo (IMAGE/DOCUMENT/AUDIO) sin archivo, o sea una
      // burbuja rota. Se persiste en nuestro servidor —no se guarda el data URL en la BD— para
      // que el catalogo siga abriendo dentro de un año.
      let mediaUrl: string | null = null;
      if (isMedia) {
        const dataUrl = await fetchEvolutionGoMediaDataUrl({
          instanceName: input.instanceName,
          message: content,
        });

        mediaUrl = await persistChatMediaFromDataUrl({ dataUrl, mediaType: messageType });
        if (mediaUrl) {
          media += 1;
        }
      }

      // Estaba guardado pero sin archivo (fallo la descarga, o se importo antes de que
      // supieramos bajar adjuntos): se completa en vez de dejarlo roto para siempre.
      if (existing) {
        if (mediaUrl) {
          await prisma.message.update({ where: { id: existing.id }, data: { mediaUrl } });
        }
        continue;
      }

      try {
        // El unique (channelId, externalId) hace de deduplicador: un mensaje que ya teniamos
        // choca aca y se saltea, asi que el import es idempotente y se puede repetir.
        await prisma.message.create({
          data: {
            workspaceId: input.workspaceId,
            conversationId: conversation.id,
            channelId: input.channelId,
            contactId: conversation.contactId,
            externalId,
            direction: key?.fromMe === true ? "OUTBOUND" : "INBOUND",
            type: messageType,
            status: key?.fromMe === true ? "SENT" : "RECEIVED",
            content: readHistorySyncText(content),
            mediaUrl,
            createdAt,
            sentAt: key?.fromMe === true ? createdAt : null,
            rawPayload: { source: "evogo-history-sync", evolution: webMessage } as never,
          },
        });
        imported += 1;
      } catch (error) {
        // El chequeo de arriba ya filtra los que existen; aca solo cae una carrera (dos
        // importaciones del mismo chat a la vez). El unique (channelId, externalId) la corta y
        // no hay nada mas que hacer.
        const isDuplicate =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!isDuplicate) {
          throw error;
        }
      }
    }
  }

  return { imported, chats, media };
}
