import { prisma } from "@/lib/prisma";
import { normalizeAdText } from "@/lib/ad-campaign-routing";

/**
 * Etiquetar un lead con su producto apenas entra, sin esperar al agente.
 *
 * La etiqueta del producto la ponia el agente al reconocerlo respondiendo. Cuando una asesora toma
 * el chat, la IA queda en pausa y el agente nunca corre: ese lead se queda sin etiqueta y despues
 * no aparece en ningun conteo del producto. Medido en produccion, eso era casi la mitad de las
 * conversaciones recientes.
 *
 * Aca se usa la MISMA regla que el producto ya declara para reconocerse (palabras del cliente y
 * anuncios de origen), asi que hay un solo lugar donde se define que es "de este producto".
 */

export type ProductoReconocido = { productId: string; productName: string };

/**
 * Contra que texto se compara: lo que escribio el cliente y el titulo del anuncio del que vino.
 * Se normaliza igual que las reglas de campana (sin tildes, sin emojis) para que "Estéticas"
 * encuentre "estetica".
 */
export async function reconocerProductoDelLead(input: {
  workspaceId: string;
  messageText: string;
  adTitle: string;
}): Promise<ProductoReconocido | null> {
  const texto = normalizeAdText(input.messageText || "");
  const anuncio = normalizeAdText(input.adTitle || "");
  if (!texto && !anuncio) {
    return null;
  }

  const reglas = await prisma.productPlaybook.findMany({
    where: { workspaceId: input.workspaceId },
    select: {
      productId: true,
      matchKeywords: true,
      matchAdTitles: true,
      product: { select: { name: true } },
    },
  });

  for (const regla of reglas) {
    const porPalabra = (regla.matchKeywords ?? []).some((palabra) => {
      const limpia = normalizeAdText(palabra);
      return limpia.length >= 3 && texto.includes(limpia);
    });
    const porAnuncio = (regla.matchAdTitles ?? []).some((titulo) => {
      const limpio = normalizeAdText(titulo);
      return limpio.length >= 3 && anuncio.includes(limpio);
    });

    if (porPalabra || porAnuncio) {
      return { productId: regla.productId, productName: regla.product.name };
    }
  }

  return null;
}
