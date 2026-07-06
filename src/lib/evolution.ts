import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getEvolutionSettings } from "@/lib/system-settings";
import { persistedChatMediaFileExists } from "@/lib/chat-media-storage";

type EvolutionConnectResponse = {
  code?: string;
  qrcode?: string;
  pairingCode?: string;
  base64?: string;
  data?: {
    code?: string;
    qrcode?: string;
    pairingCode?: string;
    webhookUrl?: string;
  };
};

type EvolutionConnectionStateResponse = {
  instance?: {
    instanceName?: string;
    state?: string;
  };
  state?: string;
  status?: string;
  connectionStatus?: string;
  data?: {
    state?: string;
    status?: string;
    connectionStatus?: string;
  };
};

type EvolutionSendTextResponse = {
  key?: {
    id?: string;
  };
  message?: {
    key?: {
      id?: string;
    };
  };
  data?: {
    key?: {
      id?: string;
    };
    id?: string;
  };
  id?: string;
  messageId?: string;
  status?: string;
};

type EvolutionSendMediaResponse = EvolutionSendTextResponse;

type EvolutionProfilePictureResponse = {
  profilePictureUrl?: string | null;
};

type EvolutionInstanceRecord = {
  id?: string;
  name?: string;
  token?: string;
  qrcode?: string | null;
  webhook?: string | null;
  events?: string | null;
  connected?: boolean;
  instance?: {
    id?: string;
    name?: string;
    token?: string;
    instanceName?: string;
    owner?: string | null;
    ownerJid?: string | null;
    number?: string | null;
    phoneNumber?: string | null;
    wuid?: string | null;
    profileName?: string | null;
    profilePictureUrl?: string | null;
  };
  response?: unknown;
  data?: unknown;
};

type EvolutionPresence = "available" | "unavailable" | "composing" | "recording" | "paused";

type EvolutionResolvedInstance = {
  id: string | null;
  name: string;
  token: string | null;
  raw: EvolutionInstanceRecord | null;
};

type EvolutionStoredInstanceAuth = {
  id: string | null;
  token: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEvolutionState(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizePhoneValue(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.split("@")[0]?.replace(/\D/g, "") ?? "" : "";
  return normalized || null;
}

function normalizeEvolutionSendNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  // Grupos/newsletters usan JID; contactos individuales se envian como digitos.
  if (/@(g\.us|newsletter)$/i.test(trimmed)) {
    return trimmed;
  }

  return normalizePhoneValue(trimmed) ?? trimmed;
}

function extractInstancePayloadList(payload: unknown): EvolutionInstanceRecord[] {
  if (Array.isArray(payload)) {
    return payload as EvolutionInstanceRecord[];
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  if (Array.isArray(record.response)) {
    return record.response as EvolutionInstanceRecord[];
  }

  if (Array.isArray(record.data)) {
    return record.data as EvolutionInstanceRecord[];
  }

  if (record.response && asRecord(record.response)?.instance) {
    return [record.response as EvolutionInstanceRecord];
  }

  if (record.data && asRecord(record.data)?.instance) {
    return [record.data as EvolutionInstanceRecord];
  }

  if (record.instance) {
    return [record as EvolutionInstanceRecord];
  }

  return [];
}

function normalizeEvolutionPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function getInstanceRecordName(record: EvolutionInstanceRecord) {
  return readString(record.name) || readString(asRecord(record.instance)?.name) || readString(asRecord(record.instance)?.instanceName);
}

function getInstanceRecordId(record: EvolutionInstanceRecord) {
  return readString(record.id) || readString(asRecord(record.instance)?.id);
}

function getInstanceRecordToken(record: EvolutionInstanceRecord) {
  return readString(record.token) || readString(asRecord(record.instance)?.token);
}

function extractQrBase64Value(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const [base64Candidate] = normalized.split("|");
  return base64Candidate?.trim() || null;
}

function getInstanceRecordQrCode(record: EvolutionInstanceRecord) {
  return extractQrBase64Value(readString(record.qrcode) || readString(asRecord(record.instance)?.qrcode));
}

function getInstanceRecordWebhook(record: EvolutionInstanceRecord) {
  return readString(record.webhook) || readString(asRecord(record.instance)?.webhook);
}

function getInstanceRecordEvents(record: EvolutionInstanceRecord) {
  return readString(record.events) || readString(asRecord(record.instance)?.events);
}

function extractEvolutionConnectQrCode(response: EvolutionConnectResponse | null | undefined) {
  if (!response) {
    return null;
  }

  const responseData = asRecord(response.data);

  return (
    response.qrcode ||
    response.base64 ||
    response.code ||
    response.data?.qrcode ||
    response.data?.code ||
    readString(responseData?.Qrcode) ||
    readString(responseData?.Code) ||
    null
  );
}

function extractEvolutionPairingCode(response: EvolutionConnectResponse | null | undefined) {
  if (!response) {
    return null;
  }

  return response.pairingCode || response.data?.pairingCode || null;
}

function extractCreatedInstanceId(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);

  return readString(data?.id) || readString(root?.instanceId) || readString(root?.id) || null;
}

function extractCreatedInstanceToken(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);

  return readString(data?.token) || readString(root?.token) || null;
}

function debugEvolutionPayload(label: string, payload: unknown) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  try {
    console.log(`[EVOLUTION_DEBUG] ${label}`, JSON.stringify(payload, null, 2));
  } catch {
    console.log(`[EVOLUTION_DEBUG] ${label}`, payload);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEvolutionInstanceAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /instance already exists/i.test(message);
}

function isEvolutionNotAuthorizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not authorized/i.test(message);
}

async function ensureEvolutionInstanceConnectionSession(instance: EvolutionResolvedInstance | null) {
  if (!instance?.name) {
    return false;
  }

  const settings = await getEvolutionSettings();
  if (!settings.webhookBaseUrl) {
    return false;
  }

  try {
    if (instance.id || instance.token) {
      await evolutionRequest("/instance/connect", {
        method: "POST",
        headers: buildInstanceManagerHeaders(instance),
        body: JSON.stringify({
          webhookUrl: settings.webhookBaseUrl,
          subscribe: ["ALL"],
          immediate: true,
        }),
      });
    } else {
      await evolutionRequest("/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName: instance.name,
          name: instance.name,
          token: randomUUID(),
        }),
      });
    }

    debugEvolutionPayload("ensure_instance_connect_sent", {
      instanceName: instance.name,
      instanceId: instance.id,
      instanceToken: instance.token,
      webhookUrl: settings.webhookBaseUrl,
    });

    return true;
  } catch (error) {
    debugEvolutionPayload("ensure_instance_connect_failed", {
      instanceName: instance.name,
      instanceId: instance.id,
      instanceToken: instance.token,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function evolutionRequest<T>(
  path: string,
  init?: RequestInit,
  options: { requireWebhookBaseUrl?: boolean } = {},
): Promise<T> {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || (options.requireWebhookBaseUrl && !settings.webhookBaseUrl)) {
    throw new Error("La configuracion global de WhatsApp no esta completa");
  }

  const response = await fetch(`${settings.apiBaseUrl}${path}`, {
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

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json().catch(() => ({}))) as T;
}

async function evolutionRawRequest(
  path: string,
  init?: RequestInit,
  options: { requireWebhookBaseUrl?: boolean } = {},
) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || (options.requireWebhookBaseUrl && !settings.webhookBaseUrl)) {
    throw new Error("La configuracion global de WhatsApp no esta completa");
  }

  const response = await fetch(`${settings.apiBaseUrl}${path}`, {
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

  return response;
}

async function fetchEvolutionInstances() {
  try {
    const response = await evolutionRequest<EvolutionInstanceRecord[] | EvolutionInstanceRecord>("/instance/all", {
      method: "GET",
    });
    const records = extractInstancePayloadList(response);
    if (records.length > 0) {
      return records;
    }
  } catch {
    // Fall back to Evolution API legacy endpoint below.
  }

  const legacyResponse = await evolutionRequest<EvolutionInstanceRecord[] | EvolutionInstanceRecord>("/instance/fetchInstances", {
    method: "GET",
  });

  return extractInstancePayloadList(legacyResponse);
}

async function getStoredEvolutionInstanceAuth(instanceName: string): Promise<EvolutionStoredInstanceAuth | null> {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: { evolutionInstanceName: instanceName },
    select: {
      evolutionExternalKey: true,
      metadata: true,
    },
  });

  if (!channel) {
    return null;
  }

  const metadata = asRecord(channel.metadata);

  return {
    id: readString(channel.evolutionExternalKey),
    token: readString(metadata?.instanceToken) || readString(metadata?.token),
  };
}

async function resolveEvolutionInstance(instanceName: string): Promise<EvolutionResolvedInstance | null> {
  const normalizedInstanceName = instanceName.trim();
  if (!normalizedInstanceName) {
    return null;
  }

  try {
    const storedAuth = await getStoredEvolutionInstanceAuth(normalizedInstanceName);
    const records = await fetchEvolutionInstances();
    const record =
      records.find((item) => getInstanceRecordName(item) === normalizedInstanceName) ??
      records.find((item) => {
        const currentName = getInstanceRecordName(item);
        return typeof currentName === "string" && currentName.trim().toLowerCase() === normalizedInstanceName.toLowerCase();
      }) ??
      null;

    if (!record) {
      debugEvolutionPayload("resolve_instance_not_found", {
        instanceName: normalizedInstanceName,
        availableInstances: records.map((item) => ({
          id: getInstanceRecordId(item),
          name: getInstanceRecordName(item),
          token: getInstanceRecordToken(item),
        })),
        storedAuth,
      });
      return storedAuth
        ? {
            id: storedAuth.id,
            name: normalizedInstanceName,
            token: storedAuth.token,
            raw: null,
          }
        : null;
    }

    debugEvolutionPayload("resolve_instance_match", {
      requestedName: normalizedInstanceName,
      resolvedId: getInstanceRecordId(record) || storedAuth?.id,
      resolvedName: getInstanceRecordName(record),
      resolvedToken: getInstanceRecordToken(record) || storedAuth?.token,
      raw: record,
      storedAuth,
    });

    return {
      id: getInstanceRecordId(record) || storedAuth?.id || null,
      name: getInstanceRecordName(record) ?? normalizedInstanceName,
      token: getInstanceRecordToken(record) || storedAuth?.token || null,
      raw: record,
    };
  } catch {
    return null;
  }
}

function buildInstanceHeaders(instance: EvolutionResolvedInstance | null, options?: { useInstanceApiKey?: boolean }) {
  const headers: Record<string, string> = {};

  if (instance?.id) {
    headers.instanceId = instance.id;
  }

  if (options?.useInstanceApiKey && instance?.token) {
    headers.apikey = instance.token;
  }

  return headers;
}

function buildInstanceManagerHeaders(instance: EvolutionResolvedInstance | null) {
  if (instance?.token) {
    return { apikey: instance.token };
  }

  return buildInstanceHeaders(instance);
}

function extractEvolutionExternalId(response: EvolutionSendTextResponse | EvolutionSendMediaResponse) {
  return (
    response.key?.id ||
    response.message?.key?.id ||
    response.data?.key?.id ||
    response.data?.id ||
    response.id ||
    response.messageId ||
    null
  );
}

async function evolutionInstanceRequest<T>(input: {
  instanceName: string;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  legacyPath?: string;
  legacyBody?: unknown;
}) {
  const instance = await resolveEvolutionInstance(input.instanceName);
  const normalizedPath = normalizeEvolutionPath(input.path);
  const method = input.method ?? "POST";

  if (instance?.id || instance?.token) {
    try {
      return await evolutionRequest<T>(normalizedPath, {
        method,
        headers: buildInstanceHeaders(instance, { useInstanceApiKey: true }),
        ...(typeof input.body === "undefined" ? {} : { body: JSON.stringify(input.body) }),
      });
    } catch (error) {
      if (!input.legacyPath) {
        throw error;
      }
    }
  }

  if (!input.legacyPath) {
    throw new Error(`No se pudo resolver la instancia Evolution: ${input.instanceName}`);
  }

  const legacyRequestBody = input.legacyBody ?? input.body;
  return evolutionRequest<T>(normalizeEvolutionPath(input.legacyPath), {
    method,
    ...(typeof legacyRequestBody === "undefined" ? {} : { body: JSON.stringify(legacyRequestBody) }),
  });
}

function inferMediaMimeType(input: { mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT"; mimeType?: string | null }) {
  const declaredMimeType = input.mimeType?.trim().toLowerCase() || "";

  if (declaredMimeType.startsWith("image/")) {
    if (["image/jpg", "image/jpe", "image/jpeg", "image/pjpeg", "image/jfif"].includes(declaredMimeType)) {
      return "image/jpeg";
    }

    if (["image/png", "image/gif", "image/webp"].includes(declaredMimeType)) {
      return declaredMimeType;
    }
  } else if (declaredMimeType) {
    return declaredMimeType;
  }

  switch (input.mediaType) {
    case "IMAGE":
      return "image/jpeg";
    case "AUDIO":
      return "audio/ogg";
    case "VIDEO":
      return "video/mp4";
    case "STICKER":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function isSupportedOpenAIImageMimeType(mimeType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType.trim().toLowerCase());
}

function inferSupportedImageMimeType(contentType: string, bytes: Buffer) {
  const normalizedContentType = contentType.trim().toLowerCase();

  if (normalizedContentType.startsWith("image/")) {
    if (["image/jpg", "image/jpe", "image/jpeg", "image/pjpeg", "image/jfif"].includes(normalizedContentType)) {
      return "image/jpeg";
    }

    if (isSupportedOpenAIImageMimeType(normalizedContentType)) {
      return normalizedContentType;
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function normalizeBase64DataUrl(base64Like: string, mimeType: string) {
  const trimmed = base64Like.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, "");
  const padded = compact.padEnd(compact.length + ((4 - (compact.length % 4)) % 4), "=");
  const looksLikeBase64 =
    compact.length > 32 &&
    /^[A-Za-z0-9+/=]+$/.test(compact) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(padded);

  if (!looksLikeBase64) {
    return null;
  }

  return `data:${mimeType};base64,${padded}`;
}

// Los hosts del CDN de WhatsApp (mmg/a.whatsapp.net, *.cdn.whatsapp.net) sirven
// medios CIFRADOS que no se pueden descargar con un fetch directo desde el navegador
// ni desde el servidor. Solo se obtienen via la API de Evolution (getBase64...).
// Tratarlos como "renderizables" provoca imagenes rotas y cuelgues de DNS en el proxy.
export function isWhatsAppCdnMediaUrl(value?: string | null) {
  if (!value) {
    return false;
  }

  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === "whatsapp.net" || host.endsWith(".whatsapp.net");
  } catch {
    return false;
  }
}

function isRenderableMediaUrl(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  const isUrlLike =
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://");

  return isUrlLike && !isWhatsAppCdnMediaUrl(value);
}

function extractBase64Candidate(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return readString(value);
  }

  const direct =
    readString(record.base64) ||
    readString(record.data) ||
    readString(record.media) ||
    readString(record.file) ||
    readString(record.buffer) ||
    readString(record.result) ||
    readString(record.message);

  if (direct) {
    return direct;
  }

  return (
    extractBase64Candidate(record.response) ||
    extractBase64Candidate(record.data) ||
    extractBase64Candidate(record.message) ||
    extractBase64Candidate(record.result)
  );
}

function bytesLikeToBase64(value: unknown) {
  const toBase64 = (bytes: number[]) => {
    if (bytes.length === 0) {
      return null;
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return Buffer.from(binary, "binary").toString("base64");
  };

  if (value instanceof Uint8Array) {
    return toBase64(Array.from(value));
  }

  if (Array.isArray(value)) {
    const bytes = value.filter((item): item is number => typeof item === "number");
    return toBase64(bytes);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const numericEntries = Object.entries(value)
    .filter(([key, entryValue]) => /^\d+$/.test(key) && typeof entryValue === "number")
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, entryValue]) => entryValue as number);

  return toBase64(numericEntries);
}

function extractImageThumbnailDataUrl(payload: unknown, mimeType = "image/jpeg") {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message) ?? asRecord(root?.message);
  const imageMessage = asRecord(message?.imageMessage);
  const contextInfo = asRecord(data?.contextInfo) ?? asRecord(message?.contextInfo);
  const externalAdReply = asRecord(contextInfo?.externalAdReply);

  const thumbnailBytes =
    imageMessage?.jpegThumbnail ??
    imageMessage?.thumbnail ??
    externalAdReply?.thumbnail ??
    data?.thumbnail ??
    root?.thumbnail;

  const base64 =
    bytesLikeToBase64(thumbnailBytes) ||
    extractBase64Candidate(thumbnailBytes) ||
    extractBase64Candidate(imageMessage?.thumbnailUrl) ||
    extractBase64Candidate(externalAdReply?.thumbnailUrl);

  if (!base64) {
    return null;
  }

  if (base64.startsWith("data:")) {
    return base64;
  }

  return `data:${mimeType};base64,${base64}`;
}

function extractEvolutionMessageIdFromPayload(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const info = asRecord(data?.Info) ?? asRecord(root?.Info);
  const message = getEvolutionPayloadMessageRecord(payload);
  const key = asRecord(data?.key) ?? asRecord(data?.Key) ?? asRecord(root?.key) ?? asRecord(root?.Key) ?? asRecord(message?.key);

  return (
    readString(key?.id) ||
    readString(info?.ID) ||
    readString(info?.Id) ||
    readString(info?.id) ||
    readString(data?.messageId) ||
    readString(root?.messageId) ||
    readString(message?.id) ||
    null
  );
}

function getEvolutionPayloadMessageRecord(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const update = asRecord(root?.update);

  return (
    asRecord(data?.message) ??
    asRecord(data?.Message) ??
    asRecord(update?.message) ??
    asRecord(update?.Message) ??
    asRecord(root?.message) ??
    asRecord(root?.Message)
  );
}

function getEvolutionPayloadMediaRecord(
  message: Record<string, unknown> | null,
  mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT",
) {
  if (!message) {
    return null;
  }

  if (mediaType === "IMAGE") return asRecord(message.imageMessage) ?? asRecord(message.ImageMessage);
  if (mediaType === "AUDIO") return asRecord(message.audioMessage) ?? asRecord(message.AudioMessage);
  if (mediaType === "VIDEO") return asRecord(message.videoMessage) ?? asRecord(message.VideoMessage);
  if (mediaType === "STICKER") return asRecord(message.stickerMessage) ?? asRecord(message.StickerMessage);

  return asRecord(message.documentMessage) ?? asRecord(message.DocumentMessage);
}

function extractRenderableImageUrlFromPayload(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = getEvolutionPayloadMessageRecord(payload);
  const imageMessage = getEvolutionPayloadMediaRecord(message, "IMAGE");

  const candidate =
    readString(imageMessage?.directPath) ||
    readString(imageMessage?.url) ||
    readString(imageMessage?.URL) ||
    readString(data?.mediaUrl) ||
    readString(data?.media) ||
    readString(data?.url);

  return isRenderableMediaUrl(candidate) ? candidate : null;
}

function extractRenderableMediaUrlFromPayload(payload: unknown, mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT") {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = getEvolutionPayloadMessageRecord(payload);
  const mediaMessage = getEvolutionPayloadMediaRecord(message, mediaType);

  const candidate =
    readString(mediaMessage?.url) ||
    readString(mediaMessage?.URL) ||
    readString(mediaMessage?.directPath) ||
    readString(data?.mediaUrl) ||
    readString(data?.media) ||
    readString(data?.url);

  return isRenderableMediaUrl(candidate) ? candidate : null;
}

function extractPayloadMediaDataUrl(payload: unknown, mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT") {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = getEvolutionPayloadMessageRecord(payload);
  const mediaMessage = getEvolutionPayloadMediaRecord(message, mediaType);
  const mimeType = inferMediaMimeType({
    mediaType,
    mimeType:
      readString(mediaMessage?.mimetype) ||
      readString(mediaMessage?.Mimetype) ||
      readString(mediaMessage?.mimeType) ||
      readString(data?.mimetype) ||
      readString(data?.mimeType),
  });

  const base64Candidate =
    readString(message?.base64) ||
    readString(message?.Base64) ||
    readString(data?.base64) ||
    readString(data?.Base64) ||
    extractBase64Candidate(mediaMessage);

  return normalizeBase64DataUrl(base64Candidate || "", mimeType);
}

export async function fetchEvolutionMediaDataUrl(input: {
  instanceName: string;
  messageId: string;
  mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";
  mimeType?: string | null;
}) {
  try {
    const response = await evolutionRawRequest(`/chat/getBase64FromMediaMessage/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          key: {
            id: input.messageId,
          },
        },
        convertToMp4: input.mediaType === "VIDEO",
      }),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    const mimeType = inferMediaMimeType(input);

    if (contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/")) {
      const buffer = Buffer.from(await response.arrayBuffer());

      if (input.mediaType === "IMAGE" || input.mediaType === "STICKER") {
        const supportedMimeType = inferSupportedImageMimeType(contentType, buffer);
        if (!supportedMimeType) {
          return null;
        }

        return `data:${supportedMimeType};base64,${buffer.toString("base64")}`;
      }

      return `data:${contentType};base64,${buffer.toString("base64")}`;
    }

    if (!contentType.includes("application/json")) {
      const rawText = await response.text().catch(() => "");
      return normalizeBase64DataUrl(rawText, mimeType);
    }

    const payload = await response.json().catch(() => null);
    const base64Candidate = extractBase64Candidate(payload);
    return normalizeBase64DataUrl(base64Candidate || "", mimeType);
  } catch {
    return null;
  }
}

export async function resolveEvolutionMessageMediaUrl(input: {
  instanceName?: string | null;
  messageId?: string | null;
  mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";
  mediaUrl?: string | null;
  rawPayload?: unknown;
}) {
  if (input.mediaUrl?.trim().startsWith("data:") || input.mediaUrl?.trim().startsWith("blob:")) {
    return input.mediaUrl ?? null;
  }

  // Medio ya persistido en el almacenamiento propio de AgenteLite: es una URL estable
  // y renderable, no hay que re-resolver el binario contra Evolution. PERO la BD es
  // compartida entre entornos: una fila puede apuntar a un binario que solo se escribio
  // en OTRO servidor (p.ej. el webhook lo proceso el desplegado y este es local). Si el
  // archivo no existe en ESTE disco, no devolvemos una ruta rota: caemos a re-resolver
  // contra Evolution mas abajo (auto-reparacion).
  if (input.mediaUrl?.trim().startsWith("/uploads/chat-media/")) {
    if (await persistedChatMediaFileExists(input.mediaUrl)) {
      return input.mediaUrl ?? null;
    }
  }

  const payloadMessageId = input.rawPayload ? extractEvolutionMessageIdFromPayload(input.rawPayload) : null;
  const resolvedMessageId = payloadMessageId || input.messageId?.trim() || null;
  const payloadMediaDataUrl = input.rawPayload ? extractPayloadMediaDataUrl(input.rawPayload, input.mediaType) : null;

  if (payloadMediaDataUrl) {
    return payloadMediaDataUrl;
  }

  if (input.mediaType === "AUDIO") {
    if (input.instanceName?.trim() && resolvedMessageId) {
      const resolved = await fetchEvolutionMediaDataUrl({
        instanceName: input.instanceName.trim(),
        messageId: resolvedMessageId,
        mediaType: input.mediaType,
      });

      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  if (
    input.instanceName?.trim() &&
    resolvedMessageId &&
    (input.mediaType === "IMAGE" || input.mediaType === "STICKER")
  ) {
    const resolved = await fetchEvolutionMediaDataUrl({
      instanceName: input.instanceName.trim(),
      messageId: resolvedMessageId,
      mediaType: input.mediaType,
    });

    if (resolved) {
      return resolved;
    }
  }

  if (input.rawPayload) {
    const renderableUrl = extractRenderableMediaUrlFromPayload(input.rawPayload, input.mediaType);
    if (renderableUrl) {
      return renderableUrl;
    }
  }

  // En Evolution muchas veces la URL persistida no es utilizable directamente
  // desde el navegador; primero intentamos resolver el binario real desde la API.
  if (input.instanceName?.trim() && resolvedMessageId) {
    const resolved = await fetchEvolutionMediaDataUrl({
      instanceName: input.instanceName.trim(),
      messageId: resolvedMessageId,
      mediaType: input.mediaType,
    });

    if (resolved) {
      return resolved;
    }
  }

  if ((input.mediaType === "IMAGE" || input.mediaType === "STICKER") && input.rawPayload) {
    const renderableImageUrl = extractRenderableImageUrlFromPayload(input.rawPayload);
    if (renderableImageUrl) {
      return renderableImageUrl;
    }
  }

  if (isRenderableMediaUrl(input.mediaUrl)) {
    return input.mediaUrl ?? null;
  }

  if ((input.mediaType === "IMAGE" || input.mediaType === "STICKER") && input.rawPayload) {
    const thumbnailUrl = extractImageThumbnailDataUrl(input.rawPayload);
    if (thumbnailUrl) {
      return thumbnailUrl;
    }
  }

  // No persistir URLs del CDN de WhatsApp: no son descargables y rompen la UI/proxy.
  if (isWhatsAppCdnMediaUrl(input.mediaUrl)) {
    return null;
  }

  // Si llegamos hasta aqui con una ruta persistida local, es porque el archivo NO existe
  // en este servidor (se verifico al inicio) y no se pudo re-resolver: devolver la ruta
  // daria una imagen rota, mejor null para que la UI muestre el placeholder de medio.
  if (input.mediaUrl?.trim().startsWith("/uploads/chat-media/")) {
    return null;
  }

  return input.mediaUrl || null;
}

export async function getEvolutionConnectionState(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken) {
    return null;
  }

  try {
    const instance = await resolveEvolutionInstance(instanceName);

    if (instance?.id || instance?.token) {
      const response = await evolutionRequest<{
        data?: { Connected?: boolean; LoggedIn?: boolean; Name?: string };
        message?: string;
      }>("/instance/status", {
        method: "GET",
        headers: buildInstanceManagerHeaders(instance),
      });

      if (typeof response.data?.LoggedIn === "boolean") {
        if (response.data.LoggedIn) {
          return "connected";
        }

        if (response.data.Connected === true) {
          return "connecting";
        }

        return "disconnected";
      }

      if (typeof response.data?.Connected === "boolean") {
        return response.data.Connected ? "connected" : "disconnected";
      }
    }

    const response = await evolutionRequest<EvolutionConnectionStateResponse>(`/instance/connectionState/${instanceName}`, {
      method: "GET",
    });

    return (
      normalizeEvolutionState(response.instance?.state) ||
      normalizeEvolutionState(response.state) ||
      normalizeEvolutionState(response.status) ||
      normalizeEvolutionState(response.connectionStatus) ||
      normalizeEvolutionState(response.data?.state) ||
      normalizeEvolutionState(response.data?.status) ||
      normalizeEvolutionState(response.data?.connectionStatus)
    );
  } catch {
    return null;
  }
}

export async function getEvolutionConnectionQr(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken) {
    return { qrCode: null, pairingCode: null };
  }

  try {
    const instance = await resolveEvolutionInstance(instanceName);

    if (instance?.id || instance?.token) {
      // Si la instancia ya existe pero aun no genero QR, no debemos disparar
      // /instance/connect en cada poll de la UI; eso termina saturando Evolution.
      const needsConnectBootstrap =
        !instance.raw || !getInstanceRecordWebhook(instance.raw ?? {}) || !getInstanceRecordEvents(instance.raw ?? {});

      if (needsConnectBootstrap) {
        await ensureEvolutionInstanceConnectionSession(instance);
        await sleep(2000);
      }

      try {
        const response = await evolutionRequest<EvolutionConnectResponse & { qrCode?: string; qrcode?: string }>("/instance/qr", {
          method: "GET",
          headers: buildInstanceManagerHeaders(instance),
        });

        debugEvolutionPayload("instance_qr_response", {
          instanceName,
          instanceId: instance.id,
          instanceToken: instance.token,
          response,
        });

        return {
          qrCode: response.qrCode || extractEvolutionConnectQrCode(response) || getInstanceRecordQrCode(instance.raw ?? {}) || null,
          pairingCode: extractEvolutionPairingCode(response),
        };
      } catch (error) {
        if (!isEvolutionNotAuthorizedError(error)) {
          throw error;
        }
      }
    }

    const response = await evolutionRequest<EvolutionConnectResponse>(`/instance/${instanceName}/qrcode`, {
      method: "GET",
    });

    debugEvolutionPayload("legacy_instance_qrcode_response", {
      instanceName,
      response,
    });

    return {
      qrCode: extractEvolutionConnectQrCode(response),
      pairingCode: extractEvolutionPairingCode(response),
    };
  } catch (error) {
    debugEvolutionPayload("instance_qr_failed", {
      instanceName,
      error: error instanceof Error ? error.message : String(error),
    });
    return { qrCode: null, pairingCode: null };
  }
}

export async function fetchEvolutionInstanceProfile(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !instanceName) {
    return null;
  }

  try {
    const records = await fetchEvolutionInstances();
    const instanceRecord =
      records.find((item) => getInstanceRecordName(item) === instanceName) ??
      records.find((item) => {
        const currentName = getInstanceRecordName(item);
        return typeof currentName === "string" && currentName.trim().toLowerCase() === instanceName.toLowerCase();
      }) ??
      null;
    const instance = asRecord(instanceRecord?.instance);

    if (!instanceRecord) {
      return null;
    }

    return {
      owner:
        normalizePhoneValue(readString(instance?.owner)) ||
        normalizePhoneValue(readString(instance?.ownerJid)) ||
        normalizePhoneValue(readString(instance?.number)) ||
        normalizePhoneValue(readString(instance?.phoneNumber)) ||
        normalizePhoneValue(readString(instance?.wuid)),
      profileName: readString(instance?.profileName),
      profilePictureUrl: readString(instance?.profilePictureUrl),
    };
  } catch {
    return null;
  }
}

export async function createEvolutionChannel(input: {
  workspaceId: string;
  name: string;
  agentId?: string | null;
}) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !settings.webhookBaseUrl) {
    throw new Error("Completa primero la configuracion global de WhatsApp");
  }

  const normalizedPrefix = settings.instancePrefix.trim().toLowerCase() || "instancia";
  const remoteInstances = await fetchEvolutionInstances().catch(() => []);
  const usedInstanceNames = new Set(
    remoteInstances
      .map((item) => getInstanceRecordName(item)?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  let sequence = (await prisma.whatsAppChannel.count()) + 1;
  let instanceName = `${normalizedPrefix}-${sequence}`;

  while (true) {
    const existingChannel = await prisma.whatsAppChannel.findUnique({
      where: { evolutionInstanceName: instanceName },
      select: { id: true },
    });

    if (!existingChannel && !usedInstanceNames.has(instanceName.toLowerCase())) {
      break;
    }

    sequence += 1;
    instanceName = `${normalizedPrefix}-${sequence}`;
  }

  let createdResponse:
    | {
        data?: { id?: string; token?: string; name?: string };
        id?: string;
        token?: string;
        instanceId?: string;
        instanceName?: string;
      }
    | null = null;

  while (!createdResponse) {
    try {
      createdResponse = await evolutionRequest<{
        data?: { id?: string; token?: string; name?: string };
        id?: string;
        token?: string;
        instanceId?: string;
        instanceName?: string;
      }>("/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          name: instanceName,
          token: randomUUID(),
        }),
      });
    } catch (error) {
      if (!isEvolutionInstanceAlreadyExistsError(error)) {
        throw error;
      }

      usedInstanceNames.add(instanceName.toLowerCase());
      sequence += 1;
      instanceName = `${normalizedPrefix}-${sequence}`;
    }
  }

  const createdInstanceId = extractCreatedInstanceId(createdResponse);
  const createdInstanceToken = extractCreatedInstanceToken(createdResponse);

  let connectData: EvolutionConnectResponse = {};
  let connectedInstanceSnapshot: EvolutionInstanceRecord | null = null;
  try {
    if (createdInstanceId || createdInstanceToken) {
      await evolutionRequest("/instance/connect", {
        method: "POST",
        headers: buildInstanceManagerHeaders({
          id: createdInstanceId,
          name: instanceName,
          token: createdInstanceToken,
          raw: null,
        }),
        body: JSON.stringify({
          webhookUrl: settings.webhookBaseUrl,
          subscribe: ["ALL"],
          immediate: true,
        }),
      });

      await sleep(2000);

      connectData = await evolutionRequest<EvolutionConnectResponse>("/instance/qr", {
        method: "GET",
        headers: buildInstanceManagerHeaders({
          id: createdInstanceId,
          name: instanceName,
          token: createdInstanceToken,
          raw: null,
        }),
      }).catch(() => ({}));

      connectedInstanceSnapshot =
        (await fetchEvolutionInstances().then(
          (records) =>
            records.find((item) => getInstanceRecordId(item) === createdInstanceId) ??
            records.find((item) => getInstanceRecordName(item) === instanceName) ??
            null,
        ).catch(() => null)) ?? null;
    } else {
      connectData = await evolutionRequest<EvolutionConnectResponse>(`/instance/connect/${instanceName}`, {
        method: "GET",
      });
    }
  } catch {
    // Si Evolution crea la instancia pero tarda en devolver el QR,
    // dejamos el canal en CONNECTING y esperamos los webhooks.
  }

  const qrCode = extractEvolutionConnectQrCode(connectData) || getInstanceRecordQrCode(connectedInstanceSnapshot ?? {}) || null;
  const pairingCode = extractEvolutionPairingCode(connectData);

  const channel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      provider: "EVOLUTION",
      name: input.name,
      evolutionInstanceName: instanceName,
      evolutionExternalKey: createdInstanceId,
      status: qrCode ? "QRCODE" : "CONNECTING",
      qrCode,
      metadata: {
        pairingCode,
        webhookUrl: getInstanceRecordWebhook(connectedInstanceSnapshot ?? {}) || settings.webhookBaseUrl,
        subscribedEvents: getInstanceRecordEvents(connectedInstanceSnapshot ?? {}) || "ALL",
        ...(createdInstanceToken ? { instanceToken: createdInstanceToken } : {}),
      },
    },
    select: {
      id: true,
      evolutionInstanceName: true,
    },
  });

  return {
    channelId: channel.id,
    instanceName: channel.evolutionInstanceName,
  };
}

export async function ensureEvolutionInstanceFullHistory(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !instanceName) {
    return false;
  }

  try {
    const response = await evolutionRequest<{ sync_full_history?: boolean; syncFullHistory?: boolean }>(
      `/settings/find/${instanceName}`,
      {
        method: "GET",
      },
    );

    const currentValue = response.syncFullHistory ?? response.sync_full_history ?? null;
    if (currentValue === true) {
      return true;
    }
  } catch {
    // Si no podemos leer la configuración, intentamos forzar el valor igualmente.
  }

  try {
    await evolutionRequest(`/settings/set/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        rejectCall: true,
        groupsIgnore: true,
        alwaysOnline: true,
        readMessages: true,
        readStatus: true,
        syncFullHistory: true,
      }),
    });

    return true;
  } catch {
    return false;
  }
}

export async function createEvolutionChannelForAgent(input: {
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
}) {
  return createEvolutionChannel({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    name: `WhatsApp ${input.agentName}`,
  });
}

export async function deleteEvolutionInstance(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken) {
    return;
  }

  const instance = await resolveEvolutionInstance(instanceName);
  if (instance?.id) {
    await evolutionRequest(`/instance/${instance.id}`, {
      method: "DELETE",
      headers: buildInstanceHeaders(instance),
    }).catch(async () => {
      await evolutionRequest(`/instance/delete/${instanceName}`, {
        method: "DELETE",
      });
    });
    return;
  }

  await evolutionRequest(`/instance/delete/${instanceName}`, {
    method: "DELETE",
  });
}

export async function sendEvolutionTextMessage(input: {
  instanceName: string;
  phoneNumber: string;
  text: string;
  delayMs?: number;
  quoted?: { id: string; remoteJid?: string; fromMe?: boolean; text?: string } | null;
}) {
  const sendNumber = normalizeEvolutionSendNumber(input.phoneNumber);
  const response = await evolutionInstanceRequest<EvolutionSendTextResponse>({
    instanceName: input.instanceName,
    path: "/send/text",
    legacyPath: `/message/sendText/${input.instanceName}`,
    body: {
      number: sendNumber,
      text: input.text,
      delay: input.delayMs ?? 1200,
    },
    legacyBody: {
      number: sendNumber,
      text: input.text,
      delay: input.delayMs ?? 1200,
      ...(input.quoted?.id
        ? {
            quoted: {
              key: {
                id: input.quoted.id,
                fromMe: input.quoted.fromMe ?? false,
                ...(input.quoted.remoteJid ? { remoteJid: input.quoted.remoteJid } : {}),
              },
            },
          }
        : {}),
    },
  });

  return {
    externalId: extractEvolutionExternalId(response),
    raw: response,
  };
}

export async function deleteEvolutionMessageForEveryone(input: {
  instanceName: string;
  key: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
}) {
  await evolutionInstanceRequest({
    instanceName: input.instanceName,
    path: "/message/delete",
    method: "POST",
    legacyPath: `/chat/deleteMessageForEveryone/${input.instanceName}`,
    body: {
      chat: input.key.remoteJid,
      messageId: input.key.id,
    },
    legacyBody: {
      id: input.key.id,
      remoteJid: input.key.remoteJid,
      fromMe: input.key.fromMe,
      ...(input.key.participant ? { participant: input.key.participant } : {}),
    },
  });
}

async function sendEvolutionMediaRequest(input: {
  instanceName: string;
  phoneNumber: string;
  type: "image" | "audio" | "video" | "document";
  media: string;
  mediaSource?: "url" | "base64";
  fileName: string;
  mimetype?: string | null;
  caption?: string | null;
  delayMs?: number;
  legacyPath?: string;
  legacyBody: Record<string, unknown>;
}) {
  const sendNumber = normalizeEvolutionSendNumber(input.phoneNumber);
  const mediaSource = input.mediaSource ?? "url";
  const mediaValue = input.media.trim();
  const normalizedCaption = input.caption?.trim() || "";
  const baseMediaBody = {
    number: sendNumber,
    type: input.type,
    mediatype: input.type,
    filename: input.fileName,
    fileName: input.fileName,
    caption: normalizedCaption,
    delay: input.delayMs ?? 1200,
    ...(input.mimetype?.trim() ? { mimetype: input.mimetype.trim() } : {}),
  };
  const response = await evolutionInstanceRequest<EvolutionSendMediaResponse>({
    instanceName: input.instanceName,
    path: "/send/media",
    legacyPath: input.legacyPath ?? `/message/sendMedia/${input.instanceName}`,
    body:
      mediaSource === "base64"
        ? {
            ...baseMediaBody,
            base64: mediaValue,
            media: mediaValue,
          }
        : {
            ...baseMediaBody,
            url: mediaValue,
            media: mediaValue,
          },
    legacyBody: input.legacyBody,
  });

  return {
    externalId: extractEvolutionExternalId(response),
    raw: response,
  };
}

export async function sendEvolutionImageMessage(input: {
  instanceName: string;
  phoneNumber: string;
  imageUrl: string;
  caption?: string | null;
  delayMs?: number;
}) {
  const normalizedCaption = input.caption?.trim() || "";
  const normalizedFileName = (() => {
    try {
      const pathname = new URL(input.imageUrl).pathname;
      const rawName = pathname.split("/").pop()?.trim() || "";
      return rawName || "producto.jpg";
    } catch {
      return "producto.jpg";
    }
  })();

  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: "image",
    media: input.imageUrl,
    fileName: normalizedFileName,
    mimetype: "image/jpeg",
    caption: normalizedCaption,
    delayMs: input.delayMs,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      mediatype: "image",
      mimetype: "image/jpeg",
      caption: normalizedCaption,
      media: input.imageUrl,
      fileName: normalizedFileName,
      delay: input.delayMs ?? 1200,
    },
  });
}

function inferAudioMimeTypeFromUrl(audioUrl: string) {
  try {
    const pathname = new URL(audioUrl).pathname.toLowerCase();
    if (pathname.endsWith(".mp3")) return "audio/mpeg";
    if (pathname.endsWith(".m4a")) return "audio/mp4";
    if (pathname.endsWith(".wav")) return "audio/wav";
    if (pathname.endsWith(".webm")) return "audio/webm";
    if (pathname.endsWith(".ogg") || pathname.endsWith(".oga")) return "audio/ogg";
  } catch {
    // fall through
  }

  return "audio/ogg";
}

export async function sendEvolutionAudioMessage(input: {
  instanceName: string;
  phoneNumber: string;
  audioUrl: string;
  caption?: string | null;
  delayMs?: number;
}) {
  const normalizedCaption = input.caption?.trim() || "";
  const normalizedFileName = (() => {
    try {
      const pathname = new URL(input.audioUrl).pathname;
      const rawName = pathname.split("/").pop()?.trim() || "";
      return rawName || "audio.ogg";
    } catch {
      return "audio.ogg";
    }
  })();

  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: "audio",
    media: input.audioUrl,
    fileName: normalizedFileName,
    mimetype: inferAudioMimeTypeFromUrl(input.audioUrl),
    caption: normalizedCaption,
    delayMs: input.delayMs,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      mediatype: "audio",
      mimetype: inferAudioMimeTypeFromUrl(input.audioUrl),
      caption: normalizedCaption,
      media: input.audioUrl,
      fileName: normalizedFileName,
      delay: input.delayMs ?? 1200,
    },
  });
}

function inferVideoMimeTypeFromUrl(videoUrl: string) {
  try {
    const pathname = new URL(videoUrl).pathname.toLowerCase();
    if (pathname.endsWith(".mp4")) return "video/mp4";
    if (pathname.endsWith(".mov")) return "video/quicktime";
    if (pathname.endsWith(".webm")) return "video/webm";
    if (pathname.endsWith(".m4v")) return "video/x-m4v";
  } catch {
    // fall through
  }

  return "video/mp4";
}

export async function sendEvolutionVoiceNote(input: {
  instanceName: string;
  phoneNumber: string;
  /** Puede ser una URL publica o el audio en base64 (sin prefijo data:). */
  audio: string;
  delayMs?: number;
}) {
  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: "audio",
    media: input.audio,
    mediaSource: "base64",
    fileName: "audio.ogg",
    mimetype: "audio/ogg",
    delayMs: input.delayMs,
    legacyPath: `/message/sendWhatsAppAudio/${input.instanceName}`,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      audio: input.audio,
      delay: input.delayMs ?? 1200,
    },
  });
}

export async function sendEvolutionVideoMessage(input: {
  instanceName: string;
  phoneNumber: string;
  videoUrl: string;
  caption?: string | null;
  delayMs?: number;
}) {
  const normalizedCaption = input.caption?.trim() || "";
  const normalizedFileName = (() => {
    try {
      const pathname = new URL(input.videoUrl).pathname;
      const rawName = pathname.split("/").pop()?.trim() || "";
      return rawName || "video.mp4";
    } catch {
      return "video.mp4";
    }
  })();

  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: "video",
    media: input.videoUrl,
    fileName: normalizedFileName,
    mimetype: inferVideoMimeTypeFromUrl(input.videoUrl),
    caption: normalizedCaption,
    delayMs: input.delayMs,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      mediatype: "video",
      mimetype: inferVideoMimeTypeFromUrl(input.videoUrl),
      caption: normalizedCaption,
      media: input.videoUrl,
      fileName: normalizedFileName,
      delay: input.delayMs ?? 1200,
    },
  });
}

export async function sendEvolutionDocumentMessage(input: {
  instanceName: string;
  phoneNumber: string;
  documentUrl: string;
  caption?: string | null;
  fileName?: string | null;
  delayMs?: number;
}) {
  const normalizedCaption = input.caption?.trim() || "";
  const normalizedFileName = (() => {
    if (input.fileName?.trim()) return input.fileName.trim();
    try {
      const pathname = new URL(input.documentUrl).pathname;
      return pathname.split("/").pop()?.trim() || "documento.pdf";
    } catch {
      return "documento.pdf";
    }
  })();
  const mimetype = normalizedFileName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";

  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: "document",
    media: input.documentUrl,
    fileName: normalizedFileName,
    mimetype,
    caption: normalizedCaption,
    delayMs: input.delayMs,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      mediatype: "document",
      mimetype,
      caption: normalizedCaption,
      media: input.documentUrl,
      fileName: normalizedFileName,
      delay: input.delayMs ?? 1200,
    },
  });
}

export async function sendEvolutionMediaBase64(input: {
  instanceName: string;
  phoneNumber: string;
  mediatype: "image" | "video" | "document";
  mimetype: string;
  base64: string;
  fileName: string;
  caption?: string | null;
  delayMs?: number;
}) {
  return sendEvolutionMediaRequest({
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
    type: input.mediatype,
    media: input.base64,
    mediaSource: "base64",
    fileName: input.fileName,
    mimetype: input.mimetype,
    caption: input.caption,
    delayMs: input.delayMs,
    legacyBody: {
      number: normalizeEvolutionSendNumber(input.phoneNumber),
      mediatype: input.mediatype,
      mimetype: input.mimetype,
      caption: input.caption?.trim() || "",
      media: input.base64,
      fileName: input.fileName,
      delay: input.delayMs ?? 1200,
    },
  });
}

function isEvolutionConnectionClosedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /connection closed/i.test(message);
}

export async function ensureEvolutionInstanceReady(instanceName: string) {
  const state = await getEvolutionConnectionState(instanceName);

  if (state && ["open", "connected", "connection_open", "online"].includes(state)) {
    return {
      recovered: true,
      state,
      qrCode: null,
      pairingCode: null,
    };
  }

  const qrData = await getEvolutionConnectionQr(instanceName);

  return {
    recovered: Boolean(qrData.qrCode || qrData.pairingCode),
    state,
    qrCode: qrData.qrCode,
    pairingCode: qrData.pairingCode,
  };
}

export async function sendEvolutionTextMessageWithReconnect(input: {
  instanceName: string;
  phoneNumber: string;
  text: string;
  delayMs?: number;
}) {
  try {
    return await sendEvolutionTextMessage(input);
  } catch (error) {
    if (!isEvolutionConnectionClosedError(error)) {
      throw error;
    }

    await ensureEvolutionInstanceReady(input.instanceName);
    return sendEvolutionTextMessage(input);
  }
}

export async function sendEvolutionPresence(input: {
  instanceName: string;
  phoneNumber: string;
  presence?: EvolutionPresence;
  delay?: number;
}) {
  await evolutionInstanceRequest({
    instanceName: input.instanceName,
    path: "/message/presence",
    method: "POST",
    legacyPath: `/chat/sendPresence/${input.instanceName}`,
    body: {
      number: input.phoneNumber,
      state: input.presence ?? "composing",
      isAudio: (input.presence ?? "composing") === "recording",
    },
    legacyBody: {
      number: input.phoneNumber,
      presence: input.presence ?? "composing",
      delay: input.delay ?? 1200,
    },
  });
}

export async function fetchEvolutionProfilePictureUrl(input: {
  instanceName: string;
  phoneNumber: string;
}) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !input.instanceName || !input.phoneNumber) {
    return null;
  }

  try {
    const response = await evolutionInstanceRequest<EvolutionProfilePictureResponse & { avatar?: string }>({
      instanceName: input.instanceName,
      path: "/user/avatar",
      legacyPath: `/chat/fetchProfilePictureUrl/${input.instanceName}`,
      body: {
        number: input.phoneNumber,
        preview: true,
      },
      legacyBody: {
        number: input.phoneNumber,
      },
    });

    return response.profilePictureUrl || response.avatar || null;
  } catch {
    return null;
  }
}
