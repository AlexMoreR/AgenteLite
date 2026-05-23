/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  OfficialApiChatbotBuilderEdge,
  OfficialApiChatbotBuilderNode,
} from "@/features/official-api/types/official-api";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { consultFlowsByWorkspace } from "@/features/agent-actions/services/consult-flujos";
import { consultProductsByAgent } from "@/features/agent-actions/services/consult-productos";
import { getOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import type { CommercialConversationContext } from "@/lib/commercial-stage";
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

type FlowStep =
  | { kind: "text"; content: string }
  | { kind: "image"; url: string; caption: string | null }
  | { kind: "audio"; url: string; caption: string | null }
  | { kind: "video"; url: string; caption: string | null }
  | { kind: "document"; url: string; caption: string | null; fileName: string | null };

export type { FlowStep };

type FlowReplyPayload = {
  steps: FlowStep[];
  aiFollowUpEnabled: boolean;
};

export type ActiveProductContext = {
  productId: string;
  productName: string;
  code: string | null;
  slug: string | null;
  description: string | null;
  price: string | null;
  categoryName: string | null;
  instructions: string | null;
  followUpFlowId: string | null;
};

type ProductFlowResolution = {
  steps: FlowStep[] | null;
  flowTitle: string | null;
  productName: string | null;
  aiFollowUpEnabled: boolean;
  activeProductContext: ActiveProductContext | null;
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
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "por",
    "para",
    "con",
    "un",
    "una",
    "flujo",
    "flujos",
    "catalogo",
    "catlogo",
    "quiero",
    "necesito",
    "tiene",
    "tienen",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

function textMatchesToken(text: string, token: string) {
  if (!text || !token) {
    return false;
  }

  return text === token || text.includes(token) || token.includes(text);
}

function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
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
  const steps: FlowStep[] = [];

  for (const node of candidateNodes) {
    if (node.kind === "trigger") continue;

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
    // audio, video, input, condition, action: ignored for now
  }

  // Fallback: if primary path produced no steps, try all nodes unordered
  if (!steps.length) {
    for (const node of nodes) {
      if (node.kind === "image") {
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
  }

  if (!steps.length) {
    return null;
  }

  const triggerNode = nodes.find((node) => node.kind === "trigger");
  const aiFollowUpEnabled = triggerNode?.aiFollowUpEnabled !== false;

  return { steps, aiFollowUpEnabled };
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
    score += 7;
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
    "REGLAS:",
    "- Usa la intención de cada flujo como guía principal para decidir si el mensaje del cliente corresponde.",
    "- Activa el flujo si el mensaje del cliente claramente encaja con lo que describe la intención, aunque no use las mismas palabras exactas.",
    "- NO activas un flujo si el cliente solo saluda, escribe algo fuera de tema o hace una pregunta completamente genérica sin relación con ninguna intención.",
    "- Si el cliente ya menciona un producto o modelo concreto en su mensaje y pregunta sobre ese producto específico → responde 'ninguno' para que la IA lo atienda directamente, no envíes un catálogo general.",
    "- Un flujo de catálogo o colección solo se activa cuando el cliente claramente no sabe qué quiere y pide ver opciones, modelos disponibles o comparar productos.",
    "- Si el cliente confirma con 'Si', 'Ok', 'Dale' y el contexto reciente ofreció enviar algo → actívalo.",
    "- Si dos flujos podrían aplicar, elige el más específico.",
    "- En caso de duda real → responde 'ninguno'.",
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
    temperature: 0,
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
  commercialContext?: CommercialConversationContext | null;
  activeProductContext?: ActiveProductContext | null;
}): Promise<ProductFlowResolution | null> {
  const latestText = input.latestUserMessage?.trim() || "";
  if (!latestText) {
    return null;
  }

  const normalizedLatestText = normalizeText(latestText);
  const commercialContext = input.commercialContext ?? null;
  const isAdvancedCommercialContext = Boolean(
    commercialContext &&
      (commercialContext.currentStage === "EXPOSICION" ||
        commercialContext.currentStage === "NEGOCIACION" ||
        commercialContext.currentStage === "ACUERDO" ||
        commercialContext.currentStage === "POSTVENTA" ||
        commercialContext.shownPrice ||
        commercialContext.shownProductMedia ||
        commercialContext.askedCityOrShipping ||
        commercialContext.presentedValue),
  );
  const looksLikePurchasePause =
    commercialContext?.objectionDetected ||
    includesAny(normalizedLatestText, [
      "manana",
      "luego",
      "despues",
      "mas tarde",
      "lo voy a pensar",
      "lo reviso",
      "estoy comparando",
      "no paso dinero",
      "no confio",
      "tengo dudas",
      "me da miedo",
    ].map((phrase) => normalizeText(phrase)));

  if (isAdvancedCommercialContext && looksLikePurchasePause) {
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
  const selectedFlows = flowTargets.filter((flow) => selectedFlowIds.has(flow.id));
  const flowCandidates = selectedFlows.length > 0 ? selectedFlows : flowTargets;
  const enabledChildFlowIds = new Set(
    input.activeProductContext?.followUpFlowId?.trim()
      ? [input.activeProductContext.followUpFlowId.trim()]
      : [],
  );
  const matchedProducts = await consultProductsByAgent({
    agentId: input.agentId,
    query: latestText,
    limit: 3,
  });
  const matchedProduct = matchedProducts.bestMatch;
  const candidateFlowIds = new Set(flowCandidates.map((flow) => flow.id));
  const availableFlowCandidates = flowCandidates.filter(
    (flow) => !flow.isChildFlow || enabledChildFlowIds.has(flow.id),
  );

  if (process.env.NODE_ENV !== "production") {
    console.info("[agent-product-flow] resolution-context", {
      agentId: input.agentId,
      hasActiveProductContext: Boolean(input.activeProductContext),
      activeProductFollowUpFlowId: input.activeProductContext?.followUpFlowId?.trim() || null,
      enabledChildFlowIds,
      matchedProduct: matchedProduct
        ? {
            productId: matchedProduct.productId,
            name: matchedProduct.name,
            followUpFlowId: matchedProduct.followUpFlowId,
          }
        : null,
      availableFlowTitles: availableFlowCandidates.map((flow) => flow.title),
    });
  }

  const matchedFlows = flowCandidates.length > 0
    ? await consultFlowsByWorkspace({
        workspaceId: input.workspaceId,
        includeOfficialApi: input.includeOfficialApi,
        query: latestText,
        limit: 3,
        allowedFlowIds: flowCandidates.map((flow) => flow.id),
        enabledChildFlowIds,
      })
    : null;

  if (matchedProduct) {
    const instructions = matchedProduct.instructions?.trim() || "";
    const hasPriorSameProductContext =
      input.activeProductContext?.productId === matchedProduct.productId &&
      Boolean(input.activeProductContext?.followUpFlowId?.trim());
    const activeProductContext: ActiveProductContext = {
      productId: matchedProduct.productId,
      productName: matchedProduct.name,
      code: matchedProduct.code ?? null,
      slug: matchedProduct.slug ?? null,
      description: matchedProduct.description ?? null,
      price: matchedProduct.price ?? null,
      categoryName: matchedProduct.categoryName ?? null,
      instructions: matchedProduct.instructions ?? null,
      followUpFlowId: matchedProduct.followUpFlowId ?? null,
    };

    if (!hasPriorSameProductContext) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[agent-product-flow] follow-up blocked", {
          agentId: input.agentId,
          productId: matchedProduct.productId,
          productName: matchedProduct.name,
          hasPriorSameProductContext,
          priorActiveProductContext: input.activeProductContext
            ? {
                productId: input.activeProductContext.productId,
                productName: input.activeProductContext.productName,
                followUpFlowId: input.activeProductContext.followUpFlowId,
              }
            : null,
        });
      }

      return {
        steps: null,
        flowTitle: null,
        productName: matchedProduct.name,
        aiFollowUpEnabled: false,
        activeProductContext,
      };
    }

    const flowTitles = availableFlowCandidates.map((flow) => flow.title);
    const references = extractFlowReferences(instructions, flowTitles);
    const flowByNormalizedTitle = new Map(flowTargets.map((flow) => [normalizeText(flow.title), flow]));
    const referencedFlowIds = references
      .map((reference) => flowByNormalizedTitle.get(normalizeText(reference.title))?.id)
      .filter((value): value is string => {
        if (typeof value !== "string") {
          return false;
        }

        return candidateFlowIds.has(value);
      });

    if (referencedFlowIds.length > 0) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[agent-product-flow] referenced-flow-hit", {
          agentId: input.agentId,
          productName: matchedProduct.name,
          referencedFlowIds,
          selectedFlowId: referencedFlowIds[0],
        });
      }

      const reply = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: referencedFlowIds[0],
        includeOfficialApi: input.includeOfficialApi,
      });

      if (reply) {
        const referencedFlow = flowTargets.find((flow) => flow.id === referencedFlowIds[0]);
        return {
          steps: reply.steps,
          flowTitle: referencedFlow?.title ?? matchedProduct.name,
          productName: matchedProduct.name,
          aiFollowUpEnabled: reply.aiFollowUpEnabled,
          activeProductContext,
        };
      }
    }

    return {
      steps: null,
      flowTitle: null,
      productName: matchedProduct.name,
      aiFollowUpEnabled: false,
      activeProductContext,
    };
  }

  const bestFlow = matchedFlows?.bestMatch;
  if (bestFlow) {
    const reply = await getFlowReply({
      workspaceId: input.workspaceId,
      flowId: bestFlow.flowId,
      includeOfficialApi: input.includeOfficialApi,
    });

    if (reply) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[agent-product-flow] flow-hit", {
          agentId: input.agentId,
          flowTitle: bestFlow.title,
          flowId: bestFlow.flowId,
          sourceProduct: null,
        });
      }

      return {
        steps: reply.steps,
        flowTitle: bestFlow.title,
        productName: null,
        aiFollowUpEnabled: reply.aiFollowUpEnabled,
        activeProductContext: null,
      };
    }
  }

  return null;
}

export function buildActiveProductContextNote(activeProductContext: ActiveProductContext | null | undefined) {
  if (!activeProductContext) {
    return null;
  }

  const lines = [
    `Producto activo: ${activeProductContext.productName}`,
    activeProductContext.code ? `Código: ${activeProductContext.code}` : null,
    activeProductContext.slug ? `Slug: ${activeProductContext.slug}` : null,
    activeProductContext.categoryName ? `Categoría: ${activeProductContext.categoryName}` : null,
    activeProductContext.description ? `Descripción: ${activeProductContext.description}` : null,
    activeProductContext.price ? `Precio: ${activeProductContext.price}` : null,
    activeProductContext.instructions ? `Instrucción: ${activeProductContext.instructions}` : null,
    activeProductContext.followUpFlowId ? `Flujo hijo habilitado: ${activeProductContext.followUpFlowId}` : null,
  ].filter(Boolean);

  return lines.length > 0 ? `CONTEXTO DEL PRODUCTO ACTIVO\n- ${lines.join("\n- ")}` : null;
}
