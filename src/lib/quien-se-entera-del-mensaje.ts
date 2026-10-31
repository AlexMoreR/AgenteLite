import { prisma } from "@/lib/prisma";

/**
 * Quienes del equipo NO deben enterarse de un mensaje nuevo (ni sonido ni notificacion al celular).
 *
 * Regla del dueño (oct-2026): el sonido y la alerta de mensaje nuevo SOLO le llegan a la persona que
 * tiene ese chat asignado. Antes los jefes (OWNER y ADMIN) y quien monitoreaba la linea oian todo,
 * aunque el chat no fuera suyo: a Emanuel le pitaba el CRM sin tener ningun chat asignado.
 *
 *  - Chat asignado: solo oye esa persona; el resto del equipo queda fuera, jefes y monitoras tambien.
 *  - Chat sin asignar: no le suena a nadie (lo cubre el rescate de chats huerfanos).
 *
 * Esto NO cambia que chats ve cada uno en su bandeja: solo a quien le suena.
 *
 * Devuelve los EXCLUIDOS y no los incluidos a proposito: quien no figura como miembro -un usuario de
 * la plataforma, por ejemplo- sigue recibiendo avisos.
 */
export function excluidosDelAviso(input: {
  miembrosActivos: string[];
  asignadoA: string | null;
}): string[] {
  return input.miembrosActivos.filter((userId) => userId !== input.asignadoA);
}

export async function quienesNoSeEnteran(input: {
  workspaceId: string;
  // Ya no decide nada (la regla es solo "a quien esta asignado"); se deja para no tocar a quien llama.
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

  return excluidosDelAviso({
    miembrosActivos: miembros.map((miembro) => miembro.userId),
    asignadoA: conversacion?.assignedToUserId ?? null,
  });
}
