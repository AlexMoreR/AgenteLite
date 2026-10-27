/**
 * ¿Esta persona puede abrir ESTE chat con un enlace (?chatKey=agent:<id> / official:<id>)?
 *
 * Antes el enlace cargaba el chat buscandolo solo por su id y por el negocio: una asesora podia
 * abrir el de otra, o uno de una linea que no le toca, pegando la clave. La lista de la bandeja ya
 * aplicaba las reglas; el enlace no. Aca queda UNA sola regla, la misma de la lista:
 *
 *  - Dueño, administrador y supervisora: cualquier chat de las lineas que ven.
 *  - Quien monitorea: solo los chats de las lineas que monitorea (los numeros se tapan aparte).
 *  - Asesora comun: solo los chats asignados a ella, de una linea que pueda ver.
 *  - Chats de la API oficial (no tienen linea): el jefe y quien monitorea los abren; la asesora
 *    solo el que tiene asignado.
 *
 * La parte pura (`puedeAbrirChat`) no toca la base para poder probarse sola.
 */

export type ChatParaAcceso = {
  fuente: "agent" | "official";
  /** Linea del chat. Solo aplica a `agent`; null = chat sin linea. */
  channelId: string | null;
  assignedToUserId: string | null;
};

export type QuienAbre = {
  userId: string;
  /** Dueño, administrador o supervisora (los que ven "Todas"). */
  esJefe: boolean;
  /** Lineas visibles; null = ve todas (ver channel-visibility). */
  canalesVisibles: string[] | null;
  /** Lineas que solo mira (modo monitoreo). Vacio = no monitorea. */
  canalesMonitoreados: string[];
};

export function puedeAbrirChat(chat: ChatParaAcceso, quien: QuienAbre): boolean {
  const modoMonitoreo = quien.canalesMonitoreados.length > 0;

  if (chat.fuente === "official") {
    // El canal oficial no tiene linea: lo ven el jefe y quien monitorea; la asesora, solo el suyo.
    if (quien.esJefe || modoMonitoreo) return true;
    return chat.assignedToUserId === quien.userId;
  }

  // Igual que la lista: `channelId IN (visibles)` deja afuera a los chats sin linea.
  const lineaVisible =
    quien.canalesVisibles === null ||
    (chat.channelId !== null && quien.canalesVisibles.includes(chat.channelId));
  if (!lineaVisible) return false;

  if (quien.esJefe) return true;

  // Quien monitorea queda DENTRO de sus lineas, tenga dueña el chat o no (ver assignedWhere).
  if (modoMonitoreo) {
    return chat.channelId !== null && quien.canalesMonitoreados.includes(chat.channelId);
  }

  return chat.assignedToUserId === quien.userId;
}

/**
 * Lee el chat y aplica `puedeAbrirChat`. Devuelve false si la clave no existe o es de otro negocio.
 * Los modulos pesados se cargan aca adentro para que la regla pura se pruebe sin base ni auth.
 */
export async function puedeAbrirChatPorClave(input: {
  workspaceId: string;
  userId: string;
  fuente: "agent" | "official";
  conversationId: string;
  esJefe: boolean;
  canalesVisibles: string[] | null;
  canalesMonitoreados: string[];
}): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma");

  let chat: ChatParaAcceso | null = null;
  if (input.fuente === "agent") {
    const fila = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: { channelId: true, assignedToUserId: true },
    });
    chat = fila ? { fuente: "agent", ...fila } : null;
  } else {
    const fila = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
      select: { assignedToUserId: true },
    });
    chat = fila ? { fuente: "official", channelId: null, assignedToUserId: fila.assignedToUserId } : null;
  }
  if (!chat) return false;

  return puedeAbrirChat(chat, {
    userId: input.userId,
    esJefe: input.esJefe,
    canalesVisibles: input.canalesVisibles,
    canalesMonitoreados: input.canalesMonitoreados,
  });
}
