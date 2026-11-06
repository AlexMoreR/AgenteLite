import { leerEstado } from "@/features/agente-v3/motor/estado";
import { mensajeDeCierre } from "@/features/listo-para-pagar/dominio/senal";
import { prisma } from "@/lib/prisma";

/**
 * El mensaje de cierre con el 50 % del producto que el cliente está mirando (el `productoActivo`
 * del estado del V3). Si no hay producto o algo falla, sale el mensaje sin cifra. Nunca lanza.
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
