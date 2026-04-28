import { prisma } from "@/lib/prisma";

export type AgentConversationMessageRecord = {
  id: string;
  externalId: string | null;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  mediaUrl: string | null;
  rawPayload: unknown;
};

export type LoadedAgentConversationDetail = {
  id: string;
  agentId: string | null;
  automationPaused: boolean;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string;
    avatarUrl: string | null;
  };
  channel: {
    evolutionInstanceName: string | null;
  } | null;
  messages: AgentConversationMessageRecord[];
  hasMoreMessages: boolean;
  loadMoreCursor: string | null;
};

const DEFAULT_MESSAGE_BATCH_SIZE = 20;
const MAX_MESSAGE_BATCH_SIZE = 100;

function clampBatchSize(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_MESSAGE_BATCH_SIZE;
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_MESSAGE_BATCH_SIZE));
}

function isValidCursor(value?: string | null) {
  return Boolean(value && value.trim());
}

export async function loadAgentConversationDetail(input: {
  workspaceId: string;
  conversationId: string;
  beforeMessageId?: string | null;
  batchSize?: number;
}) {
  const batchSize = clampBatchSize(input.batchSize);
  const beforeMessageId = isValidCursor(input.beforeMessageId) ? input.beforeMessageId!.trim() : null;

  const [conversation, cursorMessage] = await Promise.all([
    prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        workspaceId: input.workspaceId,
      },
      select: {
        id: true,
        agentId: true,
        automationPaused: true,
        contact: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            avatarUrl: true,
          },
        },
        channel: {
          select: {
            evolutionInstanceName: true,
          },
        },
      },
    }),
    beforeMessageId
      ? prisma.message.findFirst({
          where: {
            id: beforeMessageId,
            conversationId: input.conversationId,
            workspaceId: input.workspaceId,
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!conversation) {
    return null;
  }

  const messages = await prisma.message.findMany({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batchSize + 1,
    ...(cursorMessage ? { cursor: { id: cursorMessage.id }, skip: 1 } : {}),
    select: {
      id: true,
      externalId: true,
      content: true,
      direction: true,
      createdAt: true,
      rawPayload: true,
      type: true,
      mediaUrl: true,
    },
  });

  const visibleMessages = messages.slice(0, batchSize);

  return {
    id: conversation.id,
    agentId: conversation.agentId,
    automationPaused: conversation.automationPaused,
    contact: conversation.contact,
    channel: conversation.channel,
    messages: visibleMessages,
    hasMoreMessages: messages.length > batchSize,
    loadMoreCursor: visibleMessages.at(-1)?.id ?? null,
  } satisfies LoadedAgentConversationDetail;
}
