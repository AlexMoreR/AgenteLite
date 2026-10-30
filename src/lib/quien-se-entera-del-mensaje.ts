import { prisma } from "@/lib/prisma";
import { leerColaboradores, leerMonitores } from "@/lib/channel-collaborators";

/**
 * Quienes del equipo NO deben enterarse de un mensaje nuevo (ni sonido ni notificacion).
 *
 * Decision de Alex (13-sep-2026): una asesora no tiene por que oir cada mensaje del negocio, solo
 * los de lo suyo. A Genesis, que solo monitorea Ventas 1, le sonaban los de Admin.
 *
 * La regla es la MISMA con la que la lista de Chats decide que ve cada uno
 * (`api/cliente/chats/list`), para que nunca suene algo que despues no aparece en su bandeja:
 *  - Jefe (OWNER o ADMIN del negocio): todo lo de los canales que ve.
 *  - Quien monitorea algun canal: todo lo de los canales que monitorea.
 *  - El resto: solo los chats asignados a el.
 * Siempre dentro de los canales visibles para esa persona (colaboradores del canal).
 *
 * Devuelve los EXCLUIDOS y no los incluidos a proposito: quien no figura como miembro -un usuario de
 * la plataforma, por ejemplo- sigue recibiendo avisos. Ante la duda, sonar de mas es mejor que
 * dejar a alguien sin enterarse de un cliente.
 */
export async function quienesNoSeEnteran(input: {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
}): Promise<string[]> {
  if (!input.channelId) {
    return [];
  }

  const [miembros, canales, conversacion] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true },
      select: { userId: true, role: true },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, metadata: true },
    }),
    input.conversationId
      ? prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: { assignedToUserId: true },
        })
      : Promise.resolve(null),
  ]);

  const canal = canales.find((fila) => fila.id === input.channelId);
  if (!canal) {
    return [];
  }
  const colaboradores = leerColaboradores(canal.metadata);
  const monitoresDelCanal = leerMonitores(canal.metadata);
  const asignadoA = conversacion?.assignedToUserId ?? null;

  return miembros
    .filter((miembro) => {
      const esJefe = miembro.role === "OWNER" || miembro.role === "ADMIN";
      const veElCanal = esJefe || colaboradores.length === 0 || colaboradores.includes(miembro.userId);
      if (!veElCanal) {
        return true;
      }
      if (esJefe) {
        return false;
      }
      // Igual que la bandeja: quien monitorea algun canal ve lo de esos canales y no su "Mias".
      const monitoreaAlguno = canales.some((fila) => leerMonitores(fila.metadata).includes(miembro.userId));
      if (monitoreaAlguno) {
        return !monitoresDelCanal.includes(miembro.userId);
      }
      return asignadoA !== miembro.userId;
    })
    .map((miembro) => miembro.userId);
}
