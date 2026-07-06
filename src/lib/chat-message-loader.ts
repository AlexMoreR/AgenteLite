import { prisma } from "@/lib/prisma";
import { extractEvolutionMessageText } from "@/lib/evolution-webhook";

export type AgentConversationMessageRecord = {
  id: string;
  externalId: string | null;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
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

const DEFAULT_MESSAGE_BATCH_SIZE = 10;
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
      // Los broadcasts/estados se excluyen vía columna indexada (antes era un
      // filtro en JS sobre rawPayload). rawPayload se mantiene en el select
      // porque el UI lo usa para resolver media y previews de anuncios.
      isStatusBroadcast: false,
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
      editedAt: true,
      deletedAt: true,
      rawPayload: true,
      type: true,
      mediaUrl: true,
    },
  });

  const visibleMessages = messages.slice(0, batchSize);
  const orderedMessages = [...visibleMessages].sort((left, right) => {
    const diff = left.createdAt.getTime() - right.createdAt.getTime();
    if (diff !== 0) {
      return diff;
    }

    return left.id.localeCompare(right.id);
  }).map((message) => ({
    ...message,
    content: message.content?.trim() || extractEvolutionMessageText(message.rawPayload) || null,
  }));

  return {
    id: conversation.id,
    agentId: conversation.agentId,
    automationPaused: conversation.automationPaused,
    contact: conversation.contact,
    channel: conversation.channel,
    messages: orderedMessages,
    hasMoreMessages: messages.length > batchSize,
    loadMoreCursor: orderedMessages.at(0)?.id ?? null,
  } satisfies LoadedAgentConversationDetail;
}
