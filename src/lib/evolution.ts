import { prisma } from "@/lib/prisma";
import { getEvolutionSettings } from "@/lib/system-settings";

const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "SEND_MESSAGE"];

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

function inferMediaMimeType(input: { mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT"; mimeType?: string | null }) {
  if (input.mimeType?.trim()) {
    return input.mimeType.trim();
  }

  switch (input.mediaType) {
    case "IMAGE":
      return "image/jpeg";
    case "AUDIO":
      return "audio/ogg";
    case "VIDEO":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
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

function isRenderableMediaUrl(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
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
    readString(data?.mediaUrl) ||
    readString(data?.media) ||
    readString(data?.url);

  return isRenderableMediaUrl(candidate) ? candidate : null;
}

function extractRenderableMediaUrlFromPayload(payload: unknown, mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT") {
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
          : asRecord(message?.documentMessage);

  const candidate =
    readString(mediaMessage?.url) ||
    readString(mediaMessage?.directPath) ||
    readString(data?.mediaUrl) ||
    readString(data?.media) ||
    readString(data?.url);

  return isRenderableMediaUrl(candidate) ? candidate : null;
}

export async function fetchEvolutionMediaDataUrl(input: {
  instanceName: string;
  messageId: string;
  mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
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
  mediaType: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mediaUrl?: string | null;
  rawPayload?: unknown;
}) {
  if (input.mediaUrl?.trim().startsWith("data:") || input.mediaUrl?.trim().startsWith("blob:")) {
    return input.mediaUrl ?? null;
  }

  const payloadMessageId = input.rawPayload ? extractEvolutionMessageIdFromPayload(input.rawPayload) : null;
  const resolvedMessageId = payloadMessageId || input.messageId?.trim() || null;

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

  if (input.mediaType === "IMAGE" && input.rawPayload) {
    const renderableImageUrl = extractRenderableImageUrlFromPayload(input.rawPayload);
    if (renderableImageUrl) {
      return renderableImageUrl;
    }
  }

  if (isRenderableMediaUrl(input.mediaUrl)) {
    return input.mediaUrl ?? null;
  }

  if (input.mediaType === "IMAGE" && input.rawPayload) {
    const thumbnailUrl = extractImageThumbnailDataUrl(input.rawPayload);
    if (thumbnailUrl) {
      return thumbnailUrl;
    }
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
}) {
  const response = await evolutionRequest<EvolutionSendTextResponse>(`/message/sendText/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      text: input.text,
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
