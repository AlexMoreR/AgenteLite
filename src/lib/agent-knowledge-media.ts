import { prisma } from "@/lib/prisma";

type AgentKnowledgeMediaProduct = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
};

type AgentKnowledgeImageReply = {
  url: string;
  productName: string;
};

const IMAGE_REQUEST_PATTERNS = [
  /\bfoto\b/i,
  /\bfotos\b/i,
  /\bimagen\b/i,
  /\bimagenes\b/i,
  /\bim[aá]gen\b/i,
  /\bim[aá]genes\b/i,
  /\bver\b/i,
  /\bmuestr(?:a|ame|ame la|amelo)\b/i,
  /\bense(?:n|ñ)a(?:me)?\b/i,
];

const PRODUCT_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "con",
  "para",
  "por",
  "una",
  "uno",
  "unos",
  "unas",
]);

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHttpUrl(value: string | null | undefined) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function isImageRequest(messageText: string) {
  return IMAGE_REQUEST_PATTERNS.some((pattern) => pattern.test(messageText));
}

function scoreProductMatch(messageText: string, productName: string) {
  const normalizedMessage = normalizeText(messageText);
  const normalizedProductName = normalizeText(productName);

  if (!normalizedMessage || !normalizedProductName) {
    return 0;
  }

  if (normalizedMessage.includes(normalizedProductName)) {
    return normalizedProductName.length + 100;
  }

  const tokens = normalizedProductName
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PRODUCT_STOP_WORDS.has(token));

  return tokens.reduce((score, token) => {
    if (!normalizedMessage.includes(token)) {
      return score;
    }

    return score + token.length;
  }, 0);
}

async function listAgentKnowledgeMediaProducts(agentId: string): Promise<AgentKnowledgeMediaProduct[]> {
  return prisma.$queryRaw<AgentKnowledgeMediaProduct[]>`
    SELECT
      p."id",
      p."name",
      p."thumbnailUrl"
    FROM "AgentKnowledgeProduct" akp
    INNER JOIN "Product" p ON p."id" = akp."productId"
    WHERE akp."agentId" = ${agentId}
    ORDER BY akp."createdAt" ASC, p."name" ASC
    LIMIT 30
  `;
}

export async function resolveAgentKnowledgeImageReply(input: {
  agentId: string;
  latestUserMessage: string | null | undefined;
}): Promise<AgentKnowledgeImageReply | null> {
  const latestUserMessage = input.latestUserMessage?.trim() || "";
  if (!latestUserMessage || !isImageRequest(latestUserMessage)) {
    return null;
  }

  const products = (await listAgentKnowledgeMediaProducts(input.agentId)).filter((product) =>
    looksLikeHttpUrl(product.thumbnailUrl),
  );

  if (!products.length) {
    return null;
  }

  const scoredProducts = products
    .map((product) => ({
      product,
      score: scoreProductMatch(latestUserMessage, product.name),
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredProducts[0];
  const selectedProduct =
    bestMatch && bestMatch.score > 0
      ? bestMatch.product
      : products.length === 1
        ? products[0]
        : null;

  if (!selectedProduct?.thumbnailUrl) {
    return null;
  }

  return {
    url: selectedProduct.thumbnailUrl,
    productName: selectedProduct.name,
  };
}
