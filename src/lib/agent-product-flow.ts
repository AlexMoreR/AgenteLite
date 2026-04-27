import type {
  OfficialApiChatbotBuilderEdge,
  OfficialApiChatbotBuilderNode,
} from "@/features/official-api/types/official-api";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { getOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { prisma } from "@/lib/prisma";

type ConversationLine = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
};

type FlowReference = {
  title: string;
  beforeText: string;
};

type FlowReplyPayload = {
  text: string | null;
  image: {
    url: string;
    caption: string | null;
  } | null;
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

function tokenize(value: string) {
  const stopWords = new Set([
    "si",
    "un",
    "una",
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "por",
    "para",
    "con",
    "este",
    "esta",
    "flujo",
    "ejecuta",
    "cliente",
    "pregunta",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !stopWords.has(word));
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }

    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function textMatchesToken(normalizedText: string, token: string) {
  if (normalizedText.includes(token)) {
    return true;
  }

  if (token.length < 6) {
    return false;
  }

  return normalizedText
    .split(" ")
    .some((word) => Math.abs(word.length - token.length) <= 2 && levenshteinDistance(word, token) <= 2);
}

function buildTriggerTokens(beforeText: string, productTokens: string[], flowTitle: string) {
  const productTokenSet = new Set(productTokens);
  const flowTitleTokenSet = new Set(tokenize(flowTitle));

  return tokenize(beforeText).filter((token) => {
    if (productTokenSet.has(token) || flowTitleTokenSet.has(token)) {
      return false;
    }

    return true;
  });
}

function extractFlowReferences(instructions: string, availableFlowTitles: string[]): FlowReference[] {
  const references: FlowReference[] = [];
  const normalizedInstructions = normalizeText(instructions);

  for (const flowTitle of availableFlowTitles) {
    const normalizedTitle = normalizeText(flowTitle);
    if (!normalizedTitle) {
      continue;
    }

    const slashTitle = `/${flowTitle}`;
    const rawIndex = instructions.toLowerCase().indexOf(slashTitle.toLowerCase());
    const normalizedIndex = normalizedInstructions.indexOf(normalizedTitle);

    if (rawIndex < 0 && normalizedIndex < 0) {
      continue;
    }

    const beforeText = rawIndex >= 0
      ? instructions.slice(Math.max(0, rawIndex - 180), rawIndex)
      : instructions.slice(0, Math.max(0, normalizedIndex));

    references.push({
      title: flowTitle,
      beforeText,
    });
  }

  return references;
}

function getPrimaryPathNodeIds(nodes: OfficialApiChatbotBuilderNode[], edges: OfficialApiChatbotBuilderEdge[]) {
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
  nodesByScenarioId: Record<string, OfficialApiChatbotBuilderNode[] | undefined>;
  edgesByScenarioId: Record<string, OfficialApiChatbotBuilderEdge[] | undefined>;
}): FlowReplyPayload | null {
  const nodes = input.nodesByScenarioId[input.scenarioId] ?? [];
  const edges = input.edgesByScenarioId[input.scenarioId] ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const orderedNodes = getPrimaryPathNodeIds(nodes, edges)
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is OfficialApiChatbotBuilderNode => Boolean(node));
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

  return {
    text,
    image,
  };
}

async function getFlowReply(input: {
  workspaceId: string;
  flowId: string;
  includeOfficialApi: boolean;
}) {
  const [sourceType, sourceId, scenarioId] = input.flowId.split(":");
  if (!sourceType || !sourceId || !scenarioId) {
    return null;
  }

  if (sourceType === "official-api") {
    if (!input.includeOfficialApi) {
      return null;
    }

    const state = await getOfficialApiChatbotBuilderState(sourceId);
    return getScenarioReplyFromState({
      scenarioId,
      nodesByScenarioId: state.nodesByScenarioId,
      edgesByScenarioId: state.edgesByScenarioId,
    });
  }

  if (sourceType !== "evolution") {
    return null;
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: sourceId,
      workspaceId: input.workspaceId,
      provider: "EVOLUTION",
    },
    select: {
      metadata: true,
    },
  });

  const metadata = channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
    ? channel.metadata as Record<string, unknown>
    : {};
  const savedState = metadata.flowBuilderState && typeof metadata.flowBuilderState === "object" && !Array.isArray(metadata.flowBuilderState)
    ? metadata.flowBuilderState as {
        nodesByScenarioId?: Record<string, OfficialApiChatbotBuilderNode[]>;
        edgesByScenarioId?: Record<string, OfficialApiChatbotBuilderEdge[]>;
      }
    : {};

  return getScenarioReplyFromState({
    scenarioId,
    nodesByScenarioId: savedState.nodesByScenarioId ?? {},
    edgesByScenarioId: savedState.edgesByScenarioId ?? {},
  });
}

export async function resolveAgentProductFlowReply(input: {
  agentId: string;
  workspaceId: string;
  latestUserMessage: string | null;
  history?: ConversationLine[];
  includeOfficialApi: boolean;
}) {
  const latestText = input.latestUserMessage?.trim() || "";
  if (!latestText) {
    return null;
  }

  const flowTargets = await getCreatedFlowItems({
    workspaceId: input.workspaceId,
    includeOfficialApi: input.includeOfficialApi,
  });
  if (!flowTargets.length) {
    return null;
  }

  const knowledgeRows = await prisma.$queryRaw<Array<{
    productId: string;
    productName: string;
    productDescription: string | null;
    instructions: string | null;
  }>>`
    SELECT
      akp."productId",
      p."name" AS "productName",
      p."description" AS "productDescription",
      akp."instructions"
    FROM "AgentKnowledgeProduct" akp
    INNER JOIN "Product" p ON p."id" = akp."productId"
    WHERE akp."agentId" = ${input.agentId}
      AND akp."instructions" IS NOT NULL
      AND LENGTH(TRIM(akp."instructions")) > 0
    ORDER BY akp."updatedAt" DESC, akp."createdAt" DESC
  `;

  const normalizedLatest = normalizeText(latestText);
  const recentContext = (input.history ?? [])
    .slice(-6)
    .map((line) => normalizeText(line.content ?? ""))
    .join(" ");
  const flowTitleByNormalized = new Map(flowTargets.map((flow) => [normalizeText(flow.title), flow]));

  for (const row of knowledgeRows) {
    const instructions = row.instructions?.trim() || "";
    const references = extractFlowReferences(instructions, flowTargets.map((flow) => flow.title));
    if (!references.length) {
      continue;
    }

    const productTokens = tokenize(`${row.productName} ${row.productDescription ?? ""}`);
    const latestMentionsProduct =
      productTokens.some((token) => normalizedLatest.includes(token)) ||
      productTokens.some((token) => textMatchesToken(recentContext, token));

    for (const reference of references) {
      const triggerTokens = buildTriggerTokens(reference.beforeText, productTokens, reference.title);
      const latestMatchesTrigger = triggerTokens.some((token) => textMatchesToken(normalizedLatest, token));
      const shouldExecute = triggerTokens.length > 0
        ? latestMatchesTrigger && (latestMentionsProduct || productTokens.length === 0)
        : latestMentionsProduct || productTokens.length === 0;

      if (!shouldExecute) {
        continue;
      }

      const flow = flowTitleByNormalized.get(normalizeText(reference.title));
      if (!flow) {
        continue;
      }

      const reply = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: flow.id,
        includeOfficialApi: input.includeOfficialApi,
      });

      if (reply) {
        return {
          reply: reply.text ?? "",
          image: reply.image,
          flowTitle: flow.title,
          productName: row.productName,
        };
      }
    }
  }

  return null;
}
