import { prisma } from "@/lib/prisma";

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
    WITH last_outbound AS (
      SELECT MAX(mo."createdAt") AS "lastOutboundAt"
      FROM "Message" mo
      WHERE mo."workspaceId" = ${input.workspaceId}
        AND mo."conversationId" = ${input.conversationId}
        AND mo."direction" = 'OUTBOUND'
    )
    SELECT
      COUNT(*)::bigint AS "incomingCount"
    FROM "Message" mi
    LEFT JOIN last_outbound lo ON true
    WHERE mi."workspaceId" = ${input.workspaceId}
      AND mi."conversationId" = ${input.conversationId}
      AND mi."direction" = 'INBOUND'
      AND mi."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
  `;

  return Number(rows[0]?.incomingCount ?? 0);
}

export async function getAgentConversationSummaryByConversationId(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<ChatConversationSummary | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
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

  const [lastMessage, contactTagRows, incomingCount] = await Promise.all([
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
    getIncomingCountForConversation({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
    }),
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
    incomingCount,
    lastMessage: lastMessage?.content ?? null,
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

  console.log("[Summary] channel lookup", { instanceName: input.instanceName, workspaceId: input.workspaceId, found: Boolean(channel) });
  if (!channel) {
    return null;
  }


  console.log("[Summary] contact lookup", { phoneVariants, found: Boolean(contact), contactPhone: contact?.phoneNumber });
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

  console.log("[Summary] conversation lookup", { channelId: channel.id, contactId: contact.id, found: Boolean(conversation) });
  if (!conversation) {
    return null;
  }

  const [lastMessage, contactTagRows, incomingCount] = await Promise.all([
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
    getIncomingCountForConversation({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
    }),
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
    incomingCount,
    lastMessage: lastMessage?.content ?? null,
    lastMessageType: lastMessage?.type ?? null,
    lastMessageDirection: lastMessage?.direction ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    channelType: "whatsapp",
  };
}


