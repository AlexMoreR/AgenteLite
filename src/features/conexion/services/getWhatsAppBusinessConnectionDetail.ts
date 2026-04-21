import QRCode from "qrcode";
import { getEvolutionConnectionQr, getEvolutionConnectionState } from "@/lib/evolution";
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
          },
        },
      },
    });
  }

  if (!channel) {
    return null;
  }

  const remoteConnectionState = channel?.evolutionInstanceName
    ? await getEvolutionConnectionState(channel.evolutionInstanceName)
    : null;
  const remoteIsConnected =
    remoteConnectionState === "open" ||
    remoteConnectionState === "connected" ||
    remoteConnectionState === "connection_open" ||
    remoteConnectionState === "online";
  const remoteConnectionQr =
    channel?.evolutionInstanceName && !remoteIsConnected
      ? await getEvolutionConnectionQr(channel.evolutionInstanceName)
      : { qrCode: null, pairingCode: null };

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
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "QRCODE",
        qrCode: remoteConnectionQr.qrCode,
        metadata: {
          pairingCode: remoteConnectionQr.pairingCode ?? null,
        },
      },
    });
  }

  const isConnected = remoteIsConnected || channel?.status === "CONNECTED";
  const rawQrCode = isConnected ? null : remoteConnectionQr.qrCode;
  const qrDataUrl = await buildQrDataUrl(rawQrCode);
  const pairingCode =
    remoteConnectionQr.pairingCode ||
    (channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? ((channel.metadata as { pairingCode?: string | null }).pairingCode ?? "")
      : "");

  return {
    connection: {
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      isActive: channel.isActive,
      agentId: channel.agent?.id ?? null,
      agentName: channel.agent?.name ?? "",
      agentIsActive: channel.agent?.isActive ?? false,
      agentStatus: channel.agent?.status ?? null,
    },
    channel,
    isConnected,
    qrDataUrl,
    pairingCode,
    hasQrCode: Boolean(qrDataUrl) && !isConnected,
  };
}
