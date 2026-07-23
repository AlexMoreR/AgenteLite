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

export type { FlowReplyPayload };

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
  flowId: string | null;
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

type ProductActivationMode = "default" | "ia" | "chatbot";

function parseProductActivationMode(instructions: string | null): ProductActivationMode {
  const match = instructions?.match(/Activacion:\s*(default|ia|chatbot)/i);
  return (match?.[1]?.toLowerCase() as ProductActivationMode | undefined) ?? "default";
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

export async function getFlowReply(input: {
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
    "- Si el cliente menciona un producto o modelo concreto y hay un flujo cuya intención describe ESE mismo producto (lo nombra o lo pone como ejemplo) → activa ESE flujo. Un catálogo enfocado en un solo tipo de producto SÍ se activa cuando el cliente nombra ese producto (ej.: 'poltronas' → el catálogo de poltronas; 'silla de barbería' → el catálogo de sillas).",
    "- MENCIÓN AMBIGUA (clave): si el cliente menciona una CATEGORÍA amplia que abarca varios subtipos o encaja con varios flujos a la vez (p.ej. solo 'sillas' cuando hay sillas de peluquería, de barbería, neumáticas, de manicure; o 'muebles', 'catálogo' a secas), responde 'ninguno' para que la IA pregunte primero QUÉ TIPO necesita. NO dispares un catálogo con una mención ambigua. Dispáralo SOLO cuando el cliente concreta lo suficiente para identificar UN catálogo (p.ej. 'silla de barbería', 'silla neumática', 'poltrona spa').",
    "- Responde 'ninguno' por una mención de producto SOLO si NINGÚN flujo corresponde a ese producto concreto (ahí lo atiende la IA directamente), o si el único candidato es un catálogo GENERAL que mezcla muchos productos distintos y el cliente ya sabe exactamente cuál quiere.",
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

// --- Hook determinístico de ramas Condición→Flujo (Agente V2) ---
// La IA no dispara flujos de forma confiable (prefiere describir el producto con
// consultar_productos). Por eso, cuando un producto está activo, evaluamos sus
// ramas que terminan en Flujo directamente en el motor y, si el mensaje del
// cliente cumple la condición, ejecutamos el flujo SIN pasar por la IA.
type FlowBranchNode = { id: string; type?: string; data?: Record<string, unknown> };
type FlowBranchEdge = { source?: string; target?: string; sourceHandle?: string };

function fbStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function fbStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Respuestas afirmativas comunes: cubren el caso típico ("¿Te comparto fotos?" → "Si")
// sin depender de una llamada al modelo (que puede fallar/caer al fallback).
const AFFIRMATIVE_RESPONSES = new Set([
  "si", "sii", "siii", "sip", "claro", "dale", "ok", "oka", "okey", "okay", "vale",
  "listo", "sale", "obvio", "quiero", "perfecto", "bueno", "adelante", "va", "simon",
  "yes", "porfa", "porfavor", "interesa", "muestrame", "muestra", "envia", "enviame",
]);

function looksAffirmative(normalizedMessage: string): boolean {
  const msg = normalizedMessage.trim();
  if (!msg) {
    return false;
  }
  if (AFFIRMATIVE_RESPONSES.has(msg)) {
    return true;
  }
  const firstWord = msg.split(/\s+/)[0] ?? "";
  return AFFIRMATIVE_RESPONSES.has(firstWord);
}

// Afirmativos FUERTES para detectar si el intent de una rama ACEPTA un "Si" del cliente.
// A propósito NO incluye "si"/"va": en los intents el prefijo es "Si responde..." (el "si"
// condicional), así que "si" aparece SIEMPRE y no distingue. Estos, en cambio, solo aparecen
// cuando el usuario configuró la rama para reaccionar a un afirmativo/interés
// (p.ej. "quiero ver fotos", "ok", "si por favor").
const STRONG_AFFIRMATIVE_INTENT = new Set([
  "ok", "oka", "okey", "okay", "dale", "listo", "claro", "quiero", "muestrame",
  "muestra", "envia", "enviame", "porfa", "porfavor", "favor", "adelante", "obvio",
  "perfecto", "vale", "simon", "interesa",
]);

// ¿El texto del intent de la rama LISTA afirmativos? Si sí, un "Si" del cliente coincide de
// forma DETERMINÍSTICA, sin depender de un juez LLM (que a veces devuelve NO y hace que el "Si"
// caiga en la IA libre, que manda catálogos de más).
function intentAcceptsAffirmative(intent: string): boolean {
  return normalizeText(intent)
    .split(/[\s,.;:/]+/)
    .some((word) => STRONG_AFFIRMATIVE_INTENT.has(word));
}

const INTENT_STOPWORDS = new Set([
  "si", "responde", "con", "que", "de", "el", "la", "los", "las", "un", "una",
  "ver", "quiero", "tienes", "alguna", "sobre", "esta", "cliente", "por", "intencion",
  "muestra", "interes", "interesado", "todos", "todas", "o", "y", "a",
]);

function extractIntentKeywords(intent: string): string[] {
  return normalizeText(intent)
    .split(/[\s,.;:/]+/)
    .filter((word) => word.length >= 4 && !INTENT_STOPWORDS.has(word));
}

async function evaluateIaIntentMatch(input: {
  intent: string;
  message: string;
  model?: string | null;
}): Promise<boolean> {
  const intent = input.intent.trim();
  if (!intent) {
    return false;
  }
  const verdict = await generateAgentReply({
    model: input.model,
    rawSystemPrompt: true,
    systemPrompt:
      "Eres un clasificador binario. Decide si el mensaje del cliente cumple la condicion dada. " +
      "Responde UNICAMENTE con la palabra SI o NO, sin nada mas.",
    history: [],
    temperature: 0,
    latestUserMessage:
      `Condicion: ${intent}\nMensaje del cliente: "${input.message}"\n` +
      "¿El mensaje cumple la condicion? Responde SI o NO.",
  });
  return /^\s*si\b/.test(normalizeText(verdict));
}

async function resolveFlowBranchForActiveProduct(input: {
  productNodeId: string;
  nodes: FlowBranchNode[];
  edges: FlowBranchEdge[];
  message: string;
  normalizedMessage: string;
  flowTitleById: Map<string, string>;
  candidateFlowIds: Set<string>;
  model?: string | null;
  aiDrivenFlows?: boolean;
}): Promise<{ flowId: string; flowTitle: string } | null> {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n] as const));
  // Condiciones alcanzables hacia adelante desde el producto.
  const seen = new Set<string>();
  const conditions: FlowBranchNode[] = [];
  const visited = new Set<string>();
  const queue: string[] = [input.productNodeId];
  while (queue.length) {
    const current = queue.shift() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of input.edges) {
      if (edge.source !== current || !edge.target || visited.has(edge.target)) {
        continue;
      }
      const target = nodeById.get(edge.target);
      if (target?.type === "condicion" && !seen.has(target.id)) {
        seen.add(target.id);
        conditions.push(target);
      }
      queue.push(edge.target);
    }
  }

  for (const cond of conditions) {
    const rules = Array.isArray(cond.data?.rules)
      ? (cond.data?.rules as Array<Record<string, unknown>>)
      : [];
    for (const rule of rules) {
      const actionEdge = input.edges.find(
        (e) => e.source === cond.id && e.sourceHandle === fbStr(rule.id),
      );
      const targetNode = actionEdge?.target ? nodeById.get(actionEdge.target) : undefined;
      // Solo nos interesan ramas cuya acción sea ejecutar un Flujo.
      if (targetNode?.type !== "flujo") {
        continue;
      }
      const flowId = fbStr(targetNode.data?.flowId);
      if (!flowId || !input.candidateFlowIds.has(flowId)) {
        continue;
      }

      const matchType = fbStr(rule.matchType);
      let matched = false;
      if (matchType === "exacta") {
        matched = fbStrArray(rule.keywords).some((kw) => normalizeText(kw) === input.normalizedMessage);
      } else if (matchType === "ia") {
        // Un afirmativo suelto ("Si", "Ok", "Dale"...) es CIEGO al contexto: no sabemos
        // a qué le está diciendo que sí el cliente (puede ser a otro tema que el bot
        // acaba de ofrecer, p.ej. poltronas). Antes esto disparaba la rama del producto
        // ACTIVO a ciegas. Ahora un afirmativo suelto NO dispara la rama: esa decisión la
        // toma el clasificador con HISTORIAL (selectFlowByAI) más abajo. La rama IA solo
        // coincide con contenido sustantivo (palabra del intent o juez LLM explícito).
        const intent = fbStr(rule.intent);
        const intentKeywords = extractIntentKeywords(intent);
        const hasIntentKeyword =
          intentKeywords.length > 0 && includesAny(input.normalizedMessage, intentKeywords);
        if (hasIntentKeyword) {
          // El mensaje trae contenido SUSTANTIVO del intent (p.ej. "si FOTOS" contiene "fotos"):
          // dispara la condición del producto activo, aunque empiece con un afirmativo. Antes
          // "si fotos" se trataba como "si" a secas → se saltaba la condición → caía en el
          // clasificador y disparaba el flujo de fotos de OTRO producto (lavacabezas en camillas).
          matched = true;
        } else if (looksAffirmative(input.normalizedMessage)) {
          // Un afirmativo suelto ("Si", "ok", "dale") normalmente se defería a selectFlowByAI
          // (el clasificador con historial). Con el motor IA-primero (aiDrivenFlows) ese
          // clasificador está APAGADO: si no arbitramos acá, el "Si" cae en la IA libre
          // (enviar_flujo), que se pasa y manda catálogos de más (p.ej. manicura en una charla
          // de camillas). La condición del producto ACTIVO es justo la que responde al
          // "¿te comparto fotos?" que el embudo acaba de ofrecer.
          if (!input.aiDrivenFlows) {
            matched = false;
          } else if (intentAcceptsAffirmative(intent)) {
            // La rama LISTA afirmativos ("Si, quiero ver fotos, ok, si por favor..."): un "Si"
            // coincide de forma DETERMINÍSTICA, sin juez LLM. El juez es un llamado a un modelo
            // que a veces devuelve NO (o falla) y hacía que el "Si" cayera en la IA libre → manicura
            // de vuelta, de forma INTERMITENTE. Determinístico = mismo resultado siempre.
            matched = true;
          } else {
            // La rama no lista afirmativos explícitos: recién ahí preguntamos al juez.
            matched = await evaluateIaIntentMatch({ intent, message: input.message, model: input.model });
          }
        } else {
          matched = await evaluateIaIntentMatch({ intent, message: input.message, model: input.model });
        }
      } else {
        matched = includesAny(
          input.normalizedMessage,
          fbStrArray(rule.keywords).map((kw) => normalizeText(kw)),
        );
      }

      if (matched) {
        return { flowId, flowTitle: input.flowTitleById.get(flowId) ?? "" };
      }
    }
  }
  return null;
}

/**
 * ¿El mensaje justifica CAMBIAR del producto activo a otro producto?
 *
 * Raíz medida (22-jul-2026, chat de camillas que terminó en lavacabezas): el matcher recalcula el
 * producto en CADA mensaje. Un mensaje de seguimiento con una palabra genérica —"silla",
 * "espaldar"— que el producto activo YA incluye hacía saltar el contexto a otro producto (el combo
 * de camillas incluye "silla auxiliar" y "espaldar", y "silla" hacía ganar al "Combo
 * Lavacabezas+Silla"). Resultado: el bot presentaba lavacabezas en una charla de camillas.
 *
 * Regla (validada con datos reales): solo se acepta el cambio si el mensaje trae al menos un token
 * que apunta al NUEVO producto y que NO está explicado por el nombre/descripción del producto
 * ACTIVO. "silla con espaldar" (explicado por el combo de camillas) NO cambia; "quiero un
 * lavacabezas" (token distintivo "lavacabezas") SÍ cambia. Erra a favor de MANTENER el activo: es
 * más seguro que saltar mal (la IA puede seguir conversando igual).
 */
function isProductSwitchJustified(input: {
  active: ActiveProductContext;
  next: { name: string; description: string | null };
  message: string;
}): boolean {
  const activeTokens = new Set(tokenize(`${input.active.productName} ${input.active.description ?? ""}`));
  const nextTokens = tokenize(`${input.next.name} ${input.next.description ?? ""}`);
  const messageTokens = tokenize(input.message);

  return messageTokens.some((token) => {
    const pointsToNext = nextTokens.some((nt) => nt === token || nt.includes(token) || token.includes(nt));
    if (!pointsToNext) {
      return false;
    }
    const explainedByActive = [...activeTokens].some((at) => at === token || at.includes(token) || token.includes(at));
    return !explainedByActive;
  });
}

/**
 * Aplica la pegajosidad: si hay un producto activo y el matcher propone OTRO producto sin evidencia
 * distintiva en el mensaje, se mantiene el activo (devuelve null = "sin match nuevo este turno", que
 * el motor ya maneja usando el activeProductContext).
 */
function applyActiveProductStickiness<T extends { productId: string; name: string; description: string | null }>(input: {
  rawMatchedProduct: T | null;
  activeProductContext: ActiveProductContext | null;
  message: string;
  agentId: string;
}): T | null {
  const { rawMatchedProduct, activeProductContext } = input;
  if (!rawMatchedProduct || !activeProductContext) {
    return rawMatchedProduct;
  }
  if (rawMatchedProduct.productId === activeProductContext.productId) {
    return rawMatchedProduct;
  }
  if (isProductSwitchJustified({ active: activeProductContext, next: rawMatchedProduct, message: input.message })) {
    return rawMatchedProduct;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[agent-product-flow] sticky-product-kept", {
      agentId: input.agentId,
      active: activeProductContext.productName,
      proposed: rawMatchedProduct.name,
      message: input.message,
    });
  }
  return null;
}

/**
 * Candado de un-solo-producto para `enviar_flujo`, con señal CONFIABLE (títulos de flujo).
 *
 * Devuelve el set de flowIds que la IA PUEDE enviar cuando el producto activo es `activeProductName`:
 * los flujos cuyo título/intención contienen una palabra DISTINTIVA del producto activo (una que no
 * comparte con otros productos del agente), más el `followUpFlowId` del producto. Si el producto no
 * tiene ninguna palabra distintiva, devuelve `null` (no se puede acotar → NO se aplica candado).
 *
 * Reemplaza el intento anterior (lista blanca desde el GRAFO), que estaba viejo/incompleto y
 * bloqueaba envíos buenos (fotos reales del producto). Los títulos de los flujos son dato vivo.
 * Medido con datos reales: con producto activo "Combo Camillas" permite los 2 flujos de camillas y
 * bloquea el catálogo de manicura (el bug real); con "Lavacabezas" permite sus flujos (incl. fotos).
 */
export function resolveProductScopedFlowIds(input: {
  activeProductName: string;
  otherProductNames: string[];
  followUpFlowId?: string | null;
  flows: Array<{ id: string; title: string; intent?: string | null }>;
}): Set<string> | null {
  const mineTokens = tokenize(input.activeProductName);
  const otherTokens = new Set(input.otherProductNames.flatMap((name) => tokenize(name)));
  const distinctive = mineTokens.filter(
    (token) => ![...otherTokens].some((other) => other === token || other.includes(token) || token.includes(other)),
  );
  if (distinctive.length === 0) {
    return null;
  }

  const allowed = new Set<string>();
  const follow = input.followUpFlowId?.trim();
  if (follow) {
    allowed.add(follow);
  }
  for (const flow of input.flows) {
    const hay = tokenize(`${flow.title} ${flow.intent ?? ""}`);
    const belongsToActive = distinctive.some((d) => hay.some((h) => h === d || h.includes(d) || d.includes(h)));
    if (belongsToActive) {
      allowed.add(flow.id);
    }
  }
  return allowed;
}

export async function resolveAgentProductFlowReply(input: {
  agentId: string;
  workspaceId: string;
  latestUserMessage: string | null;
  history?: ConversationLine[];
  includeOfficialApi: boolean;
  commercialContext?: CommercialConversationContext | null;
  activeProductContext?: ActiveProductContext | null;
  // Motor IA-primero (híbrido): cuando es true se CONSERVA lo determinístico —activación por
  // keyword (chatbot) y las condiciones cableadas Condición→Flujo—, pero se SALTA el
  // selectFlowByAI que ADIVINA un catálogo ante algo ambiguo (el que mandaba manicura). En ese
  // caso devuelve null para que la IA maneje el hueco con la tool enviar_flujo.
  aiDrivenFlows?: boolean;
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
        graph: true,
        model: true,
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
  // Agente V2: si el toggle "Consultar flujos" está apagado (enableFlowLookup=false),
  // NO hay candidatos -> el motor no dispara ningún flujo por coincidencia.
  // Si está activo pero no se seleccionó ninguno, se mantiene el comportamiento V1
  // ("vacío = todos") para no romper agentes existentes.
  const flowCandidates =
    training.enableFlowLookup === false
      ? []
      : selectedFlows.length > 0
        ? selectedFlows
        : flowTargets;
  const enabledChildFlowIds = new Set(
    input.activeProductContext?.followUpFlowId?.trim()
      ? [input.activeProductContext.followUpFlowId.trim()]
      : [],
  );
  // Agente V2: si "Consultar productos" está apagado, no consultamos el catálogo
  // del agente (evita el match de embudo y la llamada/ log innecesarios).
  const rawMatchedProduct =
    training.enableProductLookup === false
      ? null
      : (
          await consultProductsByAgent({
            agentId: input.agentId,
            query: latestText,
            limit: 3,
          })
        ).bestMatch;
  // Pegajosidad del producto activo: no saltar a otro producto por un token genérico que el
  // producto activo ya incluye (raíz medida del "lavacabezas en charla de camillas"). Si el cambio
  // no está justificado, se trata como "sin match nuevo" y se conserva el activeProductContext.
  const matchedProduct = applyActiveProductStickiness({
    rawMatchedProduct,
    activeProductContext: input.activeProductContext ?? null,
    message: latestText,
    agentId: input.agentId,
  });
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

  // HOOK DETERMINÍSTICO de ramas Condición→Flujo: si hay un producto ACTIVO
  // (contexto de un turno previo) y el cliente cumple la condición de una rama
  // que termina en Flujo, disparamos ese flujo directo, sin pasar por la IA.
  const activeProductId =
    (matchedProduct?.productId ?? input.activeProductContext?.productId)?.trim() || "";
  if (activeProductId && flowCandidates.length > 0) {
    const graph = agent.graph as { nodes?: FlowBranchNode[]; edges?: FlowBranchEdge[] } | null;
    const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
    const productNode = graphNodes.find(
      (n) => n.type === "producto" && fbStr(n.data?.productId) === activeProductId,
    );
    if (productNode) {
      const flowTitleById = new Map(flowTargets.map((flow) => [flow.id, flow.title] as const));
      const branch = await resolveFlowBranchForActiveProduct({
        productNodeId: productNode.id,
        nodes: graphNodes,
        edges: graphEdges,
        message: latestText,
        normalizedMessage: normalizedLatestText,
        flowTitleById,
        // Una rama Condición→Flujo está CABLEADA a mano por el usuario a un flujo concreto:
        // debe poder dispararlo esté o no marcado en "Consultar flujos". Antes se validaba
        // contra candidateFlowIds (solo los seleccionados), así que un flujo cableado pero no
        // seleccionado (p.ej. "Foto de combo de camilla") se descartaba y la IA improvisaba.
        candidateFlowIds: new Set(flowTargets.map((flow) => flow.id)),
        model: agent.model,
        aiDrivenFlows: input.aiDrivenFlows,
      });
      if (branch) {
        const reply = await getFlowReply({
          workspaceId: input.workspaceId,
          flowId: branch.flowId,
          includeOfficialApi: input.includeOfficialApi,
        });
        if (reply) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[agent-product-flow] branch-flow-hit", {
              agentId: input.agentId,
              activeProductId,
              flowTitle: branch.flowTitle,
              flowId: branch.flowId,
            });
          }
          return {
            steps: reply.steps,
            flowTitle: branch.flowTitle || null,
            productName: input.activeProductContext?.productName ?? null,
            flowId: branch.flowId,
            aiFollowUpEnabled: reply.aiFollowUpEnabled,
            activeProductContext: input.activeProductContext ?? null,
          };
        }
      }
    }
  }

  // El matcher difuso global (bestFlow) SOLO debe disparar flujos por palabra clave
  // (tipo "chatbot"): son coincidencias exacta/contiene, predecibles. Los flujos
  // tipo "IA" NO se auto-disparan por similitud de texto —eso produce falsos
  // positivos como "que" ⊂ "pelu*que*ria" disparando SILLAS DE PELUQUERIA—; se
  // resuelven por comprensión (la IA con consultar_flujos) o por Condiciones de V2.
  // OJO: NO filtramos flowCandidates/candidateFlowIds; el hook de ramas Condición→Flujo
  // sigue viendo TODOS los flujos (incl. los IA cableados, p.ej. "Fotos combo camillas").
  const keywordFlowCandidates = flowCandidates.filter((flow) => flow.flowType === "chatbot");
  const matchedFlows = keywordFlowCandidates.length > 0
    ? await consultFlowsByWorkspace({
        workspaceId: input.workspaceId,
        includeOfficialApi: input.includeOfficialApi,
        query: latestText,
        limit: 3,
        allowedFlowIds: keywordFlowCandidates.map((flow) => flow.id),
        enabledChildFlowIds,
      })
    : null;

  if (matchedProduct) {
    const instructions = matchedProduct.instructions?.trim() || "";
    const activationMode = parseProductActivationMode(instructions);
    const isChatbotActivation = activationMode === "chatbot";
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

    // Para productos con activacion CHATBOT (por palabras clave) el envio del
    // embudo es deterministico: si las palabras clave coinciden, enviamos el
    // flujo del producto de inmediato en la primera interaccion, sin esperar
    // un segundo turno. Los modos default/ia mantienen el enganche en dos turnos.
    const shouldResolveFunnelFlow = hasPriorSameProductContext || isChatbotActivation;

    if (!shouldResolveFunnelFlow) {
      // El producto matcheó (a menudo por su NOMBRE al escribir una palabra genérica: p.ej.
      // "lavacabezas" → "Combo Lavacabezas+Silla"), pero en modo default/ia NO debe secuestrar
      // el turno. Si hay un FLUJO de catálogo que corresponde a lo que pidió el cliente, ese
      // flujo GANA (muestra el catálogo) y NO activamos el embudo del producto. Así "lavacabezas"
      // muestra el catálogo en vez de arrancar la calificación del combo.
      // Con aiDrivenFlows NO adivinamos el catálogo con selectFlowByAI: eso es lo que mandaba el
      // producto equivocado (manicura). Se deja que la IA elija y mande con enviar_flujo.
      const iaFlowCandidatesForProduct = input.aiDrivenFlows
        ? []
        : availableFlowCandidates.filter((flow) => flow.flowType === "ia");
      if (iaFlowCandidatesForProduct.length > 0) {
        const selectedFlowId = await selectFlowByAI({
          flows: iaFlowCandidatesForProduct.map((flow) => ({ id: flow.id, title: flow.title, intent: flow.intent })),
          latestUserMessage: latestText,
          history: input.history ?? [],
        });
        if (selectedFlowId) {
          const reply = await getFlowReply({
            workspaceId: input.workspaceId,
            flowId: selectedFlowId,
            includeOfficialApi: input.includeOfficialApi,
          });
          if (reply) {
            const selectedFlow = flowTargets.find((flow) => flow.id === selectedFlowId);
            if (process.env.NODE_ENV !== "production") {
              console.info("[agent-product-flow] product-name-match-deferred-to-flow", {
                agentId: input.agentId,
                productName: matchedProduct.name,
                flowTitle: selectedFlow?.title ?? null,
                flowId: selectedFlowId,
              });
            }
            return {
              steps: reply.steps,
              flowTitle: selectedFlow?.title ?? null,
              productName: null,
              flowId: selectedFlowId,
              aiFollowUpEnabled: reply.aiFollowUpEnabled,
              // No activamos el producto: el cliente pidió el catálogo, no el combo.
              activeProductContext: null,
            };
          }
        }
      }

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
        flowId: null,
        aiFollowUpEnabled: false,
        activeProductContext,
      };
    }

    // En modo chatbot habilitamos el flujo hijo del propio producto para que
    // sea elegible aunque sea la primera interaccion (no hay contexto previo).
    const productFollowUpFlowId = matchedProduct.followUpFlowId?.trim() || "";
    const productEnabledChildFlowIds = isChatbotActivation && productFollowUpFlowId
      ? new Set([...enabledChildFlowIds, productFollowUpFlowId])
      : enabledChildFlowIds;
    const productFlowCandidates = isChatbotActivation
      ? flowCandidates.filter((flow) => !flow.isChildFlow || productEnabledChildFlowIds.has(flow.id))
      : availableFlowCandidates;

    const flowTitles = productFlowCandidates.map((flow) => flow.title);
    // El bloque "REGLAS DE RAMIFICACION" (compilado desde los nodos Condición de V2)
    // contiene flujos CONDICIONALES que la IA dispara según la conversación. NUNCA
    // deben dispararse en el primer turno por la activación chatbot, así que los
    // excluimos del escaneo de referencias de embudo.
    const branchingIdx = instructions.indexOf("REGLAS DE RAMIFICACION");
    const funnelInstructions = branchingIdx >= 0 ? instructions.slice(0, branchingIdx) : instructions;
    const references = extractFlowReferences(funnelInstructions, flowTitles);
    const flowByNormalizedTitle = new Map(flowTargets.map((flow) => [normalizeText(flow.title), flow]));
    const referencedFlowIds = references
      .map((reference) => flowByNormalizedTitle.get(normalizeText(reference.title))?.id)
      .filter((value): value is string => {
        if (typeof value !== "string") {
          return false;
        }

        return candidateFlowIds.has(value) || value === productFollowUpFlowId;
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
          flowId: referencedFlowIds[0],
          aiFollowUpEnabled: reply.aiFollowUpEnabled,
          activeProductContext,
        };
      }
    }

    // Fallback chatbot: si el embudo no referencia un flujo en su texto,
    // enviamos el "Flujo hijo del embudo" configurado para el producto.
    if (isChatbotActivation && productFollowUpFlowId) {
      const reply = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: productFollowUpFlowId,
        includeOfficialApi: input.includeOfficialApi,
      });

      if (reply) {
        if (process.env.NODE_ENV !== "production") {
          console.info("[agent-product-flow] chatbot-follow-up-flow-hit", {
            agentId: input.agentId,
            productName: matchedProduct.name,
            followUpFlowId: productFollowUpFlowId,
          });
        }

        const followUpFlow = flowTargets.find((flow) => flow.id === productFollowUpFlowId);
        return {
          steps: reply.steps,
          flowTitle: followUpFlow?.title ?? matchedProduct.name,
          productName: matchedProduct.name,
          flowId: productFollowUpFlowId,
          aiFollowUpEnabled: reply.aiFollowUpEnabled,
          activeProductContext,
        };
      }
    }

    return {
      steps: null,
      flowTitle: null,
      productName: matchedProduct.name,
      flowId: null,
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
        flowId: bestFlow.flowId,
        aiFollowUpEnabled: reply.aiFollowUpEnabled,
        activeProductContext: null,
      };
    }
  }

  // Paso 2: clasificador con IA + HISTORIAL para flujos tipo "IA".
  // En vez de similitud difusa (apagada para IA) o de un "Si" ciego en el hook de
  // ramas, un modelo decide —usando lo que el bot acaba de ofrecer (el historial)— si
  // el mensaje del cliente corresponde a la intención de algún flujo IA, y lo ejecuta.
  // Si no hay coincidencia clara responde "ninguno" y no dispara nada (sin falsos
  // positivos). Así un "Si" se resuelve según de qué se estaba hablando.
  // Con aiDrivenFlows NO corre este clasificador que adivina un flujo IA: es el otro punto donde
  // el motor elegía mal. Sin candidatos, no dispara y la IA maneja con enviar_flujo.
  const iaFlowCandidates = input.aiDrivenFlows
    ? []
    : availableFlowCandidates.filter((flow) => flow.flowType === "ia");
  if (iaFlowCandidates.length > 0) {
    const selectedFlowId = await selectFlowByAI({
      flows: iaFlowCandidates.map((flow) => ({ id: flow.id, title: flow.title, intent: flow.intent })),
      latestUserMessage: latestText,
      history: input.history ?? [],
    });

    if (selectedFlowId) {
      const reply = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: selectedFlowId,
        includeOfficialApi: input.includeOfficialApi,
      });

      if (reply) {
        const selectedFlow = flowTargets.find((flow) => flow.id === selectedFlowId);
        if (process.env.NODE_ENV !== "production") {
          console.info("[agent-product-flow] ai-flow-classifier-hit", {
            agentId: input.agentId,
            flowId: selectedFlowId,
            flowTitle: selectedFlow?.title ?? null,
          });
        }

        return {
          steps: reply.steps,
          flowTitle: selectedFlow?.title ?? null,
          productName: null,
          flowId: selectedFlowId,
          aiFollowUpEnabled: reply.aiFollowUpEnabled,
          activeProductContext: input.activeProductContext ?? null,
        };
      }
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
