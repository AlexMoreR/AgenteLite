import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureEvolutionInstanceFullHistory, resolveEvolutionMessageMediaUrl } from "@/lib/evolution";
import { getEvolutionSettings } from "@/lib/system-settings";
import {
  extractEvolutionFromMe,
  extractEvolutionMessageId,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionMediaUrl,
  extractEvolutionRemoteJid,
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

async function fetchEvolutionChatMessageRecords(instanceName: string, remoteJid: string, remoteJidAlt?: string | null) {
  const normalizedRemoteJids = buildRemoteJidSearchVariants(remoteJid, remoteJidAlt);
  const messagesById = new Map<string, UnknownRecord>();

  const filterMessagesForRemote = (messages: UnknownRecord[]) =>
    messages.filter((message) => {
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
    try {
      const directPayload = await evolutionSyncRequest<unknown>(`/chat/findMessages/${instanceName}`, {
        method: "POST",
        body: JSON.stringify({
          where: {
            key: {
              remoteJid: jid,
            },
          },
        }),
      });

      const directMessages = extractMessageRecordList(directPayload);
      const filteredDirectMessages = filterMessagesForRemote(directMessages);

      if (!filteredDirectMessages.length) {
        continue;
      }

      for (const message of filteredDirectMessages) {
        const messageId = buildMessageRecordIdentity(message, jid);
        if (!messagesById.has(messageId)) {
          messagesById.set(messageId, message);
        }
      }
    } catch {
      // If Evolution rejects one lookup path, keep scanning the rest.
    }
  }

  if (!messagesById.size) {
    let fallbackPayload: unknown = null;
    try {
      fallbackPayload = await evolutionSyncRequest<unknown>(`/messages/fetch/${instanceName}`, {
        method: "GET",
      });
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
function buildEvolutionChatMessagePreviewFromPayload(payload: unknown) {
  const normalizedPayload = asRecord(payload);
  if (!normalizedPayload) {
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
}) {
  const importedMessages: Array<{
    sourceIndex: number;
    draft: EvolutionChatSyncImportedMessageDraft;
  }> = [];
  const rawMessages = await fetchEvolutionChatMessageRecords(input.instanceName, input.remoteJid, input.remoteJidAlt);

  const seenMessageSignatures = new Set<string>();
  const seenExternalIds = new Set<string>();

  for (const [sourceIndex, rawMessage] of rawMessages.entries()) {
    const payload = rawMessage as unknown;
    try {
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
        try {
          mediaUrl = await resolveEvolutionMessageMediaUrl({
            instanceName: input.instanceName,
            messageId,
            mediaType: type,
            mediaUrl,
            rawPayload: payload,
          });
        } catch {
          mediaUrl = extractEvolutionMediaUrl(payload);
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
}) {
  const previewMessages: Array<{
    sourceIndex: number;
    preview: NonNullable<ReturnType<typeof buildEvolutionChatMessagePreviewFromPayload>>;
  }> = [];
  const seenPreviewSignatures = new Set<string>();
  const seenPreviewIds = new Set<string>();

  const enqueuePreview = (message: UnknownRecord, sourceIndex: number) => {
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

  const fallbackMessages = await fetchEvolutionChatMessageRecords(input.instanceName, input.remoteJid, input.remoteJidAlt);
  for (const [sourceIndex, message] of fallbackMessages.slice(-25).entries()) {
    enqueuePreview(message, sourceIndex);
  }

  return previewMessages
    .sort((left, right) => {
      const leftTime = new Date(left.preview.createdAt).getTime();
      const rightTime = new Date(right.preview.createdAt).getTime();

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.sourceIndex - right.sourceIndex;
    })
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

async function evolutionSyncRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken) {
    throw new Error("La configuracion global de WhatsApp no esta completa");
  }

  const response = await fetch(`${settings.apiBaseUrl.replace(/\/+$/, "")}${normalizeEvolutionPath(path)}`, {
    ...init,
    headers: {
      apikey: settings.apiToken,
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

async function fetchEvolutionChats(instanceName: string) {
  const payload = await evolutionSyncRequest<unknown>(`/chat/findChats/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({}),
  });

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
    },
  });

  if (!channel?.evolutionInstanceName) {
    return {
      ok: false as const,
      error: "El canal no tiene una instancia Evolution valida.",
    };
  }

  const remoteChats = await fetchEvolutionChats(channel.evolutionInstanceName);

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

export async function applyEvolutionChatSyncCandidate(input: {
  workspaceId: string;
  channelId: string;
  candidate: EvolutionChatSyncCandidate;
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

  await ensureEvolutionInstanceFullHistory(channel.evolutionInstanceName);

  let importedMessages: EvolutionChatSyncImportedMessageDraft[];
  try {
    importedMessages = await buildImportedEvolutionMessages({
      instanceName: channel.evolutionInstanceName,
      remoteJid: candidate.remoteJid ?? buildCanonicalRemoteJid(candidate.remotePhoneNumber) ?? "",
      remoteJidAlt: candidate.remoteJidAlt,
    });
  } catch {
    return {
      ok: false as const,
      error: "No se pudo leer el historial completo de Evolution para esta conversacion.",
    };
  }

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
      contact = await tx.contact.create({
        data: {
          workspaceId: input.workspaceId,
          phoneNumber: candidate.remotePhoneNumber,
          name: candidate.remoteDisplayName ?? null,
        },
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
