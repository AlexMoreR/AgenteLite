import { getEvolutionFlowData } from "@/features/flows/services/getEvolutionFlowData";
import type { FlowStep } from "@/lib/agent-product-flow";

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
  steps: FlowStep[];
  text: string | null;
  image: {
    url: string;
    caption: string | null;
  } | null;
  audio: {
    url: string;
    caption: string | null;
  } | null;
  video: {
    url: string;
    caption: string | null;
  } | null;
  imageFirst: boolean;
  documents: Array<{
    url: string;
    caption: string | null;
    fileName: string | null;
  }>;
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

function extractDocumentFileName(nodeTitle: string, url: string): string | null {
  const titleTrimmed = nodeTitle.trim();
  if (titleTrimmed && /\.[a-zA-Z0-9]{2,5}$/.test(titleTrimmed)) {
    return titleTrimmed;
  }

  try {
    const raw = new URL(url).pathname.split("/").pop()?.trim() || "";
    if (!raw) return null;
    const cleaned = raw.replace(/^\d{10,}-/, "").replace(/_/g, " ");
    return cleaned || raw;
  } catch {
    return null;
  }
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
  const steps = buildStepsFromNodes(candidateNodes);
  const fallbackSteps = steps.length > 0 ? steps : buildStepsFromNodes(nodes);

  if (!fallbackSteps.length) {
    return null;
  }

  return buildReplyFromSteps(fallbackSteps);
}

function buildStepsFromNodes(nodes: BuilderNode[]): FlowStep[] {
  const steps: FlowStep[] = [];

  for (const node of nodes) {
    if (node.kind === "trigger") {
      continue;
    }

    if (node.kind === "message" && node.body.trim()) {
      steps.push({ kind: "text", content: node.body.trim() });
    } else if (node.kind === "image") {
      const url = node.meta.trim();
      if (isValidHttpUrl(url)) {
        steps.push({ kind: "image", url, caption: node.body.trim() || null });
      }
    } else if (node.kind === "audio") {
      const url = node.meta.trim();
      if (isValidHttpUrl(url)) {
        steps.push({ kind: "audio", url, caption: node.body.trim() || null });
      }
    } else if (node.kind === "video") {
      const url = node.meta.trim();
      if (isValidHttpUrl(url)) {
        steps.push({ kind: "video", url, caption: node.body.trim() || null });
      }
    } else if (node.kind === "document") {
      const url = node.meta.trim();
      if (isValidHttpUrl(url)) {
        steps.push({ kind: "document", url, caption: node.body.trim() || null, fileName: extractDocumentFileName(node.title, url) });
      }
    }
  }

  return steps;
}

function buildReplyFromSteps(steps: FlowStep[]): QuickResponseFlowReply {
  const textStep = steps.find((step): step is Extract<FlowStep, { kind: "text" }> => step.kind === "text") ?? null;
  const imageStep = steps.find((step): step is Extract<FlowStep, { kind: "image" }> => step.kind === "image") ?? null;
  const audioStep = steps.find((step): step is Extract<FlowStep, { kind: "audio" }> => step.kind === "audio") ?? null;
  const videoStep = steps.find((step): step is Extract<FlowStep, { kind: "video" }> => step.kind === "video") ?? null;
  const documents = steps
    .filter((step): step is Extract<FlowStep, { kind: "document" }> => step.kind === "document")
    .map((step) => ({ url: step.url, caption: step.caption, fileName: step.fileName }));

  return {
    steps,
    text: textStep?.content ?? null,
    image: imageStep ? { url: imageStep.url, caption: imageStep.caption } : null,
    audio: audioStep ? { url: audioStep.url, caption: audioStep.caption } : null,
    video: videoStep ? { url: videoStep.url, caption: videoStep.caption } : null,
    imageFirst: Boolean(imageStep && (!textStep || steps.indexOf(imageStep) < steps.indexOf(textStep))),
    documents,
  };
}

function normalizeScenarioReply(reply: QuickResponseFlowReply): QuickResponseFlowReply {
  const text = reply.text?.trim() || null;
  const imageCaption = reply.image?.caption?.trim() || null;
  const shouldSkipTextBecauseCaptionMatches = Boolean(text && imageCaption && text === imageCaption);

  return {
    steps: reply.steps,
    text: shouldSkipTextBecauseCaptionMatches ? null : text,
    image: reply.image ? { url: reply.image.url, caption: imageCaption } : null,
    audio: reply.audio ? { url: reply.audio.url, caption: reply.audio.caption?.trim() || null } : null,
    video: reply.video ? { url: reply.video.url, caption: reply.video.caption?.trim() || null } : null,
    imageFirst: reply.imageFirst,
    documents: reply.documents,
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
        flowId: `evolution:${input.channelId}:${scenario.id}`,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title.trim() || "Flujo",
        keyword: matchedKeyword,
        replyEveryMessageEnabled: data.defaults.replyEveryMessageEnabled,
        reply: normalizeScenarioReply(reply),
      };
    }
  }

  return null;
}
