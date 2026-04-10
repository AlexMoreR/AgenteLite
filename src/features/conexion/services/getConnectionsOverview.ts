import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";

export async function getConnectionsOverview(workspaceId: string) {
  const [officialApiConfig, counts] = await Promise.all([
    getOfficialApiConfigByWorkspaceId(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        _count: {
          select: {
            agents: true,
            channels: true,
          },
        },
      },
    }),
  ]);

  return {
    agentCount: counts?._count.agents ?? 0,
    channelCount: counts?._count.channels ?? 0,
    officialApiEnabled: officialApiConfig?.status === "CONNECTED",
  };
}
