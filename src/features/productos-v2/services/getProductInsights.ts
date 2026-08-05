import { prisma } from "@/lib/prisma";

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
  ejemplos: Array<{ conversationId: string; summary: string; motivo: string | null }>;
};

export async function getProductInsights(input: {
  workspaceId: string;
  productId: string;
}): Promise<ProductInsightSummary> {
  const vacio: ProductInsightSummary = { leidas: 0, pendientes: 0, porMotivo: [], ejemplos: [] };

  try {
    const [porMotivo, leidas, pendientesRow, ejemplos] = await Promise.all([
      prisma.conversationInsight.groupBy({
        by: ["lostReason"],
        where: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          status: "MUERTO",
          lostReason: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.conversationInsight.count({
        where: { workspaceId: input.workspaceId, productId: input.productId },
      }),
      // Cuantas faltan por leer: las de los ultimos 30 dias que no tienen lectura o crecieron.
      prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM (
          SELECT c.id
          FROM "Conversation" c
          JOIN "Message" m ON m."conversationId" = c.id
          LEFT JOIN "ConversationInsight" i ON i."conversationId" = c.id
          WHERE c."workspaceId" = ${input.workspaceId}
            AND c."activeProductContext"->>'productId' = ${input.productId}
            AND c."lastMessageAt" > now() - interval '30 days'
          GROUP BY c.id, i."messageCount"
          HAVING i."messageCount" IS NULL OR i."messageCount" < COUNT(m.id)
        ) AS pendientes
      `,
      prisma.conversationInsight.findMany({
        where: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          status: "MUERTO",
          summary: { not: null },
        },
        orderBy: { analyzedAt: "desc" },
        take: 5,
        select: { conversationId: true, summary: true, lostReason: true },
      }),
    ]);

    return {
      leidas,
      pendientes: Number(pendientesRow[0]?.total ?? 0),
      porMotivo: porMotivo
        .map((fila) => ({ motivo: fila.lostReason ?? "otro", cantidad: fila._count._all }))
        .sort((a, b) => b.cantidad - a.cantidad),
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
