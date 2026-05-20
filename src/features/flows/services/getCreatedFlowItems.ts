import { prisma } from "@/lib/prisma";
import { getOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";

type CreatedFlowSourceType = "official-api" | "evolution";
type CreatedFlowType = "ia" | "chatbot";
type CreatedFlowMatchType = "exacta" | "contiene";

export type CreatedFlowItem = {
  id: string;
  scenarioId: string;
  sourceType: CreatedFlowSourceType;
  sourceId: string;
  title: string;
  intent: string;
  description: string;
  badge: string;
  href: string;
  flowType: CreatedFlowType;
  matchType: CreatedFlowMatchType;
  keywords: string[];
};

function buildFlowItemId(input: { sourceType: CreatedFlowSourceType; sourceId: string; scenarioId: string }) {
  return `${input.sourceType}:${input.sourceId}:${input.scenarioId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeFlowType(value: unknown): CreatedFlowType {
  return value === "chatbot" ? "chatbot" : "ia";
}

function sanitizeMatchType(value: unknown): CreatedFlowMatchType {
  return value === "contiene" ? "contiene" : "exacta";
}

function sanitizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
    .filter((keyword) => keyword.length > 0)
    .slice(0, 20);
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
        intent: scenario.intent,
        description: scenario.intent,
        badge: "Meta",
        href: `/cliente/flujos/${encodeURIComponent(scenario.id)}?sourceType=official-api`,
        flowType: sanitizeFlowType(scenario.flowType),
        matchType: sanitizeMatchType(scenario.matchType),
        keywords: sanitizeKeywords(scenario.keywords),
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
        intent?: unknown;
        summary?: unknown;
        flowType?: unknown;
        matchType?: unknown;
        keywords?: unknown;
      };

      const scenarioId = typeof scenario.id === "string" ? scenario.id.trim() : "";
      const title = typeof scenario.title === "string" ? scenario.title.trim() : "";
      const description =
        typeof scenario.intent === "string"
          ? scenario.intent.trim()
          : typeof scenario.summary === "string"
            ? scenario.summary.trim()
            : "";

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
        intent:
          typeof scenario.intent === "string"
            ? scenario.intent.trim()
            : typeof scenario.summary === "string"
              ? scenario.summary.trim()
              : "",
        description: description || `Flujo creado en ${channel.name}.`,
        badge: "Evolution",
        href: `/cliente/flujos/${encodeURIComponent(scenarioId)}?sourceType=evolution&sourceId=${encodeURIComponent(channel.id)}`,
        flowType: sanitizeFlowType(scenario.flowType),
        matchType: sanitizeMatchType(scenario.matchType),
        keywords: sanitizeKeywords(scenario.keywords),
      });
    }
  }

  return items;
}
