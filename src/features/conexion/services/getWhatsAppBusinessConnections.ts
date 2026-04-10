import { prisma } from "@/lib/prisma";

function getConnectionLabel(status: string | null | undefined) {
  if (status === "CONNECTED") {
    return "Conectado";
  }

  if (status === "QRCODE") {
    return "Esperando QR";
  }

  return "Sin conectar";
}

export async function getWhatsAppBusinessConnections(workspaceId: string) {
  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      provider: true,
      createdAt: true,
      updatedAt: true,
      phoneNumber: true,
      status: true,
      lastConnectionAt: true,
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      _count: {
        select: {
          conversations: true,
          messages: true,
        },
      },
    },
  });

  const items = channels
    .filter((channel) => channel.provider === "EVOLUTION" || channel.provider === "OFFICIAL_API")
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
    providerLabel: channel.provider === "OFFICIAL_API" ? "WhatsApp API (Meta)" : "WhatsApp QR Code",
    linkedAgentName: channel.agent?.name ?? "",
    linkedAgentStatus: channel.agent?.status ?? "",
    channelStatus: channel.status,
    channelStatusLabel: getConnectionLabel(channel.status),
    phoneNumber: channel.phoneNumber ?? "",
    lastConnectionAt: channel.lastConnectionAt ?? null,
    updatedAt: channel.updatedAt ?? channel.createdAt,
    conversationsCount: channel._count.conversations,
      messagesCount: channel._count.messages,
    }));

  return {
    items,
    summary: {
      totalAgents: items.length,
      connectedAgents: items.filter((item) => item.channelStatus === "CONNECTED").length,
      pendingAgents: items.filter((item) => item.channelStatus === "QRCODE").length,
      disconnectedAgents: items.filter((item) => !item.channelStatus || item.channelStatus === "DISCONNECTED").length,
    },
  };
}
