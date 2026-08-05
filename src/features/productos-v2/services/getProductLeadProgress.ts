import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProductConversationCondition,
  type ProductMatchRule,
} from "./productConversationFilter";

/**
 * Hasta donde llegaron los leads de un producto, contando mensajes.
 *
 * Reemplaza al conteo por etapa comercial, que no servia: medido contra la base, 920 de 924
 * conversaciones caian en la misma etapa. El clasificador va por listas de palabras y las de
 * "diagnostico" son tan amplias que las pesca a todas — un dato que miente es peor que ninguno.
 *
 * Esto no interpreta nada: cuenta cuantos mensajes mando el cliente. Si mando uno solo, se fue en
 * la puerta; si mando seis, hubo conversacion. Es tosco y es cierto.
 */
export type ProductLeadProgress = {
  murioPrimero: number;
  mandoDos: number;
  converso: number;
  larga: number;
  total: number;
};

const VACIO: ProductLeadProgress = {
  murioPrimero: 0,
  mandoDos: 0,
  converso: 0,
  larga: 0,
  total: 0,
};

export async function getProductLeadProgress(input: {
  workspaceId: string;
  rule: ProductMatchRule;
}): Promise<ProductLeadProgress> {
  try {
    const condicion = buildProductConversationCondition(input.rule);

    // Ultimos 30 dias: el embudo tiene que ser una foto de hoy. Sin ese corte se cuentan
    // conversaciones de hace meses —y como casi nadie cierra los chats (1402 abiertos contra 28
    // cerrados), el numero solo sube y nunca dice nada.
    const filas = await prisma.$queryRaw<Array<{ grupo: string; total: bigint }>>(Prisma.sql`
      SELECT grupo, COUNT(*) AS total
      FROM (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE m.direction = 'INBOUND') <= 1 THEN 'primero'
            WHEN COUNT(*) FILTER (WHERE m.direction = 'INBOUND') = 2 THEN 'dos'
            WHEN COUNT(*) FILTER (WHERE m.direction = 'INBOUND') BETWEEN 3 AND 5 THEN 'converso'
            ELSE 'larga'
          END AS grupo
        FROM "Conversation" c
        JOIN "Message" m ON m."conversationId" = c.id
        WHERE c."workspaceId" = ${input.workspaceId}
          AND c."lastMessageAt" > now() - interval '30 days'
          AND ${condicion}
        GROUP BY c.id
      ) AS avance
      GROUP BY 1
    `);

    const resultado = { ...VACIO };
    for (const fila of filas) {
      const cantidad = Number(fila.total);
      if (fila.grupo === "primero") resultado.murioPrimero += cantidad;
      if (fila.grupo === "dos") resultado.mandoDos += cantidad;
      if (fila.grupo === "converso") resultado.converso += cantidad;
      if (fila.grupo === "larga") resultado.larga += cantidad;
      resultado.total += cantidad;
    }
    return resultado;
  } catch (error) {
    // Informativo: si falla, la pantalla se dibuja sin numeros.
    console.warn("[productos-v2] no se pudo medir el avance de los leads", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...VACIO };
  }
}
