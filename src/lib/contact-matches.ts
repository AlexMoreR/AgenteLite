import { randomUUID } from "crypto";

import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { prisma } from "@/lib/prisma";

export type ContactMatchType = "PRODUCT" | "FLOW";
export type ContactMatchSourceType = "KNOWLEDGE" | "FLOW" | "QUICK_RESPONSE" | "AI";

export type RecordContactMatchInput = {
  workspaceId: string;
  contactId: string;
  contactName?: string | null;
  conversationId?: string | null;
  matchType: ContactMatchType;
  sourceType: ContactMatchSourceType;
  targetName: string;
  targetId?: string | null;
  confidence?: number;
};

export type DetectedContactMatchCandidate = {
  matchType: ContactMatchType;
  sourceType: ContactMatchSourceType;
  targetName: string;
  targetId?: string | null;
  confidence: number;
};

export type ConversationContactMatch = {
  id: string;
  matchType: ContactMatchType;
  sourceType: ContactMatchSourceType;
  targetId: string | null;
  targetName: string;
  targetSlug: string;
  detectedAt: Date;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    "ese",
    "esa",
    "que",
    "como",
    "cuando",
    "hola",
    "me",
    "mi",
    "en",
    "y",
    "o",
    "al",
    "lo",
    "del",
    "sobre",
    "producto",
    "flujo",
    "combo",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !stopWords.has(word));
}

function scoreMatch(input: { text: string; keywords: string[] }) {
  const normalizedText = normalizeText(input.text);
  const textTokens = new Set(tokenize(normalizedText));
  const keywordTokens = tokenize(input.keywords.join(" "));

  if (keywordTokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of keywordTokens) {
    if (normalizedText.includes(token)) {
      score += 2;
      continue;
    }

    for (const textToken of textTokens) {
      if (textToken.includes(token) || token.includes(textToken)) {
        score += 1;
        break;
      }
    }
  }

  return score;
}

async function ensureMatchTag(input: {
  workspaceId: string;
  name: string;
  kind: ContactMatchType;
}) {
  const baseSlug = slugify(input.name);
  const slug = `${input.kind.toLowerCase()}-${baseSlug || "match"}`;
  const color = input.kind === "PRODUCT" ? "#2563eb" : "#7c3aed";

  const existing = await prisma.tag.findFirst({
    where: {
      workspaceId: input.workspaceId,
      slug,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  if (existing) {
    if (existing.name !== input.name || existing.color !== color) {
      await prisma.tag.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          color,
          updatedAt: new Date(),
        },
      });
    }

    return existing;
  }

  return prisma.tag.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug,
      color,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });
}

async function assignTagToContact(input: { workspaceId: string; contactId: string; tagId: string }) {
  await prisma.contactTag.upsert({
    where: {
      contactId_tagId: {
        contactId: input.contactId,
        tagId: input.tagId,
      },
    },
    create: {
      contactId: input.contactId,
      tagId: input.tagId,
      workspaceId: input.workspaceId,
    },
    update: {},
  });
}

function buildDedupeKey(input: RecordContactMatchInput) {
  const conversationPart = input.conversationId?.trim() || "no-conversation";
  const targetPart = slugify(input.targetName) || "match";
  return [conversationPart, input.matchType, input.sourceType, targetPart].join(":");
}

export async function recordContactMatch(input: RecordContactMatchInput) {
  const targetName = input.targetName.trim();
  if (!targetName) {
    return null;
  }

  const tag = await ensureMatchTag({
    workspaceId: input.workspaceId,
    name: targetName,
    kind: input.matchType,
  });

  await assignTagToContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    tagId: tag.id,
  });

  const dedupeKey = buildDedupeKey({
    ...input,
    targetName,
  });

  return prisma.contactMatch.upsert({
    where: {
      workspaceId_dedupeKey: {
        workspaceId: input.workspaceId,
        dedupeKey,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      tagId: tag.id,
      matchType: input.matchType,
      sourceType: input.sourceType,
      targetId: input.targetId ?? null,
      targetName,
      targetSlug: slugify(targetName) || "match",
      dedupeKey,
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence ?? 100))),
      detectedAt: new Date(),
    },
    update: {
      conversationId: input.conversationId ?? null,
      tagId: tag.id,
      targetId: input.targetId ?? null,
      targetName,
      targetSlug: slugify(targetName) || "match",
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence ?? 100))),
      detectedAt: new Date(),
      updatedAt: new Date(),
    },
    select: {
      id: true,
      targetName: true,
      matchType: true,
      sourceType: true,
      detectedAt: true,
      tag: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
    },
  });
}

export async function getLatestConversationMatch(input: {
  workspaceId: string;
  conversationId: string;
  matchType?: ContactMatchType;
}): Promise<ConversationContactMatch | null> {
  const match = await prisma.contactMatch.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      ...(input.matchType ? { matchType: input.matchType } : {}),
    },
    orderBy: [
      { detectedAt: "desc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      matchType: true,
      sourceType: true,
      targetId: true,
      targetName: true,
      targetSlug: true,
      detectedAt: true,
    },
  });

  return match ?? null;
}

export function buildConversationMatchContextNote(match: ConversationContactMatch) {
  const targetName = match.targetName.trim();
  if (!targetName) {
    return null;
  }

  return `El cliente ya mostro interes en "${targetName}". Mantén ese hilo activo y no cambies de tema sin una señal clara.`;
}

export async function detectContactMatchesFromText(input: {
  agentId: string;
  workspaceId: string;
  messageText: string;
  includeOfficialApi: boolean;
}): Promise<DetectedContactMatchCandidate[]> {
  const messageText = input.messageText.trim();
  if (!messageText) {
    return [];
  }

  const [knowledgeRows, flowItems] = await Promise.all([
    prisma.$queryRaw<Array<{
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
      ORDER BY akp."updatedAt" DESC, akp."createdAt" DESC
    `,
    getCreatedFlowItems({
      workspaceId: input.workspaceId,
      includeOfficialApi: input.includeOfficialApi,
    }),
  ]);

  const candidates: DetectedContactMatchCandidate[] = [];

  let bestProduct: DetectedContactMatchCandidate | null = null;
  let bestProductScore = 0;
  for (const row of knowledgeRows) {
    const score = scoreMatch({
      text: messageText,
      keywords: [row.productName, row.productDescription ?? "", row.instructions ?? ""],
    });

    if (score >= 2 && score > bestProductScore) {
      bestProductScore = score;
      bestProduct = {
        matchType: "PRODUCT",
        sourceType: "KNOWLEDGE",
        targetName: row.productName,
        targetId: row.productId,
        confidence: Math.min(100, score * 20),
      };
    }
  }

  if (bestProduct) {
    candidates.push(bestProduct);
  }

  let bestFlow: DetectedContactMatchCandidate | null = null;
  let bestFlowScore = 0;
  for (const flow of flowItems) {
    const score = scoreMatch({
      text: messageText,
      keywords: [flow.title, flow.intent, flow.description],
    });

    if (score >= 2 && score > bestFlowScore) {
      bestFlowScore = score;
      bestFlow = {
        matchType: "FLOW",
        sourceType: flow.sourceType === "official-api" ? "QUICK_RESPONSE" : "FLOW",
        targetName: flow.title,
        targetId: flow.id,
        confidence: Math.min(100, score * 20),
      };
    }
  }

  if (bestFlow) {
    candidates.push(bestFlow);
  }

  return candidates;
}
