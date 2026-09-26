import { Prisma } from "@prisma/client";

import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";

/**
 * EL REPARTO POR TURNOS: a quién le toca el próximo lead.
 *
 * Vivía dentro del webhook, que era su único usuario. Se mudó cuando el reparto dejó de pasar al
 * ENTRAR el lead y pasó a ocurrir cuando el agente levanta la mano (Alex, 25-09-2026): ahora lo
 * llaman el webhook, el aviso al asesor y el reloj que rescata los chats huérfanos.
 *
 * Reparte entre quienes trabajan el canal MENOS los pausados y los que solo monitorean, en orden
 * cíclico: una para Ingrid, la siguiente para María Camila, y así. El contenido no se tocó al
 * mudarlo: es el mismo código que venía repartiendo en producción.
 */

export async function autoAssignConversationToCollaborator(args: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
}) {
  const [conversation, channel] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { assignedToUserId: true },
    }),
    prisma.whatsAppChannel.findUnique({
      where: { id: args.channelId },
      select: { metadata: true },
    }),
  ]);

  // Si ya está asignada, no la tocamos.
  if (!conversation || conversation.assignedToUserId) {
    return;
  }

  const metadata =
    channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};

  // Los que trabajan el canal MENOS los que están en pausa de reparto: una asesora pausada sigue
  // viendo y atendiendo lo suyo, solo deja de recibir leads nuevos.
  const collaboratorIds = calcularReparto(metadata);

  if (collaboratorIds.length === 0) {
    return;
  }

  // Solo colaboradores que sigan siendo miembros activos del workspace.
  const activeMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: args.workspaceId, isActive: true, userId: { in: collaboratorIds } },
    select: { userId: true },
  });
  const activeSet = new Set(activeMembers.map((m) => m.userId));
  const validIds = collaboratorIds.filter((id) => activeSet.has(id));
  if (validIds.length === 0) {
    return;
  }

  // Siguiente colaborador tras el último asignado (round-robin cíclico).
  const lastId = typeof metadata.lastAutoAssignedUserId === "string" ? metadata.lastAutoAssignedUserId : null;
  const lastIndex = lastId ? validIds.indexOf(lastId) : -1;
  const nextUserId = validIds[(lastIndex + 1) % validIds.length];

  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { assignedToUserId: nextUserId },
  });
  await prisma.whatsAppChannel.update({
    where: { id: args.channelId },
    data: { metadata: { ...metadata, lastAutoAssignedUserId: nextUserId } as Prisma.InputJsonValue },
  });

  // Registro de actividad: "<Nombre> auto-asignado a esta conversación".
  const assignee = await prisma.user.findUnique({
    where: { id: nextUserId },
    select: { name: true, email: true },
  });
  const assigneeName = assignee?.name?.trim() || assignee?.email || "Colaborador";
  await recordConversationActivity({
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    kind: "assigned",
    text: `${assigneeName} auto-asignado a esta conversación`,
  });
}
