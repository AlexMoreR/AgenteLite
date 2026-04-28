import { getEvolutionFlowData } from "@/features/flows/services/getEvolutionFlowData";

type BuilderNode = {
  id: string;
  kind: "trigger" | "message" | "image" | "audio" | "video" | "document" | "input" | "condition" | "action";
  title: string;
  body: string;
  meta: string;
};

type BuilderEdge = {
  id: string;
  source: string;
  target: string;
};

type QuickResponseFlowReply = {
  text: string | null;
  image: {
    url: string;
    caption: string | null;
  } | null;
  imageFirst: boolean;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitKeywords(existingMeta: string) {
  return existingMeta
    .split(/[,;\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function getPrimaryPathNodeIds(nodes: BuilderNode[], edges: BuilderEdge[]) {
  if (nodes.length === 0) {
    return [];
  }

  const outgoingBySource = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoingBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoingBySource.set(edge.source, targets);
  }

  const triggerNode = nodes.find((node) => node.kind === "trigger");
  let currentId = triggerNode?.id ?? nodes[0]?.id ?? "";
  const visited = new Set<string>();
  const orderedIds: string[] = [];

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    orderedIds.push(currentId);
    currentId = outgoingBySource.get(currentId)?.[0] ?? "";
  }

  return orderedIds;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getScenarioReplyFromState(input: {
  scenarioId: string;
  nodesByScenarioId: Record<string, BuilderNode[] | undefined>;
  edgesByScenarioId: Record<string, BuilderEdge[] | undefined>;
}): QuickResponseFlowReply | null {
  const nodes = input.nodesByScenarioId[input.scenarioId] ?? [];
  const edges = input.edgesByScenarioId[input.scenarioId] ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const orderedNodes = getPrimaryPathNodeIds(nodes, edges)
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is BuilderNode => Boolean(node));
  const candidateNodes = orderedNodes.length > 0 ? orderedNodes : nodes;
  const messageNodes = candidateNodes.filter((node) => node.kind === "message" && node.body.trim());
  const replyNode =
    messageNodes.find((node) => node.id === "reply") ??
    messageNodes.find((node) => !node.title.toLowerCase().includes("bienvenida") && !node.title.toLowerCase().includes("fallback")) ??
    messageNodes[0];
  const imageNode = candidateNodes.find((node) => node.kind === "image") ?? nodes.find((node) => node.kind === "image");
  const imageUrl = imageNode?.meta.trim() || "";
  const imageCaption = imageNode?.body.trim() || null;
  const image = imageUrl && isValidHttpUrl(imageUrl)
    ? {
        url: imageUrl,
        caption: imageCaption,
      }
    : null;
  const text = replyNode?.body.trim() || image?.caption || null;

  if (!text && !image) {
    return null;
  }

  const imageIndex = imageNode ? candidateNodes.indexOf(imageNode) : -1;
  const replyIndex = replyNode ? candidateNodes.indexOf(replyNode) : -1;
  const imageFirst = imageNode !== undefined && (replyIndex === -1 || imageIndex < replyIndex);

  return {
    text,
    image,
    imageFirst,
  };
}

function normalizeScenarioReply(reply: QuickResponseFlowReply): QuickResponseFlowReply {
  const text = reply.text?.trim() || null;
  const imageCaption = reply.image?.caption?.trim() || null;
  const shouldSkipTextBecauseCaptionMatches = Boolean(text && imageCaption && text === imageCaption);

  return {
    text: shouldSkipTextBecauseCaptionMatches ? null : text,
    image: reply.image
      ? {
          url: reply.image.url,
          caption: imageCaption,
        }
      : null,
    imageFirst: reply.imageFirst,
  };
}

export async function resolveEvolutionQuickResponseFlow(input: {
  workspaceId: string;
  channelId: string;
  manualMessage: string;
}) {
  const data = await getEvolutionFlowData(input.workspaceId, input.channelId);
  if (!data) {
    return null;
  }

  const normalizedManualMessage = normalizeText(input.manualMessage);
  if (!normalizedManualMessage) {
    return null;
  }

  for (const scenario of data.scenarios) {
    const scenarioNodes = data.defaults.nodesByScenarioId[scenario.id] ?? [];

    for (const node of scenarioNodes) {
      if (node.kind !== "message") {
        continue;
      }

      const matchedKeyword = splitKeywords(node.meta).find((keyword) => normalizeText(keyword) === normalizedManualMessage);
      if (!matchedKeyword) {
        continue;
      }

      const reply = getScenarioReplyFromState({
        scenarioId: scenario.id,
        nodesByScenarioId: data.defaults.nodesByScenarioId,
        edgesByScenarioId: data.defaults.edgesByScenarioId,
      });

      if (!reply) {
        continue;
      }

      return {
        scenarioId: scenario.id,
        scenarioTitle: scenario.title.trim() || "Flujo",
        keyword: matchedKeyword,
        reply: normalizeScenarioReply(reply),
      };
    }
  }

  return null;
}
