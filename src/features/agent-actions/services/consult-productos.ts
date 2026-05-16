import { z } from "zod";
import { prisma } from "@/lib/prisma";

type ProductRow = {
  productId: string;
  code: string | null;
  slug: string | null;
  productName: string;
  productDescription: string | null;
  price: string | null;
  categoryName: string | null;
  thumbnailUrl: string | null;
  instructions: string | null;
  followUpFlowId: string | null;
};

export type ConsultProductMatch = {
  productId: string;
  code: string | null;
  slug: string | null;
  name: string;
  description: string | null;
  price: string | null;
  categoryName: string | null;
  thumbnailUrl: string | null;
  instructions: string | null;
  followUpFlowId: string | null;
  score: number;
  confidence: number;
  reason: string;
};

export type ConsultProductResult = {
  query: string;
  found: boolean;
  bestMatch: ConsultProductMatch | null;
  matches: ConsultProductMatch[];
  recommendation: string;
};

const consultProductsToolInputSchema = z
  .object({
    consulta: z.string().trim().min(2, "Escribe la consulta del producto").max(500),
    limite: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export type ConsultarProductosToolInput = z.infer<typeof consultProductsToolInputSchema>;

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
    "producto",
    "productos",
    "catalogo",
    "catlogo",
    "catalog",
    "tiene",
    "tienen",
    "busco",
    "quiero",
    "necesito",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  return trimmed ? normalizeText(trimmed) : "";
}

function getProductScore(input: { query: string; row: ProductRow }) {
  const query = normalizeText(input.query);
  const queryTokens = tokenize(query);
  const name = normalizeOptional(input.row.productName);
  const description = normalizeOptional(input.row.productDescription);
  const category = normalizeOptional(input.row.categoryName);
  const code = normalizeOptional(input.row.code);
  const slug = normalizeOptional(input.row.slug);
  const instructions = normalizeOptional(input.row.instructions);

  let score = 0;
  const reasons: string[] = [];

  if (code && query === code) {
    score += 60;
    reasons.push("Coincidencia exacta por codigo");
  }

  if (slug && query === slug) {
    score += 55;
    reasons.push("Coincidencia exacta por slug");
  }

  if (name && query === name) {
    score += 50;
    reasons.push("Coincidencia exacta por nombre");
  } else if (name && (name.includes(query) || query.includes(name))) {
    score += 32;
    reasons.push("Coincidencia fuerte por nombre");
  }

  if (queryTokens.length > 0) {
    const nameTokens = tokenize(input.row.productName);
    const descriptionTokens = tokenize(input.row.productDescription ?? "");
    const categoryTokens = tokenize(input.row.categoryName ?? "");
    const instructionTokens = tokenize(input.row.instructions ?? "");

    const nameOverlap = nameTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || queryToken.includes(token) || token.includes(queryToken))).length;
    const descriptionOverlap = descriptionTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || queryToken.includes(token) || token.includes(queryToken))).length;
    const categoryOverlap = categoryTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || queryToken.includes(token) || token.includes(queryToken))).length;
    const instructionOverlap = instructionTokens.filter((token) => queryTokens.some((queryToken) => token === queryToken || queryToken.includes(token) || token.includes(queryToken))).length;

    if (nameOverlap > 0) {
      score += nameOverlap * 8;
      reasons.push("Coincidencia parcial por nombre");
    }
    if (descriptionOverlap > 0) {
      score += descriptionOverlap * 3;
      reasons.push("Coincidencia parcial por descripcion");
    }
    if (categoryOverlap > 0) {
      score += categoryOverlap * 2;
      reasons.push("Coincidencia por categoria");
    }
    if (instructionOverlap > 0) {
      score += instructionOverlap * 2;
      reasons.push("Coincidencia por instruccion");
    }
  }

  if (query && description && description.includes(query)) {
    score += 12;
    reasons.push("Coincidencia por descripcion completa");
  }

  if (query && category && category.includes(query)) {
    score += 8;
    reasons.push("Coincidencia por categoria completa");
  }

  if (query && instructions && instructions.includes(query)) {
    score += 8;
    reasons.push("Coincidencia por instruccion completa");
  }

  const confidence = Math.max(0, Math.min(100, score));
  return {
    score,
    confidence,
    reason: reasons[0] ?? "Coincidencia debil",
  };
}

async function fetchAgentKnowledgeProducts(agentId: string) {
  try {
    return await prisma.$queryRaw<ProductRow[]>`
      SELECT
        p."id" AS "productId",
        p."code",
        p."slug",
        p."name" AS "productName",
        p."description" AS "productDescription",
        p."price"::text AS "price",
        c."name" AS "categoryName",
        p."thumbnailUrl",
        akp."instructions",
        akp."followUpFlowId"
      FROM "AgentKnowledgeProduct" akp
      INNER JOIN "Product" p ON p."id" = akp."productId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      WHERE akp."agentId" = ${agentId}
      ORDER BY akp."updatedAt" DESC, akp."createdAt" DESC, p."name" ASC
      LIMIT 60
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('column "followUpFlowId" does not exist') ||
      message.includes('columna "followUpFlowId" no existe') ||
      message.includes("42703")
    ) {
      try {
        return await prisma.$queryRaw<ProductRow[]>`
          SELECT
            p."id" AS "productId",
            p."code",
            p."slug",
            p."name" AS "productName",
            p."description" AS "productDescription",
            p."price"::text AS "price",
            c."name" AS "categoryName",
            p."thumbnailUrl",
            akp."instructions",
            NULL::text AS "followUpFlowId"
          FROM "AgentKnowledgeProduct" akp
          INNER JOIN "Product" p ON p."id" = akp."productId"
          LEFT JOIN "Category" c ON c."id" = p."categoryId"
          WHERE akp."agentId" = ${agentId}
          ORDER BY akp."updatedAt" DESC, akp."createdAt" DESC, p."name" ASC
          LIMIT 60
        `;
      } catch {
        return [];
      }
    }

    return [];
  }
}

export async function consultProductsByAgent(input: {
  agentId: string;
  query: string;
  limit?: number;
}): Promise<ConsultProductResult> {
  const rows = await fetchAgentKnowledgeProducts(input.agentId);
  const query = input.query.trim();
  const limit = Math.max(1, Math.min(5, input.limit ?? 3));

  const matches = rows
    .map((row) => {
      const scored = getProductScore({ query, row });
      return {
        productId: row.productId,
        code: row.code,
        slug: row.slug,
        name: row.productName,
        description: row.productDescription,
        price: row.price,
        categoryName: row.categoryName,
        thumbnailUrl: row.thumbnailUrl,
        instructions: row.instructions,
        followUpFlowId: row.followUpFlowId,
        score: scored.score,
        confidence: scored.confidence,
        reason: scored.reason,
      } satisfies ConsultProductMatch;
    })
    .filter((match) => match.score >= 18)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const bestMatch = matches[0] ?? null;
  return {
    query,
    found: Boolean(bestMatch),
    bestMatch,
    matches,
    recommendation: bestMatch
      ? "Usa el producto encontrado y su instruccion si aplica."
      : "No hay un producto claro. Considera consultar flujos o seguir con una respuesta general.",
  };
}

export function parseConsultarProductosToolInput(value: unknown) {
  const parsed = consultProductsToolInputSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}
