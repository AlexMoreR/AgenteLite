import { prisma } from "@/lib/prisma";
import { canalesDelNegocio } from "@/lib/canales-del-negocio";
import {
  puedeAbrirChat,
  type DatosDelChat,
  type ReglaPermisoChat,
} from "@/features/chats/services/permiso-para-abrir-chat";

/**
 * Lee linea y asesora del chat y aplica la regla. Solo lee. Un chat que no existe en este negocio
 * cuenta como "no" (la pantalla abre la bandeja normal y /live responde "no encontrado").
 *
 * Los chats de la API oficial cuentan como chats de la linea oficial del negocio.
 */
export async function permisoParaAbrirChat(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  regla: ReglaPermisoChat;
}): Promise<boolean> {
  // Jefe total: no hace falta ni consultar.
  if (input.regla.esDuenoOAdmin) {
    return true;
  }

  let chat: DatosDelChat | null = null;
  if (input.source === "agent") {
    chat = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: { channelId: true, assignedToUserId: true },
    });
  } else {
    const oficial = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
      select: { assignedToUserId: true },
    });
    if (oficial) {
      const canales = await canalesDelNegocio(input.workspaceId);
      chat = {
        channelId: canales.find((canal) => canal.provider === "OFFICIAL_API")?.id ?? null,
        assignedToUserId: oficial.assignedToUserId,
      };
    }
  }

  return chat ? puedeAbrirChat(input.regla, chat) : false;
}
