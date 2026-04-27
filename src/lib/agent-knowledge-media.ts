import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/site";

type ConversationLine = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
};

type AgentKnowledgeMediaProduct = {
  code: string | null;
  slug: string;
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  categoryName: string | null;
  thumbnailUrl: string | null;
  instructions: string | null;
};

type AgentKnowledgeImageReply = {
  url: string;
  productName: string;
};

type AgentKnowledgeBaseReply = {
  text: string | null;
  image: {
    url: string;
    caption: string | null;
  } | null;
  productName: string;
};

function buildKnowledgeImageCaption(productName: string) {
  const normalizedName = productName.trim() || "este producto";
  return `Te comparto la foto de ${normalizedName}.`;
}

const IMAGE_REQUEST_PATTERNS = [
  /\bfoto\b/i,
  /\bfotos\b/i,
  /\bimagen\b/i,
  /\bimagenes\b/i,
  /\bmuestr(?:a|ame|ame la|amelo)\b/i,
  /\bensena(?:me)?\b/i,
];

const AFFIRMATIVE_RESPONSE_PATTERNS = [
  /^\s*si\s*[!.]?\s*$/i,
  /^\s*si,\s*$/i,
  /^\s*claro\s*[!.]?\s*$/i,
  /^\s*dale\s*[!.]?\s*$/i,
  /^\s*por favor\s*[!.]?\s*$/i,
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

function resolveKnowledgeImageUrl(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized) {
    return null;
  }

  if (looksLikeHttpUrl(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return getSiteUrl(normalized);
  }

  return null;
}

function isImageRequest(messageText: string) {
  return IMAGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizeText(messageText)));
}

function isAffirmativeResponse(messageText: string) {
  const trimmed = messageText.trim();
  return AFFIRMATIVE_RESPONSE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const KNOWLEDGE_REQUEST_PATTERNS = [
  /\bdetalle(?:s)?\b/i,
  /\binformacion\b/i,
  /\binfo\b/i,
  /\bdescripcion\b/i,
  /\bcaracteristicas?\b/i,
  /\bespecificaciones?\b/i,
  /\bmedidas?\b/i,
  /\bprecio\b/i,
  /\bcosto\b/i,
  /\bvalor\b/i,
  /\bcuanto vale\b/i,
  /\bmas detalles\b/i,
  /\bmas info\b/i,
];

function isKnowledgeFollowUpRequest(messageText: string) {
  return KNOWLEDGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizeText(messageText)));
}

function historyRequestsImage(history: ConversationLine[]) {
  const recentMessages = [...history]
    .map((item) => ({ direction: item.direction, content: item.content?.trim() || "" }))
    .filter((item) => item.content.length > 0)
    .reverse()
    .slice(0, 6);

  const latestOutbound = recentMessages.find((item) => item.direction === "OUTBOUND");
  if (!latestOutbound) {
    return false;
  }

  return IMAGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizeText(latestOutbound.content)));
}

async function listAgentKnowledgeMediaProducts(agentId: string): Promise<AgentKnowledgeMediaProduct[]> {
  return prisma.$queryRaw<AgentKnowledgeMediaProduct[]>`
    SELECT
      p."code",
      p."slug",
      p."id",
      p."name",
      p."description",
      p."price"::text AS "price",
      c."name" AS "categoryName",
      p."thumbnailUrl",
      akp."instructions"
    FROM "AgentKnowledgeProduct" akp
    INNER JOIN "Product" p ON p."id" = akp."productId"
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    WHERE akp."agentId" = ${agentId}
    ORDER BY akp."createdAt" ASC, p."name" ASC
    LIMIT 30
  `;
}

function scoreProductMatch(
  messageText: string,
  product: Pick<AgentKnowledgeMediaProduct, "name" | "description">,
) {
  const normalizedMessage = normalizeText(messageText);
  const normalizedProductName = normalizeText(product.name);

  if (!normalizedMessage || !normalizedProductName) {
    return 0;
  }

  if (normalizedMessage.includes(normalizedProductName)) {
    return normalizedProductName.length + 100;
  }

  const tokens = normalizeText(`${product.name} ${product.description ?? ""}`)
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

function selectBestKnowledgeProduct(latestUserMessage: string, products: AgentKnowledgeMediaProduct[]) {
  const scoredProducts = products
    .map((product) => ({
      product,
      score: scoreProductMatch(latestUserMessage, product),
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredProducts[0];
  return bestMatch && bestMatch.score > 0 ? bestMatch.product : null;
}

function selectProductFromHistory(history: ConversationLine[], products: AgentKnowledgeMediaProduct[]) {
  const historyMessages = [...history]
    .map((item) => item.content?.trim() || "")
    .filter((message) => message.length > 0)
    .reverse();

  for (const message of historyMessages) {
    const selectedProduct = selectBestKnowledgeProduct(message, products);
    if (selectedProduct) {
      return selectedProduct;
    }
  }

  return null;
}

export async function resolveAgentKnowledgeBaseReply(input: {
  agentId: string;
  latestUserMessage: string | null | undefined;
  history?: ConversationLine[];
}): Promise<AgentKnowledgeBaseReply | null> {
  const latestUserMessage = input.latestUserMessage?.trim() || "";
  if (!latestUserMessage) {
    return null;
  }

  const products = (await listAgentKnowledgeMediaProducts(input.agentId))
    .map((product) => {
      const resolvedUrl = resolveKnowledgeImageUrl(product.thumbnailUrl);
      return {
        ...product,
        thumbnailUrl: resolvedUrl,
      };
    });

  if (!products.length) {
    return null;
  }

  const selectedProduct =
    selectBestKnowledgeProduct(latestUserMessage, products) ??
    (isKnowledgeFollowUpRequest(latestUserMessage) && input.history?.length
      ? selectProductFromHistory(input.history, products)
      : isKnowledgeFollowUpRequest(latestUserMessage) && products.length === 1
        ? products[0]
      : null);
  if (!selectedProduct) {
    return null;
  }

  const isPhotoRequest =
    isImageRequest(latestUserMessage) ||
    (isAffirmativeResponse(latestUserMessage) && input.history?.length ? historyRequestsImage(input.history) : false);
  const imageUrl = selectedProduct.thumbnailUrl;

  if (isPhotoRequest && imageUrl) {
    return {
      text: null,
      image: {
        url: imageUrl,
        caption: buildKnowledgeImageCaption(selectedProduct.name),
      },
      productName: selectedProduct.name,
    };
  }

  return null;
}

export async function resolveAgentKnowledgeImageReply(input: {
  agentId: string;
  latestUserMessage: string | null | undefined;
}): Promise<AgentKnowledgeImageReply | null> {
  const latestUserMessage = input.latestUserMessage?.trim() || "";
  if (!latestUserMessage || !isImageRequest(latestUserMessage)) {
    return null;
  }

  const products = (await listAgentKnowledgeMediaProducts(input.agentId))
    .map((product) => {
      const resolvedUrl = resolveKnowledgeImageUrl(product.thumbnailUrl);
      return resolvedUrl
        ? {
            ...product,
            thumbnailUrl: resolvedUrl,
          }
        : null;
    })
    .filter((product): product is AgentKnowledgeMediaProduct & { thumbnailUrl: string } => Boolean(product));

  if (!products.length) {
    return null;
  }

  const selectedProduct = selectBestKnowledgeProduct(latestUserMessage, products) ?? (products.length === 1 ? products[0] : null);

  if (!selectedProduct?.thumbnailUrl) {
    return null;
  }

  return {
    url: selectedProduct.thumbnailUrl,
    productName: selectedProduct.name,
  };
}

export function buildKnowledgeImageReplyText(productName: string) {
  const normalizedName = productName.trim() || "este producto";
  return `Claro, te comparto una foto de ${normalizedName}.`;
}
