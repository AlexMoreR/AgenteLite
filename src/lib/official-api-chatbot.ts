import type { OfficialApiChatbotBuilderNode } from "@/features/official-api/types/official-api";
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
  nodes: OfficialApiChatbotBuilderNode[];
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
      meta: `precio, cotizar, soporte | ${input.businessHours}`,
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
  businessHours: "Lunes a viernes | 8:00 a. m. a 6:00 p. m.",
  captureLeadEnabled: true,
  handoffEnabled: true,
  fallbackEnabled: true,
  selectedScenarioId: "new-lead",
  nodes: getDefaultBuilderNodes({
    welcomeMessage:
      "Hola. Soy el asistente automatico de WhatsApp. Cuentame si necesitas ventas, soporte, catalogo o hablar con un asesor.",
    fallbackMessage:
      "Todavia no tengo una respuesta segura para eso. Si quieres, te conecto con un asesor y dejo tu caso priorizado.",
    businessHours: "Lunes a viernes | 8:00 a. m. a 6:00 p. m.",
  }),
};

const scenarioConfig = {
  "new-lead": {
    ruleName: "intent_new_lead",
    keywords: ["precio", "valor", "costo", "cotizar", "cotizacion", "comprar", "informacion", "info"],
    response:
      "Te ayudo con ventas. Dime que producto te interesa y en que ciudad estas para compartirte la mejor opcion.",
  },
  support: {
    ruleName: "intent_support",
    keywords: ["soporte", "pedido", "estado", "ayuda", "garantia", "entrega", "envio"],
    response:
      "Te ayudo con soporte. Comparte tu numero de pedido o tu nombre completo para ubicar la solicitud.",
  },
  "after-hours": {
    ruleName: "intent_after_hours",
    keywords: ["horario", "atienden", "disponible", "cotizar", "asesor"],
    response:
      "En este momento estamos fuera de horario. Si quieres, deja nombre, producto y ciudad y te contactamos primero en el siguiente turno.",
  },
} as const;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function appendFlowNotes(base: string, state: OfficialApiChatbotBuilderState) {
  const notes: string[] = [];

  if (state.captureLeadEnabled) {
    notes.push("Antes de cerrar, pide nombre, ciudad y producto.");
  }

  if (state.handoffEnabled) {
    notes.push("Si el usuario quiere avanzar, deriva a un asesor humano.");
  }

  if (notes.length === 0) {
    return base;
  }

  return `${base}\n\n${notes.join(" ")}`;
}

function getAfterHoursMessage(state: OfficialApiChatbotBuilderState) {
  return `Nuestro horario es ${state.businessHours}. Si quieres, deja nombre, producto y ciudad y te contactamos en el siguiente turno.`;
}

function getScenarioRule(state: OfficialApiChatbotBuilderState) {
  const selectedScenario =
    scenarioConfig[state.selectedScenarioId as keyof typeof scenarioConfig] ?? scenarioConfig["new-lead"];

  return {
    name: selectedScenario.ruleName,
    triggerText: selectedScenario.keywords.join(", "),
    responseText: appendFlowNotes(selectedScenario.response, state),
    description: `Escenario visual seleccionado: ${state.selectedScenarioId}`,
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
      nodes: Array.isArray(parsed.nodes) && parsed.nodes.length > 0
        ? parsed.nodes
        : getDefaultBuilderNodes({
            welcomeMessage: parsed.welcomeMessage || defaultBuilderState.welcomeMessage,
            fallbackMessage: parsed.fallbackMessage || defaultBuilderState.fallbackMessage,
            businessHours: parsed.businessHours || defaultBuilderState.businessHours,
          }),
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
    nodes:
      Array.isArray(state.nodes) && state.nodes.length > 0
        ? state.nodes.map((node) => ({
            id: node.id.trim() || randomUUID(),
            kind: node.kind,
            title: node.title.trim() || "Bloque",
            body: node.body.trim(),
            meta: node.meta.trim(),
          }))
        : getDefaultBuilderNodes({
            welcomeMessage: state.welcomeMessage,
            fallbackMessage: state.fallbackMessage,
            businessHours: state.businessHours,
          }),
  };

  const welcomeNode = normalizedState.nodes.find((node) => node.id === "welcome" || node.title.toLowerCase().includes("bienvenida"));
  const fallbackNode = normalizedState.nodes.find((node) => node.id === "fallback" || node.title.toLowerCase().includes("fallback"));
  const routerNode = normalizedState.nodes.find((node) => node.kind === "condition");
  const replyNode =
    normalizedState.nodes.find((node) => node.id === "reply") ??
    normalizedState.nodes.find((node) => node.kind === "message" && node.id !== "welcome" && node.id !== "fallback");

  const scenarioRule = {
    ...getScenarioRule(normalizedState),
    triggerText: routerNode?.meta?.trim() || getScenarioRule(normalizedState).triggerText,
    responseText: appendFlowNotes(replyNode?.body?.trim() || getScenarioRule(normalizedState).responseText, normalizedState),
  };
  const status = normalizedState.isBotEnabled ? "ACTIVE" : "PAUSED";

  await prisma.$executeRaw`
    DELETE FROM "OfficialApiAutomationRule"
    WHERE "configId" = ${configId}
  `;

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
      responseText: getAfterHoursMessage(normalizedState),
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
          ? appendFlowNotes(fallbackNode?.body?.trim() || normalizedState.fallbackMessage, normalizedState)
          : null,
      isFallback: true,
      priority: 999,
      status,
    },
  ].filter((rule) => rule.responseText || rule.name === BUILDER_RULE_NAME);

  for (const rule of ruleRows) {
    await prisma.$executeRaw`
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
}

function parseHour(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isOutsideBusinessHours(businessHours: string, at = new Date()) {
  const matches = businessHours.match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/);
  if (!matches) {
    return false;
  }

  const start = parseHour(matches[1]);
  const end = parseHour(matches[2]);
  if (start === null || end === null) {
    return false;
  }

  const current = at.getHours() * 60 + at.getMinutes();
  return current < start || current > end;
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
  const welcomeNode = state.nodes.find((node) => node.id === "welcome" || node.title.toLowerCase().includes("bienvenida"));
  const fallbackNode = state.nodes.find((node) => node.id === "fallback" || node.title.toLowerCase().includes("fallback"));
  const replyNode =
    state.nodes.find((node) => node.id === "reply") ??
    state.nodes.find((node) => node.kind === "message" && node.id !== "welcome" && node.id !== "fallback");
  const captureNode = state.nodes.find((node) => node.id === "capture" || node.kind === "input");
  const handoffNode = state.nodes.find((node) => node.id === "handoff" || node.kind === "action");

  const appendNodeNotes = (base: string | null) => {
    const parts = [base?.trim() || ""].filter(Boolean);
    if (state.captureLeadEnabled && captureNode?.body?.trim()) {
      parts.push(captureNode.body.trim());
    }
    if (state.handoffEnabled && handoffNode?.body?.trim()) {
      parts.push(handoffNode.body.trim());
    }
    return parts.join("\n\n");
  };

  if (isOutsideBusinessHours(state.businessHours) && afterHoursRule?.responseText) {
    const afterHoursReply = appendNodeNotes(afterHoursRule.responseText);
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${afterHoursReply}`
      : afterHoursReply;
  }

  const matchedRule = activeRules.find((rule) => {
    if (rule.isFallback || rule.name.startsWith("__")) {
      return false;
    }

    return extractKeywords(rule.triggerText).some((keyword) => normalizedInbound.includes(keyword));
  });

  if (matchedRule?.responseText) {
    const matchedReply = appendNodeNotes(replyNode?.body?.trim() || matchedRule.responseText);
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${matchedReply}`
      : matchedReply;
  }

  if (fallbackRule?.responseText || fallbackNode?.body?.trim()) {
    const fallbackReply = appendNodeNotes(fallbackNode?.body?.trim() || fallbackRule?.responseText || null);
    const welcomeText = welcomeNode?.body?.trim() || welcomeRule?.responseText;
    return inboundCount <= 1 && welcomeText
      ? `${welcomeText}\n\n${fallbackReply}`
      : fallbackReply;
  }

  return inboundCount <= 1 ? welcomeNode?.body?.trim() || welcomeRule?.responseText || null : null;
}
