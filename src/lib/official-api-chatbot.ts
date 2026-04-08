import type {
  OfficialApiChatbotBuilderEdge,
  OfficialApiChatbotBuilderNode,
  OfficialApiChatbotEdgesByScenarioId,
  OfficialApiChatbotNodePositionsByScenarioId,
  OfficialApiChatbotNodesByScenarioId,
  OfficialApiChatbotScenario,
} from "@/features/official-api/types/official-api";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type OfficialApiChatbotBuilderState = {
  isBotEnabled: boolean;
  welcomeMessage: string;
  fallbackMessage: string;
  businessHours: string;
  captureLeadEnabled: boolean;
  handoffEnabled: boolean;
  fallbackEnabled: boolean;
  selectedScenarioId: string;
  scenarios: OfficialApiChatbotScenario[];
  nodesByScenarioId: OfficialApiChatbotNodesByScenarioId;
  nodePositionsByScenarioId: OfficialApiChatbotNodePositionsByScenarioId;
  edgesByScenarioId: OfficialApiChatbotEdgesByScenarioId;
};

export type StoredOfficialApiAutomationRule = {
  id: string;
  name: string;
  description: string | null;
  triggerText: string | null;
  responseText: string | null;
  isFallback: boolean;
  priority: number;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
};

const BUILDER_RULE_NAME = "__builder_config__";
const WELCOME_RULE_NAME = "__welcome__";
const AFTER_HOURS_RULE_NAME = "__after_hours__";
const FALLBACK_RULE_NAME = "__fallback__";

function getDefaultBuilderNodes(input: {
  welcomeMessage: string;
  fallbackMessage: string;
  businessHours: string;
}) {
  const routerMeta = input.businessHours
    ? `precio, cotizar, soporte | ${input.businessHours}`
    : "precio, cotizar, soporte";

  return [
    {
      id: "trigger",
      kind: "trigger",
      title: "Disparador",
      body: "El flujo inicia cuando entra un mensaje nuevo al numero oficial de WhatsApp.",
      meta: "Evento de entrada",
    },
    {
      id: "welcome",
      kind: "message",
      title: "Bienvenida",
      body: input.welcomeMessage,
      meta: "Mensaje inicial",
    },
    {
      id: "router",
      kind: "condition",
      title: "Router de intencion",
      body: "Clasifica ventas, soporte y consultas generales.",
      meta: routerMeta,
    },
    {
      id: "reply",
      kind: "message",
      title: "Respuesta principal",
      body: "Te ayudo con ventas. Dime que producto te interesa y en que ciudad estas para compartirte la mejor opcion.",
      meta: "Salida del bot",
    },
    {
      id: "capture",
      kind: "input",
      title: "Captura de lead",
      body: "Solicita nombre, ciudad, producto y presupuesto antes de cerrar.",
      meta: "Datos del contacto",
    },
    {
      id: "handoff",
      kind: "action",
      title: "Transferencia humana",
      body: "Si el usuario quiere avanzar, deriva a un asesor humano con el contexto completo.",
      meta: "Accion interna",
    },
    {
      id: "fallback",
      kind: "message",
      title: "Fallback seguro",
      body: input.fallbackMessage,
      meta: "Proteccion del bot",
    },
  ] satisfies OfficialApiChatbotBuilderNode[];
}

const defaultBuilderState: OfficialApiChatbotBuilderState = {
  isBotEnabled: true,
  welcomeMessage:
    "Hola. Soy el asistente automatico de WhatsApp. Cuentame si necesitas ventas, soporte, catalogo o hablar con un asesor.",
  fallbackMessage:
    "Todavia no tengo una respuesta segura para eso. Si quieres, te conecto con un asesor y dejo tu caso priorizado.",
  businessHours: "",
  captureLeadEnabled: true,
  handoffEnabled: true,
  fallbackEnabled: true,
  selectedScenarioId: "",
  scenarios: [],
  nodesByScenarioId: {},
  nodePositionsByScenarioId: {},
  edgesByScenarioId: {},
};

function normalizeNode(node: OfficialApiChatbotBuilderNode) {
  return {
    id: node.id.trim() || randomUUID(),
    kind: node.kind,
    title: node.title.trim() || "Bloque",
    body: node.body.trim(),
    meta: node.meta.trim(),
  } satisfies OfficialApiChatbotBuilderNode;
}

function normalizeNodesByScenarioId(
  input: unknown,
  fallback: { welcomeMessage: string; fallbackMessage: string; businessHours: string },
): OfficialApiChatbotNodesByScenarioId {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).map(([scenarioId, nodes]) => [
      scenarioId,
      Array.isArray(nodes) && nodes.length > 0
        ? nodes.map((node) => normalizeNode(node as OfficialApiChatbotBuilderNode))
        : getDefaultBuilderNodes(fallback),
    ]),
  );
}

function normalizeEdge(edge: OfficialApiChatbotBuilderEdge) {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fallbackId = `edge_${safe(edge.source.trim())}__${safe(edge.target.trim())}`;
  return {
    id: edge.id.trim() || fallbackId,
    source: edge.source.trim(),
    target: edge.target.trim(),
  } satisfies OfficialApiChatbotBuilderEdge;
}

function normalizeEdgesByScenarioId(input: unknown): OfficialApiChatbotEdgesByScenarioId {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).map(([scenarioId, edges]) => [
      scenarioId,
      Array.isArray(edges)
        ? edges
            .map((edge) => normalizeEdge(edge as OfficialApiChatbotBuilderEdge))
            .filter((edge) => edge.source && edge.target)
        : [],
    ]),
  );
}

function normalizeNodePositionsByScenarioId(input: unknown): OfficialApiChatbotNodePositionsByScenarioId {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).map(([scenarioId, positions]) => {
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

function buildDefaultNodesFromState(state: Pick<OfficialApiChatbotBuilderState, "welcomeMessage" | "fallbackMessage" | "businessHours">) {
  return getDefaultBuilderNodes({
    welcomeMessage: state.welcomeMessage,
    fallbackMessage: state.fallbackMessage,
    businessHours: state.businessHours,
  });
}

function getActiveScenarioNodes(state: OfficialApiChatbotBuilderState): OfficialApiChatbotBuilderNode[] {
  const selectedNodes = state.nodesByScenarioId[state.selectedScenarioId];
  if (selectedNodes && selectedNodes.length > 0) {
    return selectedNodes;
  }

  const firstScenarioId = state.scenarios[0]?.id ?? "";
  const firstScenarioNodes = state.nodesByScenarioId[firstScenarioId];
  if (firstScenarioNodes && firstScenarioNodes.length > 0) {
    return firstScenarioNodes;
  }

  return buildDefaultNodesFromState(state);
}

function getActiveScenarioEdges(
  state: OfficialApiChatbotBuilderState,
  nodes: OfficialApiChatbotBuilderNode[],
): OfficialApiChatbotBuilderEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const selectedEdges = state.edgesByScenarioId[state.selectedScenarioId];
  const firstScenarioId = state.scenarios[0]?.id ?? "";
  const firstScenarioEdges = state.edgesByScenarioId[firstScenarioId];
  const candidateEdges = selectedEdges ?? firstScenarioEdges ?? [];

  return candidateEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target);
}

function getPrimaryPathNodeIds(
  nodes: OfficialApiChatbotBuilderNode[],
  edges: OfficialApiChatbotBuilderEdge[],
): string[] {
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
    const nextId = outgoingBySource.get(currentId)?.[0] ?? "";
    currentId = nextId;
  }

  return orderedIds;
}

function selectRuntimeNodes(state: OfficialApiChatbotBuilderState) {
  const activeNodes = getActiveScenarioNodes(state);
  const activeEdges = getActiveScenarioEdges(state, activeNodes);
  const nodeById = new Map(activeNodes.map((node) => [node.id, node]));
  const primaryPathNodes = getPrimaryPathNodeIds(activeNodes, activeEdges)
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is OfficialApiChatbotBuilderNode => Boolean(node));
  const orderedNodes = primaryPathNodes.length > 0 ? primaryPathNodes : activeNodes;

  const isWelcomeNode = (node: OfficialApiChatbotBuilderNode) =>
    node.id === "welcome" || node.title.toLowerCase().includes("bienvenida");
  const isFallbackNode = (node: OfficialApiChatbotBuilderNode) =>
    node.id === "fallback" || node.title.toLowerCase().includes("fallback");

  const welcomeNode = orderedNodes.find((node) => isWelcomeNode(node)) ?? activeNodes.find((node) => isWelcomeNode(node));
  const fallbackNode = orderedNodes.find((node) => isFallbackNode(node)) ?? activeNodes.find((node) => isFallbackNode(node));
  const routerNode = orderedNodes.find((node) => node.kind === "condition") ?? activeNodes.find((node) => node.kind === "condition");
  const replyNode =
    orderedNodes.find((node) => node.id === "reply") ??
    orderedNodes.find((node) => node.kind === "message" && !isWelcomeNode(node) && !isFallbackNode(node)) ??
    activeNodes.find((node) => node.id === "reply") ??
    activeNodes.find((node) => node.kind === "message" && !isWelcomeNode(node) && !isFallbackNode(node));
  const captureNode =
    orderedNodes.find((node) => node.id === "capture" || node.kind === "input") ??
    activeNodes.find((node) => node.id === "capture" || node.kind === "input");
  const handoffNode =
    orderedNodes.find((node) => node.id === "handoff" || node.kind === "action") ??
    activeNodes.find((node) => node.id === "handoff" || node.kind === "action");

  return {
    welcomeNode,
    fallbackNode,
    routerNode,
    replyNode,
    captureNode,
    handoffNode,
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getAfterHoursMessage() {
  return "En este momento no hay asesor disponible. Si deseas continuar, comparte nombre, producto y ciudad para retomar la conversacion.";
}

function normalizeAfterHoursReply(input: string | null) {
  const text = input?.trim() || "";
  if (!text) {
    return getAfterHoursMessage();
  }

  const normalized = normalizeText(text);
  const hasLegacyContent =
    normalized.includes("nuestro horario es") ||
    normalized.includes("lunes a viernes") ||
    normalized.includes("siguiente turno");

  return hasLegacyContent ? getAfterHoursMessage() : text;
}

function getScenarioRule(state: OfficialApiChatbotBuilderState) {
  const selectedScenario =
    state.scenarios.find((scenario) => scenario.id === state.selectedScenarioId) ?? state.scenarios[0] ?? null;
  const rawScenarioKey = (selectedScenario?.id || state.selectedScenarioId || "custom").trim();
  const scenarioSlug = normalizeText(rawScenarioKey).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const scenarioName = scenarioSlug ? `intent_${scenarioSlug}` : "intent_custom";
  const description = selectedScenario
    ? `Escenario visual seleccionado: ${selectedScenario.title} (${selectedScenario.id})`
    : `Escenario visual seleccionado: ${state.selectedScenarioId || "custom"}`;

  return {
    name: scenarioName,
    triggerText: "",
    responseText: "",
    description,
  };
}

export async function listOfficialApiAutomationRules(configId: string): Promise<StoredOfficialApiAutomationRule[]> {
  return prisma.$queryRaw<StoredOfficialApiAutomationRule[]>`
    SELECT
      "id",
      "name",
      "description",
      "triggerText",
      "responseText",
      "isFallback",
      "priority",
      "status"::text as "status"
    FROM "OfficialApiAutomationRule"
    WHERE "configId" = ${configId}
    ORDER BY "priority" ASC, "createdAt" ASC
  `;
}

export async function getOfficialApiChatbotBuilderState(
  configId: string,
): Promise<OfficialApiChatbotBuilderState> {
  const rules = await listOfficialApiAutomationRules(configId);
  const builderRule = rules.find((rule) => rule.name === BUILDER_RULE_NAME);

  if (!builderRule?.description?.trim()) {
    return defaultBuilderState;
  }

  try {
    const parsed = JSON.parse(builderRule.description) as Partial<OfficialApiChatbotBuilderState>;
    return {
      ...defaultBuilderState,
      ...parsed,
      scenarios:
        Array.isArray(parsed.scenarios) && parsed.scenarios.length > 0
          ? parsed.scenarios.map((scenario, index) => ({
              id: scenario.id?.trim() || `workflow-${index + 1}`,
              title: scenario.title?.trim() || `Workflow ${index + 1}`,
              summary: scenario.summary?.trim() || "Workflow personalizado del builder.",
              messages: Array.isArray(scenario.messages) ? scenario.messages : [],
            }))
          : defaultBuilderState.scenarios,
      nodesByScenarioId: normalizeNodesByScenarioId(parsed.nodesByScenarioId, {
        welcomeMessage: parsed.welcomeMessage || defaultBuilderState.welcomeMessage,
        fallbackMessage: parsed.fallbackMessage || defaultBuilderState.fallbackMessage,
        businessHours: parsed.businessHours || defaultBuilderState.businessHours,
      }),
      nodePositionsByScenarioId: normalizeNodePositionsByScenarioId(parsed.nodePositionsByScenarioId),
      edgesByScenarioId: normalizeEdgesByScenarioId(parsed.edgesByScenarioId),
    };
  } catch {
    return defaultBuilderState;
  }
}

export async function saveOfficialApiChatbotBuilderState(
  configId: string,
  state: OfficialApiChatbotBuilderState,
): Promise<void> {
  const normalizedState: OfficialApiChatbotBuilderState = {
    ...defaultBuilderState,
    ...state,
    welcomeMessage: state.welcomeMessage.trim() || defaultBuilderState.welcomeMessage,
    fallbackMessage: state.fallbackMessage.trim() || defaultBuilderState.fallbackMessage,
    businessHours: state.businessHours.trim() || defaultBuilderState.businessHours,
    selectedScenarioId: state.selectedScenarioId.trim() || defaultBuilderState.selectedScenarioId,
    scenarios:
      Array.isArray(state.scenarios) && state.scenarios.length > 0
        ? state.scenarios.map((scenario, index) => ({
            id: scenario.id.trim() || `workflow-${index + 1}`,
            title: scenario.title.trim() || `Workflow ${index + 1}`,
            summary: scenario.summary.trim() || "Workflow personalizado del builder.",
            messages: Array.isArray(scenario.messages) ? scenario.messages : [],
          }))
        : defaultBuilderState.scenarios,
    nodesByScenarioId: normalizeNodesByScenarioId(state.nodesByScenarioId, {
      welcomeMessage: state.welcomeMessage,
      fallbackMessage: state.fallbackMessage,
      businessHours: state.businessHours,
    }),
    nodePositionsByScenarioId: normalizeNodePositionsByScenarioId(state.nodePositionsByScenarioId),
    edgesByScenarioId: normalizeEdgesByScenarioId(state.edgesByScenarioId),
  };

  const { welcomeNode, fallbackNode, routerNode, replyNode } = selectRuntimeNodes(normalizedState);
  const baseScenarioRule = getScenarioRule(normalizedState);
  const scenarioTrigger = routerNode?.meta?.trim() || "";
  const scenarioResponseBase = replyNode?.body?.trim() || "";
  const scenarioRule = {
    ...baseScenarioRule,
    triggerText: scenarioTrigger,
    responseText: scenarioResponseBase,
  };
  const status = normalizedState.isBotEnabled ? "ACTIVE" : "PAUSED";

  const ruleRows = [
    {
      name: BUILDER_RULE_NAME,
      description: JSON.stringify(normalizedState),
      triggerText: "__builder__",
      responseText: null,
      isFallback: false,
      priority: 0,
      status,
    },
    {
      name: WELCOME_RULE_NAME,
      description: "Mensaje inicial del bot",
      triggerText: "__welcome__",
      responseText: welcomeNode?.body?.trim() || normalizedState.welcomeMessage,
      isFallback: false,
      priority: 10,
      status,
    },
    {
      name: AFTER_HOURS_RULE_NAME,
      description: normalizedState.businessHours,
      triggerText: "__after_hours__",
      responseText: getAfterHoursMessage(),
      isFallback: false,
      priority: 20,
      status,
    },
    {
      name: scenarioRule.name,
      description: scenarioRule.description,
      triggerText: scenarioRule.triggerText,
      responseText: scenarioRule.responseText,
      isFallback: false,
      priority: 40,
      status,
    },
    {
      name: FALLBACK_RULE_NAME,
      description: "Mensaje de seguridad cuando no hay coincidencias",
      triggerText: "__fallback__",
      responseText:
        normalizedState.fallbackEnabled
          ? fallbackNode?.body?.trim() || normalizedState.fallbackMessage
          : null,
      isFallback: true,
      priority: 999,
      status,
    },
  ].filter((rule) => rule.responseText || rule.name === BUILDER_RULE_NAME);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "OfficialApiAutomationRule"
      WHERE "configId" = ${configId}
    `;

    for (const rule of ruleRows) {
      await tx.$executeRaw`
        INSERT INTO "OfficialApiAutomationRule" (
          "id",
          "configId",
          "name",
          "description",
          "triggerText",
          "responseText",
          "isFallback",
          "priority",
          "status",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${randomUUID()},
          ${configId},
          ${rule.name},
          ${rule.description},
          ${rule.triggerText},
          ${rule.responseText},
          ${rule.isFallback},
          ${rule.priority},
          ${rule.status}::"OfficialApiAutomationRuleStatus",
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `;
    }
  });
}

function parseHour(value: string, meridiem?: string | null) {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  const normalizedMeridiem = (meridiem ?? "").toLowerCase().replace(/[^apm]/g, "");
  if (normalizedMeridiem === "am" || normalizedMeridiem === "pm") {
    if (hours < 1 || hours > 12) {
      return null;
    }

    if (normalizedMeridiem === "am" && hours === 12) {
      hours = 0;
    } else if (normalizedMeridiem === "pm" && hours < 12) {
      hours += 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isOutsideBusinessHours(businessHours: string, at = new Date()) {
  const normalizedHours = normalizeText(businessHours);
  if (normalizedHours.includes("lunes a viernes")) {
    const day = at.getDay();
    if (day === 0 || day === 6) {
      return true;
    }
  }

  const matches = businessHours.match(
    /(\d{1,2}:\d{2})\s*([ap]\.?\s*m\.?)?.*?(\d{1,2}:\d{2})\s*([ap]\.?\s*m\.?)?/i,
  );
  if (!matches) {
    return false;
  }

  const start = parseHour(matches[1], matches[2]);
  const end = parseHour(matches[3], matches[4]);
  if (start === null || end === null) {
    return false;
  }

  const current = at.getHours() * 60 + at.getMinutes();
  if (start === end) {
    return false;
  }

  if (start < end) {
    return current < start || current > end;
  }

  return !(current >= start || current <= end);
}

function extractKeywords(triggerText: string | null) {
  return (triggerText ?? "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

export async function resolveOfficialApiAutomationReply(input: {
  configId: string;
  conversationId: string;
  inboundText: string | null;
}): Promise<string | null> {
  const state = await getOfficialApiChatbotBuilderState(input.configId);
  if (!state.isBotEnabled) {
    return null;
  }

  const rules = await listOfficialApiAutomationRules(input.configId);
  const activeRules = rules.filter((rule) => rule.status === "ACTIVE");
  const normalizedInbound = normalizeText(input.inboundText ?? "");

  const inboundCountRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT COUNT(*) AS "total"
    FROM "OfficialApiMessage"
    WHERE "conversationId" = ${input.conversationId}
      AND "direction" = 'INBOUND'::"OfficialApiMessageDirection"
  `;
  const inboundCount = Number(inboundCountRows[0]?.total ?? 0);

  const welcomeRule = activeRules.find((rule) => rule.name === WELCOME_RULE_NAME);
  const afterHoursRule = activeRules.find((rule) => rule.name === AFTER_HOURS_RULE_NAME);
  const fallbackRule = activeRules.find((rule) => rule.isFallback);
  const { welcomeNode, fallbackNode, replyNode, routerNode } = selectRuntimeNodes(state);
  const directReply = replyNode?.body?.trim() || "";
  const hasRouterKeywords = Boolean(routerNode?.meta?.trim());
  const shouldReplyDirectly = Boolean(directReply) && !hasRouterKeywords;

  if (shouldReplyDirectly) {
    const welcomeText = welcomeNode?.body?.trim() || "";
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${directReply}`
      : directReply;
  }

  const matchedRule = activeRules.find((rule) => {
    if (rule.isFallback || rule.name.startsWith("__")) {
      return false;
    }

    return extractKeywords(rule.triggerText).some((keyword) => normalizedInbound.includes(keyword));
  });

  if (matchedRule?.responseText) {
    const matchedReply = replyNode?.body?.trim() || matchedRule.responseText;
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${matchedReply}`
      : matchedReply;
  }

  if (isOutsideBusinessHours(state.businessHours) && afterHoursRule?.responseText) {
    const afterHoursReply = normalizeAfterHoursReply(afterHoursRule.responseText);
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${afterHoursReply}`
      : afterHoursReply;
  }

  if (fallbackRule?.responseText || fallbackNode?.body?.trim()) {
    const fallbackReply = fallbackNode?.body?.trim() || fallbackRule?.responseText || "";
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${fallbackReply}`
      : fallbackReply;
  }

  return inboundCount <= 1 ? welcomeNode?.body?.trim() || welcomeRule?.responseText || null : null;
}
