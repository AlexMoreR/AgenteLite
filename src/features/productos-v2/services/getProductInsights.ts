import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProductConversationCondition,
  type ProductMatchRule,
} from "./productConversationFilter";

/**
 * El resumen de lo que la IA leyo en las conversaciones de un producto.
 *
 * Es la respuesta a "por que se caen", que hasta ahora solo se podia contestar abriendo chats de a
 * uno. Con esto la pantalla dice "14 se cayeron por envio" y recien ahi tiene sentido ir a leer
 * esos 14.
 */
export type ProductInsightSummary = {
  leidas: number;
  pendientes: number;
  porMotivo: Array<{ motivo: string; cantidad: number }>;
  /** La ultima frase que mandamos antes del silencio, agrupada. Es la que hay que corregir. */
  porUltimaFrase: Array<{ frase: string; cantidad: number }>;
  ejemplos: Array<{ conversationId: string; summary: string; motivo: string | null }>;
};

export async function getProductInsights(input: {
  workspaceId: string;
  rule: ProductMatchRule;
}): Promise<ProductInsightSummary> {
  const productId = input.rule.productId;
  const condicion = buildProductConversationCondition(input.rule);
  const vacio: ProductInsightSummary = {
    leidas: 0,
    pendientes: 0,
    porMotivo: [],
    porUltimaFrase: [],
    ejemplos: [],
  };

  try {
    const [porMotivo, leidas, pendientesRow, ejemplos, porFrase] = await Promise.all([
      prisma.conversationInsight.groupBy({
        by: ["lostReason"],
        where: {
          workspaceId: input.workspaceId,
          productId,
          status: "MUERTO",
          lostReason: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.conversationInsight.count({
        where: { workspaceId: input.workspaceId, productId },
      }),
      // Cuantas faltan por leer: las de los ultimos 30 dias que no tienen lectura o crecieron.
      prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total FROM (
          SELECT c.id
          FROM "Conversation" c
          JOIN "Message" m ON m."conversationId" = c.id
          LEFT JOIN "ConversationInsight" i ON i."conversationId" = c.id
          WHERE c."workspaceId" = ${input.workspaceId}
            AND c."lastMessageAt" > now() - interval '30 days'
            AND ${condicion}
          GROUP BY c.id, i."messageCount"
          HAVING i."messageCount" IS NULL OR i."messageCount" < COUNT(m.id)
        ) AS pendientes
      `),
      prisma.conversationInsight.findMany({
        where: {
          workspaceId: input.workspaceId,
          productId,
          status: "MUERTO",
          summary: { not: null },
        },
        orderBy: { analyzedAt: "desc" },
        take: 5,
        select: { conversationId: true, summary: true, lostReason: true },
      }),
      /**
       * Que dijimos justo antes de que se callaran, agrupado.
       *
       * Es el dato mas accionable de todos: si la misma frase aparece cuarenta veces como ultima,
       * ahi esta la fuga y hay una sola cosa que corregir. La firma se saca (primera linea con
       * asteriscos) para que el mismo mensaje de dos asesoras distintas cuente junto.
       */
      prisma.$queryRaw<Array<{ frase: string; total: bigint }>>(Prisma.sql`
        SELECT
          left(regexp_replace("lastOutbound", '^[^\n]*\*[^\n]*\n', ''), 90) AS frase,
          COUNT(*) AS total
        FROM "ConversationInsight"
        WHERE "workspaceId" = ${input.workspaceId}
          AND "productId" = ${productId}
          AND status = 'MUERTO'
          AND "lastOutbound" IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 5
      `),
    ]);

    return {
      leidas,
      pendientes: Number(pendientesRow[0]?.total ?? 0),
      porMotivo: porMotivo
        .map((fila) => ({ motivo: fila.lostReason ?? "otro", cantidad: fila._count._all }))
        .sort((a, b) => b.cantidad - a.cantidad),
      porUltimaFrase: porFrase
        .map((fila) => ({ frase: fila.frase?.replace(/\s+/g, " ").trim() ?? "", cantidad: Number(fila.total) }))
        .filter((fila) => fila.frase.length > 0),
      ejemplos: ejemplos.map((fila) => ({
        conversationId: fila.conversationId,
        summary: fila.summary ?? "",
        motivo: fila.lostReason,
      })),
    };
  } catch (error) {
    // Si la tabla todavia no existe (despliegue a medio camino), la pantalla se dibuja igual.
    console.warn("[productos-v2] no se pudieron leer los insights", {
      error: error instanceof Error ? error.message : String(error),
    });
    return vacio;
  }
}
