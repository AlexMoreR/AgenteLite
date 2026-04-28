import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type ChatConversationSummary = {
  id: string;
  label: string;
  secondaryLabel: string;
  tags: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl: string | null;
  incomingCount: number;
  lastMessage: string | null;
  lastMessageType: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt: Date | null;
  channelType: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
};

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getContactTags(
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

export async function getAgentConversationSummaryByPhoneNumber(input: {
  workspaceId: string;
  instanceName: string;
  phoneNumber: string;
}): Promise<ChatConversationSummary | null> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      workspaceId: input.workspaceId,
      provider: "EVOLUTION",
      evolutionInstanceName: input.instanceName,
    },
    select: {
      id: true,
      agentId: true,
    },
  });

  if (!channel) {
    return null;
  }

  const contact = await prisma.contact.findFirst({
    where: {
      workspaceId: input.workspaceId,
      phoneNumber: input.phoneNumber,
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      avatarUrl: true,
    },
  });

  if (!contact) {
    return null;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
    },
    select: {
      id: true,
    },
  });

  if (!conversation) {
    return null;
  }

  const [lastMessage, contactTagRows, incomingCountRows] = await Promise.all([
    prisma.message.findFirst({
      where: {
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        content: true,
        direction: true,
        createdAt: true,
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
    prisma.$queryRaw<Array<{ incomingCount: bigint | number }>>`
      SELECT
        COALESCE(incoming."incomingCount", 0)::bigint AS "incomingCount"
      FROM "Conversation" c
      LEFT JOIN LATERAL (
        SELECT MAX(mo."createdAt") AS "lastOutboundAt"
        FROM "Message" mo
        WHERE mo."conversationId" = c."id"
          AND mo."direction" = 'OUTBOUND'
      ) lo ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::bigint AS "incomingCount"
        FROM "Message" mi
        WHERE mi."conversationId" = c."id"
          AND mi."direction" = 'INBOUND'
          AND mi."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
      ) incoming ON true
      WHERE c."id" = ${conversation.id}
        AND c."workspaceId" = ${input.workspaceId}
    `,
  ]);

  return {
    id: conversation.id,
    label: getAgentContactLabel({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
    }),
    secondaryLabel: contact.phoneNumber,
    tags: getContactTags(contactTagRows),
    avatarUrl: contact.avatarUrl ?? null,
    incomingCount: Number(incomingCountRows[0]?.incomingCount ?? 0),
    lastMessage: lastMessage?.content ?? null,
    lastMessageType: lastMessage?.type ?? null,
    lastMessageDirection: lastMessage?.direction ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    channelType: "whatsapp",
  };
}
