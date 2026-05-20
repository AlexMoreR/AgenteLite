import { z } from "zod";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";

type ConsultFlowItem = {
  id: string;
  sourceType: "official-api" | "evolution";
  sourceLabel: string;
  title: string;
  intent: string;
  description: string;
  badge: string;
  flowType: "ia" | "chatbot";
  matchType: "exacta" | "contiene";
  keywords: string[];
  isChildFlow: boolean;
};

export type ConsultFlowMatch = {
  flowId: string;
  sourceType: "official-api" | "evolution";
  sourceLabel: string;
  title: string;
  intent: string;
  description: string;
  score: number;
  confidence: number;
  reason: string;
};

export type ConsultFlowResult = {
  query: string;
  found: boolean;
  bestMatch: ConsultFlowMatch | null;
  matches: ConsultFlowMatch[];
  recommendation: string;
};

const consultFlowsToolInputSchema = z
  .object({
    consulta: z.string().trim().min(2, "Escribe la consulta del flujo").max(500),
    limite: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export type ConsultarFlujosToolInput = z.infer<typeof consultFlowsToolInputSchema>;

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

function includesNormalized(haystack: string, needle: string) {
  return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
}

function scoreFlow(query: string, flow: ConsultFlowItem) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const title = normalizeText(flow.title);
  const intent = normalizeText(flow.intent);
  const description = normalizeText(flow.description);
  const keywords = flow.keywords.map((keyword) => normalizeText(keyword)).filter(Boolean);

  let score = 0;
  const reasons: string[] = [];

  if (flow.flowType === "chatbot") {
    if (keywords.length === 0) {
      return {
        score: 0,
        confidence: 0,
        reason: "Sin palabras clave",
      };
    }

    const exactKeywordMatch = keywords.some((keyword) => normalizedQuery === keyword);
    const containsKeywordMatch = keywords.some((keyword) => includesNormalized(normalizedQuery, keyword));
    const keywordMatch = flow.matchType === "contiene" ? containsKeywordMatch : exactKeywordMatch;

    if (!keywordMatch) {
      return {
        score: 0,
        confidence: 0,
        reason: "Sin coincidencia por palabras clave",
      };
    }

    const matchedKeywords = keywords.filter((keyword) =>
      flow.matchType === "contiene" ? includesNormalized(normalizedQuery, keyword) : normalizedQuery === keyword,
    );

    score += Math.max(50, matchedKeywords.length * 15);
    reasons.push(flow.matchType === "contiene" ? "Coincidencia por palabras clave" : "Coincidencia exacta por palabras clave");

    const confidence = Math.max(0, Math.min(100, score));
    return {
      score,
      confidence,
      reason: reasons[0] ?? "Coincidencia debil",
    };
  }

  if (title && normalizedQuery === title) {
    score += 55;
    reasons.push("Coincidencia exacta por titulo");
  } else if (title && (title.includes(normalizedQuery) || normalizedQuery.includes(title))) {
    score += 35;
    reasons.push("Coincidencia fuerte por titulo");
  }

  if (intent && normalizedQuery === intent) {
    score += 50;
    reasons.push("Coincidencia exacta por intencion");
  } else if (intent && (intent.includes(normalizedQuery) || normalizedQuery.includes(intent))) {
    score += 28;
    reasons.push("Coincidencia fuerte por intencion");
  }

  if (queryTokens.length > 0) {
    const titleTokens = tokenize(flow.title);
    const intentTokens = tokenize(flow.intent);
    const descriptionTokens = tokenize(flow.description);
    const titleOverlap = titleTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))).length;
    const intentOverlap = intentTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))).length;
    const descriptionOverlap = descriptionTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))).length;

    if (titleOverlap > 0) {
      score += titleOverlap * 8;
      reasons.push("Coincidencia parcial por titulo");
    }
    if (intentOverlap > 0) {
      score += intentOverlap * 7;
      reasons.push("Coincidencia parcial por intencion");
    }
    if (descriptionOverlap > 0) {
      score += descriptionOverlap * 3;
      reasons.push("Coincidencia parcial por descripcion");
    }
  }

  if (description && normalizedQuery.includes(description)) {
    score += 10;
    reasons.push("Coincidencia completa por descripcion");
  }

  const confidence = Math.max(0, Math.min(100, score));
  return {
    score,
    confidence,
    reason: reasons[0] ?? "Coincidencia debil",
  };
}

function toConsultFlowItem(flow: Awaited<ReturnType<typeof getCreatedFlowItems>>[number]): ConsultFlowItem {
  return {
    id: flow.id,
    sourceType: flow.sourceType,
    sourceLabel: flow.badge === "Meta" ? "API oficial" : "API no oficial",
    title: flow.title,
    intent: flow.intent,
    description: flow.description,
    badge: flow.badge,
    flowType: flow.flowType,
    matchType: flow.matchType,
    keywords: flow.keywords,
    isChildFlow: flow.isChildFlow,
  };
}

export async function consultFlowsByWorkspace(input: {
  workspaceId: string;
  includeOfficialApi: boolean;
  query: string;
  limit?: number;
  allowedFlowIds?: string[];
}): Promise<ConsultFlowResult> {
  const flowItems = await getCreatedFlowItems({
    workspaceId: input.workspaceId,
    includeOfficialApi: input.includeOfficialApi,
  });

  const allowedFlowIds = input.allowedFlowIds?.filter(Boolean);
  const candidateFlows =
    allowedFlowIds && allowedFlowIds.length > 0
      ? flowItems.filter((flow) => allowedFlowIds.includes(flow.id))
      : flowItems;

  const limit = Math.max(1, Math.min(5, input.limit ?? 3));
  const query = input.query.trim();

  const matches = candidateFlows
    .map((flow) => {
      const consultFlow = toConsultFlowItem(flow);
      if (consultFlow.isChildFlow) {
        return null;
      }
      const scored = scoreFlow(query, consultFlow);
      return {
        flowId: consultFlow.id,
        sourceType: consultFlow.sourceType,
        sourceLabel: consultFlow.sourceLabel,
        title: consultFlow.title,
        intent: consultFlow.intent,
        description: consultFlow.description,
        score: scored.score,
        confidence: scored.confidence,
        reason: scored.reason,
      } satisfies ConsultFlowMatch;
    })
    .filter((match): match is ConsultFlowMatch => Boolean(match))
    .filter((match) => match.score >= 16)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const bestMatch = matches[0] ?? null;
  return {
    query,
    found: Boolean(bestMatch),
    bestMatch,
    matches,
    recommendation: bestMatch
      ? "Usa el flujo encontrado o ejecuta su respuesta automatica."
      : "No hay un flujo claro. Sigue con el agente normal o escala si corresponde.",
  };
}

export function parseConsultarFlujosToolInput(value: unknown) {
  const parsed = consultFlowsToolInputSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}
