import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";

export type FlowSourceType = "official-api" | "evolution";

export type FlowTargetItem = {
  id: string;
  sourceType: FlowSourceType;
  title: string;
  description: string;
  href: string;
  badge: string;
  isConnected: boolean;
};

export async function getFlowTargets(input: {
  workspaceId: string;
  includeOfficialApi: boolean;
}): Promise<FlowTargetItem[]> {
  const [officialConfig, channels] = await Promise.all([
    input.includeOfficialApi ? getOfficialApiConfigByWorkspaceId(input.workspaceId) : Promise.resolve(null),
    prisma.whatsAppChannel.findMany({
      where: {
        workspaceId: input.workspaceId,
        provider: "EVOLUTION",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        agent: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  const items: FlowTargetItem[] = [];

  if (input.includeOfficialApi && officialConfig && hasOfficialApiBaseCredentials(officialConfig)) {
    const isConnected = officialConfig.status === "CONNECTED";
    items.push({
      id: "official-api",
      sourceType: "official-api",
      title: "API oficial",
      description: isConnected
        ? "Constructor central para automatizaciones del numero oficial de WhatsApp."
        : "Configura primero la API oficial para habilitar estos flujos.",
      href: "/cliente/flujos?sourceType=official-api",
      badge: isConnected ? "Meta" : "Pendiente",
      isConnected,
    });
  }

  for (const channel of channels) {
    items.push({
      id: channel.id,
      sourceType: "evolution",
      title: "API no oficial",
      description: channel.agent?.name
        ? `Canal no oficial con Evolution vinculado a ${channel.agent.name}.`
        : "Canal no oficial con Evolution listo para construir respuestas y rutas visuales.",
      href: `/cliente/flujos?sourceType=evolution&sourceId=${channel.id}`,
      badge: "Evolution",
      isConnected: channel.status === "CONNECTED" || channel.status === "QRCODE",
    });
  }

  return items;
}
