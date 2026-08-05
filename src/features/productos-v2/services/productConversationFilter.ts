import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Que conversaciones son de un producto.
 *
 * La primera version miraba solo `activeProductContext`, que lo escribe el agente al reconocer el
 * producto. Medido contra produccion, eso dejaba afuera casi la mitad: 178 de 371 conversaciones
 * recientes no lo tenian, y son justo las que atiende una persona —con la IA en pausa, el agente
 * nunca corre y nadie marca nada—, que suelen ser las mas avanzadas.
 *
 * Ahora el producto declara COMO se reconoce (palabras del cliente y anuncios de origen) y eso vale
 * aunque el agente no haya intervenido nunca.
 */
export type ProductMatchRule = {
  productId: string;
  keywords: string[];
  adTitles: string[];
};

export async function getProductMatchRule(input: {
  workspaceId: string;
  productId: string;
}): Promise<ProductMatchRule> {
  try {
    const fila = await prisma.productPlaybook.findUnique({
      where: {
        workspaceId_productId: { workspaceId: input.workspaceId, productId: input.productId },
      },
      select: { matchKeywords: true, matchAdTitles: true },
    });
    return {
      productId: input.productId,
      keywords: (fila?.matchKeywords ?? []).map((valor) => valor.trim()).filter(Boolean),
      adTitles: (fila?.matchAdTitles ?? []).map((valor) => valor.trim()).filter(Boolean),
    };
  } catch {
    return { productId: input.productId, keywords: [], adTitles: [] };
  }
}

/**
 * La condicion SQL que decide si una conversacion `c` es de este producto.
 *
 * Tres caminos, cualquiera alcanza: lo marco el agente, el cliente uso una palabra del producto, o
 * llego por uno de sus anuncios. El origen se lee del contacto, donde ya se guarda de que anuncio
 * vino (captura F0).
 */
export function buildProductConversationCondition(regla: ProductMatchRule): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`c."activeProductContext"->>'productId' = ${regla.productId}`,
  ];

  if (regla.keywords.length > 0) {
    const patrones = regla.keywords.map((palabra) => `%${palabra}%`);
    partes.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "Message" mk
        WHERE mk."conversationId" = c.id
          AND mk.direction = 'INBOUND'
          AND mk.content ILIKE ANY(${patrones})
      )`,
    );
  }

  if (regla.adTitles.length > 0) {
    const patrones = regla.adTitles.map((titulo) => `%${titulo}%`);
    partes.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "Contact" ct
        WHERE ct.id = c."contactId"
          AND ct.metadata->>'adTitle' ILIKE ANY(${patrones})
      )`,
    );
  }

  return Prisma.sql`(${Prisma.join(partes, " OR ")})`;
}
