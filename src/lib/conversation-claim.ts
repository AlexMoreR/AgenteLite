import { auth } from "@/auth";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";

/**
 * La asesora que contesta un chat sin dueño se queda con ese lead.
 *
 * El dueño solo se decidia al ENTRAR el lead, por rotacion entre los colaboradores del canal.
 * Los que entraron antes de que esa lista existiera quedaron sin dueño para siempre: mas de mil.
 * Y como "Mi dia" muestra los propios MAS los sin dueño, todas veian la misma pila y el dia de
 * cada una era el mismo.
 *
 * Ahora se reparten solos con el trabajo del dia: la primera que contesta se lo queda. Nadie
 * tiene que sentarse a asignar mil leads a mano.
 *
 * Solo toca conversaciones SIN dueño: si ya es de alguien, contestarle no se lo quita — eso
 * dejaria robar leads sin querer con solo abrir un chat ajeno y responder.
 */
export async function claimConversationIfUnassigned(input: {
  source: "agent" | "official";
  conversationId: string;
  workspaceId: string;
}): Promise<void> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return;
    }

    if (input.source === "official") {
      const actualizadas = await prisma.officialApiConversation.updateMany({
        where: { id: input.conversationId, assignedToUserId: null },
        data: { assignedToUserId: userId },
      });
      if (actualizadas.count === 0) {
        return;
      }
    } else {
      const conversacion = await prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId: input.workspaceId, assignedToUserId: null },
        select: { id: true, channelId: true, contactId: true },
      });
      if (!conversacion) {
        return;
      }

      // updateMany con el filtro de "sin dueño" otra vez: si dos asesoras contestan a la vez,
      // se lo queda la primera y la segunda no se lo pisa.
      const actualizadas = await prisma.conversation.updateMany({
        where: { id: conversacion.id, assignedToUserId: null },
        data: { assignedToUserId: userId },
      });
      if (actualizadas.count === 0) {
        return;
      }

      const quien = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: conversacion.id,
        channelId: conversacion.channelId,
        contactId: conversacion.contactId,
        kind: "assigned",
        text: `${quien?.name?.trim() || quien?.email || "Una asesora"} tomó esta conversación al responder`,
      });
    }
  } catch (error) {
    // Nunca puede tumbar un envio: quedarse con el lead es un extra, mandar el mensaje no.
    console.warn("[chats] no se pudo tomar la conversacion al responder", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
