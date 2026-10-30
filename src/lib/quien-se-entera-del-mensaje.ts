import { prisma } from "@/lib/prisma";

/**
 * Quienes del equipo NO deben enterarse de un mensaje nuevo (ni sonido ni notificacion).
 *
 * Regla del dueño (oct-2026): el sonido y la alerta de mensaje nuevo SOLO le llegan a quien tiene
 * ese chat asignado. A Emanuel le pitaba el CRM sin tener ningun chat asignado, porque antes oian
 * todo los jefes (OWNER y ADMIN) y quien monitoreaba la linea.
 *  - Chat asignado: se entera solo esa persona; todos los demas quedan fuera, jefes y monitoras
 *    incluidos.
 *  - Chat sin asignar: no se entera nadie (los huerfanos los cubre el rescate de chats).
 *
 * Lo que cada quien VE en su bandeja no cambia: esto decide solo a quien le suena.
 *
 * Devuelve los EXCLUIDOS y no los incluidos a proposito: quien no figura como miembro -un usuario de
 * la plataforma, por ejemplo- sigue recibiendo avisos.
 */
export function excluidosDelAviso(miembrosActivos: string[], asignadoA: string | null): string[] {
  return miembrosActivos.filter((userId) => userId !== asignadoA);
}

export async function quienesNoSeEnteran(input: {
  workspaceId: string;
  // Ya no decide nada (antes miraba colaboradores y monitoras del canal); se deja para no tocar
  // a quienes la llaman.
  channelId: string | null;
  conversationId: string | null;
}): Promise<string[]> {
  const [miembros, conversacion] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true },
      select: { userId: true },
    }),
    input.conversationId
      ? prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: { assignedToUserId: true },
        })
      : Promise.resolve(null),
  ]);

  return excluidosDelAviso(
    miembros.map((miembro) => miembro.userId),
    conversacion?.assignedToUserId ?? null,
  );
}
