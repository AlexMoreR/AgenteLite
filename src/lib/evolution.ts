import { prisma } from "@/lib/prisma";
import { getEvolutionSettings } from "@/lib/system-settings";
import { persistedChatMediaFileExists } from "@/lib/chat-media-storage";

const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "SEND_MESSAGE",
  // Senales de respaldo: si MESSAGES_UPSERT no llega (o se pierde), estos eventos
  // disparan el rescate de mensajes recientes via la API de Evolution.
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
];

type EvolutionConnectResponse = {
  code?: string;
  pairingCode?: string;
  base64?: string;
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
  instance?: {
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

function buildWebhookHeaders(secret: string) {
  if (!secret) {
    return undefined;
  }

  return {
    "x-webhook-secret": secret,
  };
}

async function evolutionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !settings.webhookBaseUrl) {
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

async function evolutionRawRequest(path: string, init?: RequestInit) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !settings.webhookBaseUrl) {
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
  const looksLikeBase64 =
    compact.length > 32 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/=]+$/.test(compact);

  if (!looksLikeBase64) {
    return null;
  }

  return `data:${mimeType};base64,${compact}`;
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
  const message = asRecord(data?.message) ?? asRecord(root?.message);
  const key = asRecord(data?.key) ?? asRecord(root?.key) ?? asRecord(message?.key);

  return (
    readString(key?.id) ||
    readString(data?.messageId) ||
    readString(root?.messageId) ||
    readString(message?.id) ||
    null
  );
}

function extractRenderableImageUrlFromPayload(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message) ?? asRecord(root?.message);
  const imageMessage = asRecord(message?.imageMessage);

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
  const message = asRecord(data?.message) ?? asRecord(root?.message);

  const mediaMessage =
    mediaType === "IMAGE"
      ? asRecord(message?.imageMessage)
      : mediaType === "AUDIO"
        ? asRecord(message?.audioMessage)
        : mediaType === "VIDEO"
          ? asRecord(message?.videoMessage)
          : mediaType === "STICKER"
            ? asRecord(message?.stickerMessage)
          : asRecord(message?.documentMessage);

  const candidate =
    readString(mediaMessage?.url) ||
    readString(mediaMessage?.URL) ||
    readString(mediaMessage?.directPath) ||
    readString(data?.mediaUrl) ||
    readString(data?.media) ||
    readString(data?.url);

  return isRenderableMediaUrl(candidate) ? candidate : null;
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
    const response = await evolutionRequest<EvolutionConnectResponse>(`/instance/connect/${instanceName}`, {
      method: "GET",
    });

    return {
      qrCode: response.base64 || response.code || null,
      pairingCode: response.pairingCode ?? null,
    };
  } catch {
    return { qrCode: null, pairingCode: null };
  }
}

export async function fetchEvolutionInstanceProfile(instanceName: string) {
  const settings = await getEvolutionSettings();
  if (!settings.apiBaseUrl || !settings.apiToken || !instanceName) {
    return null;
  }

  try {
    const scopedResponse = await evolutionRequest<EvolutionInstanceRecord[] | EvolutionInstanceRecord>(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
      {
        method: "GET",
      },
    );
    let records = extractInstancePayloadList(scopedResponse);

    if (!records.length) {
      const fallbackResponse = await evolutionRequest<EvolutionInstanceRecord[] | EvolutionInstanceRecord>("/instance/fetchInstances", {
        method: "GET",
      });
      records = extractInstancePayloadList(fallbackResponse);
    }

    const instanceRecord =
      records.find((item) => item.instance?.instanceName === instanceName) ??
      records.find((item) => {
        const nested = asRecord(item.instance);
        return readString(nested?.instanceName) === instanceName;
      }) ??
      records[0];
    const instance = asRecord(instanceRecord?.instance);

    if (!instance) {
      return null;
    }

    return {
      owner:
        normalizePhoneValue(readString(instance.owner)) ||
        normalizePhoneValue(readString(instance.ownerJid)) ||
        normalizePhoneValue(readString(instance.number)) ||
        normalizePhoneValue(readString(instance.phoneNumber)) ||
        normalizePhoneValue(readString(instance.wuid)),
      profileName: readString(instance.profileName),
      profilePictureUrl: readString(instance.profilePictureUrl),
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
  let sequence = (await prisma.whatsAppChannel.count()) + 1;
  let instanceName = `${normalizedPrefix}-${sequence}`;

  while (await prisma.whatsAppChannel.findUnique({ where: { evolutionInstanceName: instanceName }, select: { id: true } })) {
    sequence += 1;
    instanceName = `${normalizedPrefix}-${sequence}`;
  }

  await evolutionRequest("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      syncFullHistory: true,
      webhook: {
        url: settings.webhookBaseUrl,
        byEvents: false,
        base64: false,
        headers: buildWebhookHeaders(settings.webhookSecret),
        events: WEBHOOK_EVENTS,
      },
    }),
  });

  let connectData: EvolutionConnectResponse = {};
  try {
    connectData = await evolutionRequest<EvolutionConnectResponse>(`/instance/connect/${instanceName}`, {
      method: "GET",
    });
  } catch {
    // Si Evolution crea la instancia pero tarda en devolver el QR,
    // dejamos el canal en CONNECTING y esperamos los webhooks.
  }

  const qrCode = connectData.base64 || connectData.code || null;

  const channel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      provider: "EVOLUTION",
      name: input.name,
      evolutionInstanceName: instanceName,
      status: qrCode ? "QRCODE" : "CONNECTING",
      qrCode,
      metadata: {
        pairingCode: connectData.pairingCode ?? null,
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
  const response = await evolutionRequest<EvolutionSendTextResponse>(`/message/sendText/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      text: input.text,
      delay: input.delayMs ?? 1200,
      ...(input.quoted?.id
        ? {
            // Solo enviamos la `key`: Evolution reconstruye el mensaje citado real
            // desde su propia BD (getMessage por key.id). Si mandáramos un `message`
            // sintético, Evolution lo usaría tal cual y la cita quedaría frágil/falsa.
            quoted: {
              key: {
                id: input.quoted.id,
                fromMe: input.quoted.fromMe ?? false,
                ...(input.quoted.remoteJid ? { remoteJid: input.quoted.remoteJid } : {}),
              },
            },
          }
        : {}),
    }),
  });

  const externalId =
    response.key?.id ||
    response.message?.key?.id ||
    response.data?.key?.id ||
    response.data?.id ||
    response.id ||
    response.messageId ||
    null;

  return {
    externalId,
    raw: response,
  };
}

export async function deleteEvolutionMessageForEveryone(input: {
  instanceName: string;
  key: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
}) {
  await evolutionRequest(`/chat/deleteMessageForEveryone/${input.instanceName}`, {
    method: "DELETE",
    body: JSON.stringify({
      id: input.key.id,
      remoteJid: input.key.remoteJid,
      fromMe: input.key.fromMe,
      ...(input.key.participant ? { participant: input.key.participant } : {}),
    }),
  });
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

  try {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediatype: "image",
        mimetype: "image/jpeg",
        caption: normalizedCaption,
        media: input.imageUrl,
        fileName: normalizedFileName,
        delay: input.delayMs ?? 1200,
      }),
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

    return {
      externalId,
      raw: response,
    };
  } catch (firstError) {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediaMessage: {
          mediaType: "image",
          fileName: normalizedFileName,
          caption: normalizedCaption,
          media: input.imageUrl,
        },
        options: {
          delay: input.delayMs ?? 1200,
          presence: "composing",
        },
      }),
    }).catch(() => {
      throw firstError;
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

    return {
      externalId,
      raw: response,
    };
  }
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

  try {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediatype: "audio",
        mimetype: inferAudioMimeTypeFromUrl(input.audioUrl),
        caption: normalizedCaption,
        media: input.audioUrl,
        fileName: normalizedFileName,
        delay: input.delayMs ?? 1200,
      }),
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

    return {
      externalId,
      raw: response,
    };
  } catch (firstError) {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediaMessage: {
          mediaType: "audio",
          fileName: normalizedFileName,
          caption: normalizedCaption,
          media: input.audioUrl,
        },
        options: {
          delay: input.delayMs ?? 1200,
          presence: "composing",
        },
      }),
    }).catch(() => {
      throw firstError;
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

  return {
    externalId,
    raw: response,
  };
  }
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
  const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendWhatsAppAudio/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      audio: input.audio,
      delay: input.delayMs ?? 1200,
    }),
  });

  const externalId =
    response.key?.id ||
    response.message?.key?.id ||
    response.data?.key?.id ||
    response.data?.id ||
    response.id ||
    response.messageId ||
    null;

  return {
    externalId,
    raw: response,
  };
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

  try {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediatype: "video",
        mimetype: inferVideoMimeTypeFromUrl(input.videoUrl),
        caption: normalizedCaption,
        media: input.videoUrl,
        fileName: normalizedFileName,
        delay: input.delayMs ?? 1200,
      }),
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

    return {
      externalId,
      raw: response,
    };
  } catch (firstError) {
    const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.phoneNumber,
        mediaMessage: {
          mediaType: "video",
          fileName: normalizedFileName,
          caption: normalizedCaption,
          media: input.videoUrl,
        },
        options: {
          delay: input.delayMs ?? 1200,
          presence: "composing",
        },
      }),
    }).catch(() => {
      throw firstError;
    });

    const externalId =
      response.key?.id ||
      response.message?.key?.id ||
      response.data?.key?.id ||
      response.data?.id ||
      response.id ||
      response.messageId ||
      null;

    return {
      externalId,
      raw: response,
    };
  }
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

  const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      mediatype: "document",
      mimetype,
      caption: normalizedCaption,
      media: input.documentUrl,
      fileName: normalizedFileName,
      delay: input.delayMs ?? 1200,
    }),
  });

  const externalId =
    response.key?.id ||
    response.message?.key?.id ||
    response.data?.key?.id ||
    response.data?.id ||
    response.id ||
    response.messageId ||
    null;

  return { externalId, raw: response };
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
  const response = await evolutionRequest<EvolutionSendMediaResponse>(`/message/sendMedia/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      mediatype: input.mediatype,
      mimetype: input.mimetype,
      caption: input.caption?.trim() || "",
      media: input.base64,
      fileName: input.fileName,
      delay: input.delayMs ?? 1200,
    }),
  });

  const externalId =
    response.key?.id ||
    response.message?.key?.id ||
    response.data?.key?.id ||
    response.data?.id ||
    response.id ||
    response.messageId ||
    null;

  return {
    externalId,
    raw: response,
  };
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
  await evolutionRequest(`/chat/sendPresence/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      presence: input.presence ?? "composing",
      delay: input.delay ?? 1200,
    }),
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
    const response = await evolutionRequest<EvolutionProfilePictureResponse>(
      `/chat/fetchProfilePictureUrl/${input.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          number: input.phoneNumber,
        }),
      },
    );

    return response.profilePictureUrl || null;
  } catch {
    return null;
  }
}
