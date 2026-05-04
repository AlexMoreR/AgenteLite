import type {
  OfficialApiChatbotBuilderEdge,
  OfficialApiChatbotBuilderNode,
} from "@/features/official-api/types/official-api";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { getOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { generateAgentReply } from "@/lib/agent-ai";
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

const AFFIRMATION_WORDS = new Set([
  "si", "ok", "dale", "bueno", "claro", "listo", "perfecto",
  "quiero", "enviame", "mandame", "mandalo", "envialo", "adelante",
  "hagalo", "hagamoslo", "si por favor", "porfa", "porfavor", "sure", "yes",
]);

function isAffirmationMessage(normalizedText: string): boolean {
  const words = normalizedText.split(" ").filter(Boolean);
  if (words.length > 4) return false;
  return words.every((w) => AFFIRMATION_WORDS.has(w) || w.length <= 2);
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
    ? { url: imageUrl, caption: imageCaption }
    : null;

  const documentNodes = candidateNodes.filter((node) => node.kind === "document" && isValidHttpUrl(node.meta.trim()));
  const documents = documentNodes.map((node) => {
    const url = node.meta.trim();
    const fileName = extractDocumentFileName(node.title, url);
    return { url, caption: node.body.trim() || null, fileName };
  });

  const text = replyNode?.body.trim() || null;

  if (!text && !image && !documents.length) {
    return null;
  }

  const imageIndex = imageNode ? candidateNodes.indexOf(imageNode) : -1;
  const replyIndex = replyNode ? candidateNodes.indexOf(replyNode) : -1;
  const imageFirst = imageNode !== undefined && (replyIndex === -1 || imageIndex < replyIndex);

  return {
    text,
    image,
    imageFirst,
    documents,
  };
}

function buildConversationContext(latestUserMessage: string, history: ConversationLine[]) {
  const recentContext = history
    .slice(-6)
    .map((line) => line.content ?? "")
    .join(" ");

  return {
    latestText: normalizeText(latestUserMessage),
    recentContext: normalizeText(recentContext),
    fullContext: normalizeText(`${latestUserMessage} ${recentContext}`),
  };
}

function scoreFlowIntentMatch(input: {
  flow: {
    title: string;
    intent: string;
    description?: string | null;
  };
  latestText: string;
  recentContext: string;
  fullContext: string;
}): { score: number; hasLatestMatch: boolean } {
  const intentSource = [input.flow.intent, input.flow.description ?? ""].filter(Boolean).join(" ");
  const intentTokens = tokenize(intentSource);
  const titleTokens = tokenize(input.flow.title);
  const intentPhrase = normalizeText(input.flow.intent);
  const context = input.fullContext || `${input.latestText} ${input.recentContext}`.trim();

  const isAffirmation = isAffirmationMessage(input.latestText);
  let score = 0;
  let hasLatestMatch = false;
  let contextScore = 0;
  const scoredTokens = new Set<string>();

  for (const token of intentTokens) {
    if (textMatchesToken(input.latestText, token)) {
      score += 4;
      hasLatestMatch = true;
      scoredTokens.add(token);
    } else if (textMatchesToken(input.recentContext, token)) {
      score += 1;
      contextScore += 1;
      scoredTokens.add(token);
    }
  }

  for (const token of titleTokens) {
    if (scoredTokens.has(token)) continue;
    if (textMatchesToken(input.latestText, token)) {
      score += 2;
      hasLatestMatch = true;
    } else if (textMatchesToken(input.recentContext, token)) {
      score += 1;
      contextScore += 1;
    }
  }

  if (intentPhrase && input.latestText.includes(intentPhrase)) {
    score += 5;
    hasLatestMatch = true;
  } else if (intentPhrase && context.includes(intentPhrase)) {
    score += 1;
    contextScore += 1;
  }

  // Si el usuario confirma con una afirmación corta ("Si", "Ok", "Dale")
  // y el contexto reciente tiene matches fuertes del flujo, lo ejecutamos.
  if (isAffirmation && contextScore >= 2) {
    hasLatestMatch = true;
  }

  return { score, hasLatestMatch };
}

const FLOW_MATCH_THRESHOLD = 9;

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

async function selectFlowByAI(input: {
  flows: Array<{ id: string; title: string; intent: string }>;
  latestUserMessage: string;
  history: ConversationLine[];
}): Promise<string | null> {
  if (!input.flows.length) return null;

  const flowList = input.flows
    .map((f) => `ID: ${f.id}\nTítulo: ${f.title}\nIntención: ${f.intent}`)
    .join("\n\n---\n\n");

  const recentHistory = input.history
    .slice(-6)
    .map((h) => `${h.direction === "INBOUND" ? "Cliente" : "Agente"}: ${h.content?.trim() || ""}`)
    .filter((h) => h.trim())
    .join("\n");

  const systemPrompt = [
    "Eres un clasificador de flujos de ventas. Tu ÚNICA tarea es determinar si el último mensaje del cliente activa alguno de los flujos disponibles.",
    "",
    "FLUJOS DISPONIBLES:",
    flowList,
    "",
    "REGLAS ESTRICTAS:",
    "- Activa un flujo SOLO si el cliente pide EXPLÍCITAMENTE el contenido del flujo: catálogo, lista, documento, modelos, precios, etc.",
    "- Una pregunta general sobre un producto ('información sobre X', '¿tienen X?', '¿qué es X?') NO activa ningún flujo aunque el producto esté relacionado.",
    "- Solo activa si el cliente usa frases como: 'quiero el catálogo', 'envíame los modelos', 'muéstrame las opciones', 'quiero ver precios', etc.",
    "- Si el cliente confirma con 'Si', 'Ok', 'Dale' y el contexto reciente ofreció enviar algo → actívalo.",
    "- En caso de duda → responde 'ninguno'.",
    "- Responde ÚNICAMENTE con el ID exacto del flujo o la palabra 'ninguno'. Sin explicación, sin comillas.",
  ].join("\n");

  const contextMessage = recentHistory
    ? `Historial reciente:\n${recentHistory}\n\nÚltimo mensaje del cliente: ${input.latestUserMessage}`
    : `Último mensaje del cliente: ${input.latestUserMessage}`;

  const result = await generateAgentReply({
    systemPrompt,
    rawSystemPrompt: true,
    history: [],
    latestUserMessage: contextMessage,
    fallbackMessage: "ninguno",
  });

  const trimmed = result.trim().replace(/^["']|["']$/g, "");
  const matched = input.flows.find((f) => f.id === trimmed);
  return matched?.id ?? null;
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

  const [agent, flowTargets] = await Promise.all([
    prisma.agent.findFirst({
      where: {
        id: input.agentId,
        workspaceId: input.workspaceId,
      },
      select: {
        trainingConfig: true,
      },
    }),
    getCreatedFlowItems({
      workspaceId: input.workspaceId,
      includeOfficialApi: input.includeOfficialApi,
    }),
  ]);

  if (!agent || !flowTargets.length) {
    return null;
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultAgentTrainingConfig;
  const selectedFlowIds = new Set(training.knowledgeFlowIds);

  const flowById = new Map(flowTargets.map((flow) => [flow.id, flow]));
  const selectedFlows = flowTargets.filter((flow) => selectedFlowIds.has(flow.id));

  const conversationContext = buildConversationContext(latestText, input.history ?? []);
  const normalizedLatest = conversationContext.latestText;
  const normalizedRecentContext = conversationContext.recentContext;

  if (selectedFlows.length > 0) {
    const aiSelectedFlowId = await selectFlowByAI({
      flows: selectedFlows.map((f) => ({ id: f.id, title: f.title, intent: f.intent })),
      latestUserMessage: latestText,
      history: input.history ?? [],
    });

    const aiSelectedFlow = aiSelectedFlowId ? flowById.get(aiSelectedFlowId) : null;

    if (aiSelectedFlow) {
      const reply = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: aiSelectedFlow.id,
        includeOfficialApi: input.includeOfficialApi,
      });

      if (reply) {
        return {
          reply: reply.text ?? "",
          image: reply.image,
          imageFirst: reply.imageFirst,
          documents: reply.documents,
          flowTitle: aiSelectedFlow.title,
          productName: null,
        };
      }
    }
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

  const flowByNormalizedTitle = new Map(flowTargets.map((flow) => [normalizeText(flow.title), flow]));
  const selectedFlowIdList = Array.from(selectedFlowIds);

  for (const row of knowledgeRows) {
    const instructions = row.instructions?.trim() || "";
    const references = extractFlowReferences(instructions, flowTargets.map((flow) => flow.title));
    const referencedFlowIds = references
      .map((reference) => flowByNormalizedTitle.get(normalizeText(reference.title))?.id)
      .filter((value): value is string => Boolean(value));
    const candidateFlowIds = referencedFlowIds.length > 0 ? referencedFlowIds : selectedFlowIdList;

    if (!candidateFlowIds.length) {
      continue;
    }

    const productTokens = tokenize(`${row.productName} ${row.productDescription ?? ""}`);
    const latestMentionsProduct =
      productTokens.some((token) => normalizedLatest.includes(token));
    const productGate = productTokens.length === 0 || latestMentionsProduct || referencedFlowIds.length > 0;

    if (!productGate) {
      continue;
    }

    let bestMatch: { flow: (typeof selectedFlows)[number]; score: number } | null = null;

    for (const flowId of candidateFlowIds) {
      const flow = flowById.get(flowId);
      if (!flow) {
        continue;
      }

      const { score, hasLatestMatch } = scoreFlowIntentMatch({
        flow: {
          title: flow.title,
          intent: flow.intent,
          description: flow.description,
        },
        latestText: normalizedLatest,
        recentContext: normalizedRecentContext,
        fullContext: conversationContext.fullContext,
      });

      if (!hasLatestMatch) continue;

      const referenceBonus = references.some((reference) => normalizeText(reference.title) === normalizeText(flow.title)) ? 2 : 0;
      const combinedScore = score + referenceBonus;

      if (!bestMatch || combinedScore > bestMatch.score) {
        bestMatch = {
          flow,
          score: combinedScore,
        };
      }
    }

    if (!bestMatch || bestMatch.score < FLOW_MATCH_THRESHOLD) {
      continue;
    }

    const reply = await getFlowReply({
      workspaceId: input.workspaceId,
      flowId: bestMatch.flow.id,
      includeOfficialApi: input.includeOfficialApi,
    });

    if (reply) {
      return {
        reply: reply.text ?? "",
        image: reply.image,
        imageFirst: reply.imageFirst,
        documents: reply.documents,
        flowTitle: bestMatch.flow.title,
        productName: row.productName,
      };
    }
  }

  return null;
}
