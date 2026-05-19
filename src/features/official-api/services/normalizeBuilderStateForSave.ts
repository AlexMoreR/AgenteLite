import type {
  OfficialApiChatbotBuilderNode,
  OfficialApiChatbotEdgesByScenarioId,
  OfficialApiChatbotNodesByScenarioId,
  OfficialApiChatbotScenarioFlowType,
  OfficialApiChatbotScenarioMatchType,
  OfficialApiChatbotScenario,
  OfficialApiChatbotNodePositionsByScenarioId,
} from "@/features/official-api/types/official-api";

const validNodeKinds = new Set<OfficialApiChatbotBuilderNode["kind"]>([
  "trigger",
  "message",
  "image",
  "audio",
  "video",
  "document",
  "input",
  "condition",
  "action",
]);

function createFallbackNode(scenarioId: string, index: number): OfficialApiChatbotBuilderNode {
  return {
    id: `${scenarioId || "workflow"}-node-${index + 1}`,
    kind: "trigger",
    title: "Comenzar",
    body: "Inicia al recibir un mensaje.",
    meta: "",
  };
}

function sanitizeNodeKind(kind: unknown): OfficialApiChatbotBuilderNode["kind"] {
  return typeof kind === "string" && validNodeKinds.has(kind as OfficialApiChatbotBuilderNode["kind"])
    ? (kind as OfficialApiChatbotBuilderNode["kind"])
    : "message";
}

function sanitizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFlowType(value: unknown): OfficialApiChatbotScenarioFlowType {
  return value === "chatbot" ? "chatbot" : "ia";
}

function sanitizeMatchType(value: unknown): OfficialApiChatbotScenarioMatchType {
  return value === "contiene" ? "contiene" : "exacta";
}

function sanitizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((keyword) => sanitizeText(keyword))
    .filter((keyword) => keyword.length > 0)
    .slice(0, 20);
}

export function normalizeBuilderScenariosForSave(
  scenarios: OfficialApiChatbotScenario[],
): OfficialApiChatbotScenario[] {
  return Array.isArray(scenarios)
    ? scenarios.map((scenario, index) => {
        const messages = Array.isArray(scenario.messages)
          ? scenario.messages
              .map((message, messageIndex) => ({
                id: sanitizeText(message?.id) || `message-${index + 1}-${messageIndex + 1}`,
                direction: (message?.direction === "bot" ? "bot" : "inbound") as "bot" | "inbound",
                content: sanitizeText(message?.content),
              }))
              .filter((message) => Boolean(message.content))
          : [];

        return {
          id: sanitizeText(scenario.id) || `workflow-${index + 1}`,
          title: sanitizeText(scenario.title) || `Workflow ${index + 1}`,
          intent:
            sanitizeText(scenario.intent) ||
            sanitizeText((scenario as OfficialApiChatbotScenario & { summary?: string | null }).summary) ||
            "Intencion personalizada del builder.",
          flowType: sanitizeFlowType(scenario.flowType),
          matchType: sanitizeMatchType(scenario.matchType),
          keywords: sanitizeKeywords(scenario.keywords),
          messages,
        };
      })
    : [];
}

export function normalizeBuilderNodesForSave(
  nodesByScenarioId: OfficialApiChatbotNodesByScenarioId,
): OfficialApiChatbotNodesByScenarioId {
  if (!nodesByScenarioId || typeof nodesByScenarioId !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(nodesByScenarioId).map(([scenarioId, nodes]) => {
      const normalizedNodes =
        Array.isArray(nodes) && nodes.length > 0
          ? nodes.map((node, index) => ({
              id: sanitizeText(node?.id) || `${scenarioId || "workflow"}-node-${index + 1}`,
              kind: sanitizeNodeKind(node?.kind),
              title: sanitizeText(node?.title) || "Bloque",
              body: sanitizeText(node?.body),
              meta: sanitizeText(node?.meta),
            }))
          : [createFallbackNode(scenarioId, 0)];

      return [scenarioId, normalizedNodes];
    }),
  );
}

export function normalizeBuilderNodePositionsForSave(
  nodePositionsByScenarioId: OfficialApiChatbotNodePositionsByScenarioId,
): OfficialApiChatbotNodePositionsByScenarioId {
  if (!nodePositionsByScenarioId || typeof nodePositionsByScenarioId !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(nodePositionsByScenarioId).map(([scenarioId, positions]) => {
      if (!positions || typeof positions !== "object" || Array.isArray(positions)) {
        return [scenarioId, {}];
      }

      const normalizedPositions = Object.fromEntries(
        Object.entries(positions).filter(([, value]) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
          }

          const position = value as { x?: unknown; y?: unknown };
          return Number.isFinite(position.x) && Number.isFinite(position.y);
        }).map(([nodeId, value]) => {
          const position = value as { x: number; y: number };
          return [nodeId, { x: position.x, y: position.y }];
        }),
      );

      return [scenarioId, normalizedPositions];
    }),
  );
}

export function normalizeBuilderEdgesForSave(
  nodesByScenarioId: OfficialApiChatbotNodesByScenarioId,
  edgesByScenarioId: OfficialApiChatbotEdgesByScenarioId,
): OfficialApiChatbotEdgesByScenarioId {
  if (!edgesByScenarioId || typeof edgesByScenarioId !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(edgesByScenarioId).map(([scenarioId, edges]) => {
      const nodes = nodesByScenarioId[scenarioId] ?? [];
      const nodeIds = new Set(nodes.map((node) => node.id));

      const normalizedEdges =
        Array.isArray(edges)
          ? edges
              .filter((edge) => nodeIds.has(edge?.source) && nodeIds.has(edge?.target) && edge.source !== edge.target)
              .map((edge, index) => ({
                id: sanitizeText(edge?.id) || `edge_${scenarioId || "workflow"}_${index + 1}`,
                source: sanitizeText(edge?.source),
                target: sanitizeText(edge?.target),
              }))
          : [];

      if (normalizedEdges.length > 0) {
        return [scenarioId, normalizedEdges];
      }

      if (nodes.length < 2) {
        return [scenarioId, []];
      }

      return [
        scenarioId,
        nodes.slice(0, -1).map((node, index) => ({
          id: `edge_${node.id}__${nodes[index + 1].id}`,
          source: node.id,
          target: nodes[index + 1].id,
        })),
      ];
    }),
  );
}
