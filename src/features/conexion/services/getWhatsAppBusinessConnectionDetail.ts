import QRCode from "qrcode";
import {
  fetchEvolutionInstanceProfile,
  fetchEvolutionProfilePictureUrl,
  getEvolutionConnectionQr,
  getEvolutionConnectionState,
} from "@/lib/evolution";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";

async function buildQrDataUrl(qrValue: string | null) {
  if (!qrValue) {
    return "";
  }

  if (qrValue.startsWith("data:image")) {
    return qrValue;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(qrValue) && qrValue.length > 300) {
    return `data:image/png;base64,${qrValue}`;
  }

  return QRCode.toDataURL(qrValue, {
    margin: 1,
    width: 220,
  });
}

export async function getWhatsAppBusinessConnectionDetail(workspaceId: string, channelOrAgentId: string) {
  let channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: channelOrAgentId,
      workspaceId,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          isActive: true,
          status: true,
          trainingConfig: true,
        },
      },
    },
  });

  if (!channel) {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        workspaceId,
        agentId: channelOrAgentId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            isActive: true,
            status: true,
            trainingConfig: true,
          },
        },
      },
    });
  }

  if (!channel) {
    return null;
  }

  const officialApiConfig =
    channel.provider === "OFFICIAL_API" ? await getOfficialApiConfigByWorkspaceId(workspaceId) : null;
  const remoteConnectionState = channel?.provider === "EVOLUTION" && channel?.evolutionInstanceName
    ? await getEvolutionConnectionState(channel.evolutionInstanceName)
    : null;
  const remoteIsConnected =
    remoteConnectionState === "open" ||
    remoteConnectionState === "connected" ||
    remoteConnectionState === "connection_open" ||
    remoteConnectionState === "online";
  const remoteConnectionQr =
    channel?.provider === "EVOLUTION" && channel?.evolutionInstanceName && !remoteIsConnected
      ? await getEvolutionConnectionQr(channel.evolutionInstanceName)
      : { qrCode: null, pairingCode: null };
  const instanceProfile =
    channel?.provider === "EVOLUTION" && channel.evolutionInstanceName
      ? await fetchEvolutionInstanceProfile(channel.evolutionInstanceName)
      : null;
  const normalizedInstanceOwner = instanceProfile?.owner ? instanceProfile.owner.split("@")[0]?.replace(/\D/g, "") ?? "" : "";
  const resolvedPhoneNumber = channel.phoneNumber || normalizedInstanceOwner || null;
  const profilePictureUrl =
    instanceProfile?.profilePictureUrl ||
    (channel?.provider === "EVOLUTION" && channel.evolutionInstanceName && resolvedPhoneNumber
      ? await fetchEvolutionProfilePictureUrl({
          instanceName: channel.evolutionInstanceName,
          phoneNumber: resolvedPhoneNumber,
        })
      : null);

  if (channel.id && resolvedPhoneNumber && channel.phoneNumber !== resolvedPhoneNumber) {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        phoneNumber: resolvedPhoneNumber,
      },
    });
    channel.phoneNumber = resolvedPhoneNumber;
  }

  if (channel?.id && remoteIsConnected && channel.status !== "CONNECTED") {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        qrCode: null,
        lastConnectionAt: new Date(),
      },
    });
  }

  if (channel?.id && remoteConnectionQr.qrCode && channel.qrCode !== remoteConnectionQr.qrCode) {
    const baseMetadata =
      channel.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
        ? (channel.metadata as Record<string, unknown>)
        : {};
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "QRCODE",
        qrCode: remoteConnectionQr.qrCode,
        // Fusionamos para no borrar otras claves del metadata (p. ej. collaboratorIds).
        metadata: {
          ...baseMetadata,
          pairingCode: remoteConnectionQr.pairingCode ?? null,
        },
      },
    });
  }

  const isConnected = channel.provider === "OFFICIAL_API" ? channel.status === "CONNECTED" : remoteIsConnected || channel?.status === "CONNECTED";
  const persistedQrCode = typeof channel.qrCode === "string" && channel.qrCode.trim() ? channel.qrCode.trim() : null;
  const rawQrCode = isConnected ? null : remoteConnectionQr.qrCode || persistedQrCode;
  const qrDataUrl = await buildQrDataUrl(rawQrCode);
  const pairingCode =
    remoteConnectionQr.pairingCode ||
    (channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? ((channel.metadata as { pairingCode?: string | null }).pairingCode ?? "")
      : "");
  const agentTrainingConfig =
    channel.agent?.trainingConfig && typeof channel.agent.trainingConfig === "object" && !Array.isArray(channel.agent.trainingConfig)
      ? (channel.agent.trainingConfig as {
          reactivationMessage?: unknown;
          responseDelaySeconds?: unknown;
        })
      : null;

  return {
    connection: {
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      phoneNumber: channel.phoneNumber ?? "",
      isActive: channel.isActive,
      agentId: channel.agent?.id ?? null,
      agentName: channel.agent?.name ?? "",
      agentIsActive: channel.agent?.isActive ?? false,
      agentStatus: channel.agent?.status ?? null,
      agentReactivationMessage: typeof agentTrainingConfig?.reactivationMessage === "string" ? agentTrainingConfig.reactivationMessage : "",
      agentResponseDelaySeconds:
        typeof agentTrainingConfig?.responseDelaySeconds === "number" && Number.isFinite(agentTrainingConfig.responseDelaySeconds)
          ? Math.max(0, Math.min(120, Math.round(agentTrainingConfig.responseDelaySeconds)))
          : 10,
      logoUrl: profilePictureUrl,
    },
    channel,
    officialApiConfig,
    isConnected,
    qrDataUrl,
    pairingCode,
    hasQrCode: Boolean(qrDataUrl) && !isConnected,
  };
}
