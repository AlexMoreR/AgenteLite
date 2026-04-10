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
  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
      _count: {
        select: {
          conversations: true,
          messages: true,
        },
      },
      channels: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          phoneNumber: true,
          lastConnectionAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const items = agents.map((agent) => {
    const channel = agent.channels[0] ?? null;

    return {
      id: agent.id,
      name: agent.name,
      agentStatus: agent.status,
      channelStatus: channel?.status ?? null,
      channelStatusLabel: getConnectionLabel(channel?.status),
      phoneNumber: channel?.phoneNumber ?? "",
      lastConnectionAt: channel?.lastConnectionAt ?? null,
      updatedAt: channel?.updatedAt ?? agent.updatedAt,
      conversationsCount: agent._count.conversations,
      messagesCount: agent._count.messages,
    };
  });

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
