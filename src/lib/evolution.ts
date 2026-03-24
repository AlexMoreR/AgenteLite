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

type EvolutionPresence = "available" | "unavailable" | "composing" | "recording" | "paused";

function normalizeEvolutionState(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
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

export async function createEvolutionChannelForAgent(input: {
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
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
      agentId: input.agentId,
      provider: "EVOLUTION",
      name: `WhatsApp ${input.agentName}`,
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
}) {
  const response = await evolutionRequest<EvolutionSendTextResponse>(`/message/sendText/${input.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: input.phoneNumber,
      text: input.text,
      delay: 1200,
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
