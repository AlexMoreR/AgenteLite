import { prisma } from "@/lib/prisma";
import { canalesDelNegocio } from "@/lib/canales-del-negocio";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { puedeAbrirChat } from "./permiso-para-abrir-chat";

/**
 * Lee de la base lo que la regla necesita (la linea y la asesora del chat) y la aplica.
 *
 * Solo LEE. Los permisos de la persona salen de las mismas funciones que usa la lista, y casi
 * todo viene de la cache de permisos (ver cache-de-permisos.ts): suma una consulta pequeña.
 * Ante un chat que no existe o es de otro negocio responde false: para el que llama es lo mismo
 * que "sin permiso".
 */
export async function puedeAbrirChatDeLaBase(input: {
  workspaceId: string;
  userId: string;
  /** Dueño o administrador de la plataforma: ve todas las lineas (igual que getVisibleChannelIds). */
  esJefe: boolean;
  /** Rol en el negocio (OWNER / ADMIN / ...): con la supervisora, ve todo el equipo. */
  membershipRole: string;
  chat: { source: "agent" | "official"; conversationId: string };
}): Promise<boolean> {
  const [canalesVisibles, canalesMonitoreados, esSupervisoraDelNegocio] = await Promise.all([
    getVisibleChannelIds({ workspaceId: input.workspaceId, userId: input.userId, esJefe: input.esJefe }),
    canalesQueMonitorea({ workspaceId: input.workspaceId, userId: input.userId }),
    esSupervisora(input.workspaceId, input.userId),
  ]);

  let canalIds: string[];
  let asignadoAUserId: string | null;

  if (input.chat.source === "agent") {
    const fila = await prisma.conversation.findFirst({
      where: { id: input.chat.conversationId, workspaceId: input.workspaceId },
      select: { channelId: true, assignedToUserId: true },
    });
    if (!fila) return false;
    canalIds = fila.channelId ? [fila.channelId] : [];
    asignadoAUserId = fila.assignedToUserId ?? null;
  } else {
    // Los chats oficiales cuelgan de la configuracion del negocio, no de un canal.
    const fila = await prisma.officialApiConversation.findFirst({
      where: { id: input.chat.conversationId, config: { workspaceId: input.workspaceId } },
      select: { assignedToUserId: true },
    });
    if (!fila) return false;
    asignadoAUserId = fila.assignedToUserId ?? null;
    canalIds = (await canalesDelNegocio(input.workspaceId))
      .filter((canal) => canal.provider === "OFFICIAL_API")
      .map((canal) => canal.id);
  }

  return puedeAbrirChat({
    origen: input.chat.source,
    canalIds,
    asignadoAUserId,
    userId: input.userId,
    canalesVisibles,
    esJefeOSupervisora:
      input.membershipRole === "OWNER" || input.membershipRole === "ADMIN" || esSupervisoraDelNegocio,
    canalesMonitoreados,
  });
}
