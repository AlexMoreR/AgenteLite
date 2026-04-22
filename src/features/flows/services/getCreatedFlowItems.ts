import { prisma } from "@/lib/prisma";
import { getOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";

type CreatedFlowSourceType = "official-api" | "evolution";

export type CreatedFlowItem = {
  id: string;
  scenarioId: string;
  sourceType: CreatedFlowSourceType;
  sourceId: string;
  title: string;
  description: string;
  badge: string;
  href: string;
};

function buildFlowItemId(input: { sourceType: CreatedFlowSourceType; sourceId: string; scenarioId: string }) {
  return `${input.sourceType}:${input.sourceId}:${input.scenarioId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function getCreatedFlowItems(input: {
  workspaceId: string;
  includeOfficialApi: boolean;
}): Promise<CreatedFlowItem[]> {
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
        metadata: true,
      },
    }),
  ]);

  const items: CreatedFlowItem[] = [];

  if (input.includeOfficialApi && officialConfig && hasOfficialApiBaseCredentials(officialConfig)) {
    const state = await getOfficialApiChatbotBuilderState(officialConfig.id);

    for (const scenario of state.scenarios) {
      items.push({
        id: buildFlowItemId({
          sourceType: "official-api",
          sourceId: officialConfig.id,
          scenarioId: scenario.id,
        }),
        scenarioId: scenario.id,
        sourceType: "official-api",
        sourceId: officialConfig.id,
        title: scenario.title,
        description: scenario.summary,
        badge: "Meta",
        href: `/cliente/flujos/${encodeURIComponent(scenario.id)}?sourceType=official-api`,
      });
    }
  }

  for (const channel of channels) {
    const metadata = isRecord(channel.metadata) ? channel.metadata : {};
    const savedState = isRecord(metadata.flowBuilderState) ? metadata.flowBuilderState : {};
    const scenarios = Array.isArray(savedState.scenarios) ? savedState.scenarios : [];

    for (const rawScenario of scenarios) {
      if (!rawScenario || typeof rawScenario !== "object" || Array.isArray(rawScenario)) {
        continue;
      }

      const scenario = rawScenario as {
        id?: unknown;
        title?: unknown;
        summary?: unknown;
      };

      const scenarioId = typeof scenario.id === "string" ? scenario.id.trim() : "";
      const title = typeof scenario.title === "string" ? scenario.title.trim() : "";
      const description = typeof scenario.summary === "string" ? scenario.summary.trim() : "";

      if (!scenarioId || !title) {
        continue;
      }

      items.push({
        id: buildFlowItemId({
          sourceType: "evolution",
          sourceId: channel.id,
          scenarioId,
        }),
        scenarioId,
        sourceType: "evolution",
        sourceId: channel.id,
        title,
        description: description || `Flujo creado en ${channel.name}.`,
        badge: "Evolution",
        href: `/cliente/flujos/${encodeURIComponent(scenarioId)}?sourceType=evolution&sourceId=${encodeURIComponent(channel.id)}`,
      });
    }
  }

  return items;
}
