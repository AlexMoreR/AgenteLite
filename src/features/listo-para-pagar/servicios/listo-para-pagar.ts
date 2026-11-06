import { leerEstado } from "@/features/agente-v3/motor/estado";
import { prisma } from "@/lib/prisma";

import { mensajeDeCierre } from "../dominio/senal";

/**
 * El mensaje de cierre para el producto del que se está hablando en el chat.
 *
 * El producto sale del estado del V3 (`productoActivo` es el id del producto). Si no hay producto,
 * no es de este negocio, o algo falla, va el mensaje sin cifra: nunca lanza, porque el aviso a la
 * asesora no puede caerse por esto.
 */
export async function leerMensajeDeCierre(workspaceId: string, conversationId: string): Promise<string> {
  try {
    const estado = await leerEstado(conversationId);
    if (!estado.productoActivo) {
      return mensajeDeCierre(null);
    }
    const producto = await prisma.product.findFirst({
      where: { id: estado.productoActivo, workspaceId },
      select: { price: true },
    });
    return mensajeDeCierre(producto ? Number(producto.price) : null);
  } catch {
    return mensajeDeCierre(null);
  }
}
