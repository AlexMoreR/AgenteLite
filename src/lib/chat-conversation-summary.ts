import { prisma } from "@/lib/prisma";

export type ChatConversationSummary = {
  id: string;
  // Canal al que pertenece la conversacion. La lista lo usa para NO aceptar por realtime
  // chats de un canal que no es el que se esta viendo (se colaban los de otra conexion).
  channelId: string | null;
  label: string;
  secondaryLabel: string;
  tags: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl: string | null;
  incomingCount: number;
  lastMessage: string | null;
  lastMessageType: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt: Date | null;
  channelType: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
};

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getConversationPreviewText(message: { content: string | null; deletedAt?: Date | null } | null) {
  if (!message) {
    return null;
  }

  if (message.deletedAt) {
    return "Mensaje eliminado";
  }

  return message.content ?? null;
}

export function getContactTags(
  input: Array<{
    name: string;
    color: string;
  }>,
) {
  return input
    .filter((tag) => Boolean(tag?.name?.trim()))
    .map((tag) => ({
      label: tag.name,
      color: tag.color,
    }));
}

async function getIncomingCountForConversation(input: { workspaceId: string; conversationId: string }) {
  const rows = await prisma.$queryRaw<Array<{ incomingCount: bigint | number }>>`
    SELECT
      COUNT(*)::bigint AS "incomingCount"
    FROM "Message" mi
    WHERE mi."workspaceId" = ${input.workspaceId}
      AND mi."conversationId" = ${input.conversationId}
      AND mi."direction" = 'INBOUND'
      AND mi."readAt" IS NULL
      AND mi."isStatusBroadcast" = false
  `;

  return Number(rows[0]?.incomingCount ?? 0);
}

export async function getAgentConversationSummaryByConversationId(input: {
  workspaceId: string;
  conversationId: string;
  // Si se especifica, solo se devuelve la conversacion cuando esta asignada a este usuario.
  // Lo usan los empleados (no-managers) para no recibir summaries de chats que no son suyos.
  assignedToUserId?: string;
}): Promise<ChatConversationSummary | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId,
      ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
    },
    select: {
      id: true,
      channelId: true,
      contact: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!conversation) {
    return null;
  }

  const contact = conversation.contact;

  const [lastMessageRows, contactTagRows, incomingCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        isStatusBroadcast: false,
        // Los mensajes de actividad (SYSTEM) no cuentan como "último mensaje" del preview.
        type: { not: "SYSTEM" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: {
        content: true,
        direction: true,
        createdAt: true,
        deletedAt: true,
        type: true,
      },
    }),
    prisma.$queryRaw<Array<{ name: string; color: string }>>`
      SELECT
        t."name" AS "name",
        t."color" AS "color"
      FROM "ContactTag" ct
      INNER JOIN "Tag" t ON t."id" = ct."tagId"
      WHERE ct."workspaceId" = ${input.workspaceId}
        AND ct."contactId" = ${contact.id}
      ORDER BY ct."createdAt" ASC
    `,
    getIncomingCountForConversation({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
    }),
  ]);

  const lastMessage = lastMessageRows[0] ?? null;

  return {
    id: conversation.id,
    channelId: conversation.channelId ?? null,
    label: getAgentContactLabel({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
    }),
    secondaryLabel: contact.phoneNumber,
    tags: getContactTags(contactTagRows),
    avatarUrl: contact.avatarUrl ?? null,
    incomingCount,
    lastMessage: getConversationPreviewText(lastMessage),
    lastMessageType: lastMessage?.type ?? null,
    lastMessageDirection: lastMessage?.direction ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    channelType: "whatsapp",
  };
}

export async function getAgentConversationSummaryByPhoneNumber(input: {
  workspaceId: string;
  instanceName: string;
  phoneNumber: string;
  // Si se especifica, solo se devuelve la conversacion cuando esta asignada a este usuario.
  // Lo usan los empleados (no-managers) para no recibir summaries de chats que no son suyos.
  assignedToUserId?: string;
}): Promise<ChatConversationSummary | null> {
  const phoneVariants = Array.from(new Set([
    input.phoneNumber,
    `+${input.phoneNumber}`,
    `${input.phoneNumber}@s.whatsapp.net`,
    `+${input.phoneNumber}@s.whatsapp.net`,
  ]));

  const [channel, contact] = await Promise.all([
    prisma.whatsAppChannel.findFirst({
      where: {
        workspaceId: input.workspaceId,
        provider: "EVOLUTION",
        evolutionInstanceName: input.instanceName,
      },
      select: {
        id: true,
        agentId: true,
      },
    }),
    prisma.contact.findFirst({
      where: {
        workspaceId: input.workspaceId,
        phoneNumber: { in: phoneVariants },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        avatarUrl: true,
      },
    }),
  ]);

  if (!channel) {
    return null;
  }
  if (!contact) {
    return null;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
      ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
    },
    select: {
      id: true,
    },
  });

  if (!conversation) {
    return null;
  }

  const [lastMessageRows, contactTagRows, incomingCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        isStatusBroadcast: false,
        // Los mensajes de actividad (SYSTEM) no cuentan como "último mensaje" del preview.
        type: { not: "SYSTEM" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: {
        content: true,
        direction: true,
        createdAt: true,
        deletedAt: true,
        type: true,
      },
    }),
    prisma.$queryRaw<Array<{ name: string; color: string }>>`
      SELECT
        t."name" AS "name",
        t."color" AS "color"
      FROM "ContactTag" ct
      INNER JOIN "Tag" t ON t."id" = ct."tagId"
      WHERE ct."workspaceId" = ${input.workspaceId}
        AND ct."contactId" = ${contact.id}
      ORDER BY ct."createdAt" ASC
    `,
    getIncomingCountForConversation({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
    }),
  ]);

  const lastMessage = lastMessageRows[0] ?? null;

  return {
    id: conversation.id,
    channelId: channel.id,
    label: getAgentContactLabel({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
    }),
    secondaryLabel: contact.phoneNumber,
    tags: getContactTags(contactTagRows),
    avatarUrl: contact.avatarUrl ?? null,
    incomingCount,
    lastMessage: getConversationPreviewText(lastMessage),
    lastMessageType: lastMessage?.type ?? null,
    lastMessageDirection: lastMessage?.direction ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    channelType: "whatsapp",
  };
}


