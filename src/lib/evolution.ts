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
