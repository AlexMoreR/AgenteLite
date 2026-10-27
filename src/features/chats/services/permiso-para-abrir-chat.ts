import { prisma } from "@/lib/prisma";

/**
 * Quien puede ABRIR un chat con ?chatKey= (o pidiendolo a /api/cliente/chats/live).
 *
 * La lista de la bandeja filtra por linea visible, por "solo mis chats" y por las lineas que se
 * monitorean, pero el chat abierto por clave se cargaba por su id sin mirar nada de eso: con el
 * enlace del chat de otra asesora (o de una linea que no le toca) se abria igual. Esta es la MISMA
 * regla que la lista, en un solo lugar, para que la pantalla y /live no se desalineen.
 */

export type EntradaPermisoChat = {
  // Dueño o administradora: ven todo.
  esJefe: boolean;
  // Supervisora: ve cualquier chat, pero solo de SUS lineas.
  esSupervisora: boolean;
  userId: string;
  // null = ve todas las lineas (ver getVisibleChannelIds).
  canalesVisibles: string[] | null;
  // Lineas que vigila (modo monitoreo). Vacio = no monitorea.
  canalesMonitoreados: string[];
  chat: {
    // Lineas del chat: una para los chats de WhatsApp normal; para la API oficial, las lineas oficiales.
    canalIds: string[];
    assignedToUserId: string | null;
  };
};

export function puedeAbrirChat(entrada: EntradaPermisoChat): boolean {
  if (entrada.esJefe) {
    return true;
  }

  const { canalesVisibles, canalesMonitoreados, chat } = entrada;
  const enLineaVisible = chat.canalIds.some((id) => !canalesVisibles || canalesVisibles.includes(id));
  if (!enLineaVisible) {
    return false;
  }

  // La supervisora ve cualquier chat de sus lineas.
  if (entrada.esSupervisora) {
    return true;
  }

  // Quien monitorea solo mira las lineas que vigila (puede ver, no escribir).
  if (canalesMonitoreados.length > 0) {
    return chat.canalIds.some((id) => canalesMonitoreados.includes(id));
  }

  // La asesora comun: solo los chats asignados a ella.
  return chat.assignedToUserId === entrada.userId;
}

/**
 * Lee de la base la linea y la asesora del chat y aplica la regla. Si el chat no existe en este
 * negocio, es que no se puede abrir.
 */
export async function puedeAbrirChatPorClave(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  esJefe: boolean;
  esSupervisora: boolean;
  userId: string;
  canalesVisibles: string[] | null;
  canalesMonitoreados: string[];
}): Promise<boolean> {
  let chat: EntradaPermisoChat["chat"] | null = null;

  if (input.source === "agent") {
    const fila = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: { channelId: true, assignedToUserId: true },
    });
    if (fila) {
      chat = { canalIds: fila.channelId ? [fila.channelId] : [], assignedToUserId: fila.assignedToUserId };
    }
  } else {
    const fila = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
      select: { assignedToUserId: true },
    });
    if (fila) {
      // Los chats de la API oficial cuentan como chats de la linea oficial.
      const lineas = await prisma.whatsAppChannel.findMany({
        where: { workspaceId: input.workspaceId, provider: "OFFICIAL_API" },
        select: { id: true },
      });
      chat = { canalIds: lineas.map((linea) => linea.id), assignedToUserId: fila.assignedToUserId };
    }
  }

  if (!chat) {
    return false;
  }

  return puedeAbrirChat({
    esJefe: input.esJefe,
    esSupervisora: input.esSupervisora,
    userId: input.userId,
    canalesVisibles: input.canalesVisibles,
    canalesMonitoreados: input.canalesMonitoreados,
    chat,
  });
}
