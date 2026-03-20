import { prisma } from "@/lib/prisma";
import { getEvolutionSettings } from "@/lib/system-settings";

const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "SEND_MESSAGE"];

type EvolutionConnectResponse = {
  code?: string;
  pairingCode?: string;
  base64?: string;
};

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

  let sequence = (await prisma.whatsAppChannel.count()) + 1;
  let instanceName = `instancia-${sequence}`;

  while (await prisma.whatsAppChannel.findUnique({ where: { evolutionInstanceName: instanceName }, select: { id: true } })) {
    sequence += 1;
    instanceName = `instancia-${sequence}`;
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
