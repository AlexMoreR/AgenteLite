import { prisma } from "@/lib/prisma";

import { clienteRespondioLaBienvenida } from "../dominio/sin-respuesta-a-la-bienvenida";

/**
 * Lee el chat y dice si el cliente ya respondió nuestra bienvenida (regla en
 * dominio/sin-respuesta-a-la-bienvenida.ts). La usa el reloj de los seguimientos del V3: con `false`,
 * el seguimiento sale con el texto de la regla del libro tal cual, sin IA.
 *
 * Devuelve `null` si el chat no existe o si falla la lectura: `null` significa seguir como antes (con
 * la IA). Nunca lanza.
 *
 * Lee TODOS los mensajes del chat (solo 3 campos), sin tope: con un `take` de los más nuevos se
 * perdería el primer mensaje nuestro.
 */
export async function elClienteRespondioLaBienvenida(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<boolean | null> {
  try {
    const charla = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { direction: true, type: true, createdAt: true },
        },
      },
    });
    if (!charla) return null;
    return clienteRespondioLaBienvenida(charla.messages);
  } catch (error) {
    console.warn("[seguimientos] no se pudo leer si el cliente respondió la bienvenida; se sigue como antes", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
