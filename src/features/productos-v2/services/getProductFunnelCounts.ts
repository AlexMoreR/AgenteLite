import { prisma } from "@/lib/prisma";
import type { ProductFunnelStageKey } from "@/lib/product-funnel-stages";

/**
 * Cuantos leads de un producto estan parados en cada etapa del embudo.
 *
 * El dato ya existia y no lo estabamos mirando: cada conversacion guarda su etapa comercial y el
 * producto del que se esta hablando. Aca solo se cruzan las dos cosas.
 *
 * El motor trabaja con siete etapas y el embudo del producto tiene cinco, asi que se agrupan:
 * averiguar y diagnosticar son las dos mitades de "identificar", y la posventa ya no es parte de
 * la venta. Sin ese agrupamiento el conteo no se podria leer al lado del embudo.
 */
const ETAPA_DEL_MOTOR: Record<string, ProductFunnelStageKey> = {
  CONEXION: "PRESENTACION",
  AVERIGUACION: "IDENTIFICACION",
  DIAGNOSTICO: "IDENTIFICACION",
  EXPOSICION: "PRODUCTO",
  NEGOCIACION: "OBJECIONES",
  ACUERDO: "CIERRE",
};

export type ProductFunnelCounts = Record<string, number>;

export async function getProductFunnelCounts(input: {
  workspaceId: string;
  productIds: string[];
}): Promise<Map<string, ProductFunnelCounts>> {
  const porProducto = new Map<string, ProductFunnelCounts>();
  if (input.productIds.length === 0) {
    return porProducto;
  }

  try {
    // Solo conversaciones VIVAS: en una cerrada el lead ya no esta "parado" en ninguna etapa, y
    // contarlas convertiria el embudo en un historico en vez de en una foto de hoy.
    const filas = await prisma.$queryRaw<Array<{ productId: string; stage: string | null; total: bigint }>>`
      SELECT
        "activeProductContext"->>'productId' AS "productId",
        "commercialContext"->>'currentStage' AS "stage",
        COUNT(*) AS total
      FROM "Conversation"
      WHERE "workspaceId" = ${input.workspaceId}
        AND "status" IN ('OPEN', 'PENDING')
        AND "activeProductContext"->>'productId' = ANY(${input.productIds})
      GROUP BY 1, 2
    `;

    for (const fila of filas) {
      if (!fila.productId) {
        continue;
      }
      const etapa = fila.stage ? ETAPA_DEL_MOTOR[fila.stage] : undefined;
      if (!etapa) {
        continue;
      }
      const actual = porProducto.get(fila.productId) ?? {};
      actual[etapa] = (actual[etapa] ?? 0) + Number(fila.total);
      porProducto.set(fila.productId, actual);
    }
  } catch (error) {
    // El conteo es informativo: si falla, la pantalla se dibuja igual sin numeros.
    console.warn("[productos-v2] no se pudo contar el embudo", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return porProducto;
}
