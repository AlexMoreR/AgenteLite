import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { getOfficialApiChatsData } from "@/features/official-api";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

type UnifiedConversation = {
  key: string;
  source: "agent" | "official";
  conversationId: string;
  agentId?: string;
  channelId?: string;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  incomingCount?: number | null;
  lastMessage: string | null;
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
};

type ActiveProductContextSummary = {
  productName?: string | null;
};

function toActiveProductContextSummary(input: unknown): ActiveProductContextSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as { productName?: unknown };
  const productName = typeof value.productName === "string" ? value.productName.trim() : "";
  if (!productName) {
    return null;
  }

  return { productName };
}

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getConversationContextTags(input: ActiveProductContextSummary | null | undefined) {
  const productName = input?.productName?.trim();
  if (!productName) {
    return [];
  }

  return [{
    label: productName,
    color: "#2563eb",
  }];
}

async function getAgentConversationList(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  offset: number;
  limit: number;
}) {
  const conversationListTake = input.offset + input.limit + 1;
  const normalizedSearchQuery = input.searchQuery.trim();
  const conversationWhere: Prisma.ConversationWhereInput = {
    workspaceId: input.workspaceId,
    AND: [
      input.selectedConnectionKey.startsWith("channel:")
        ? { channelId: input.selectedConnectionKey.slice("channel:".length) }
        : {},
      normalizedSearchQuery
        ? {
            OR: [
              {
                contact: {
                  name: {
                    contains: normalizedSearchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                contact: {
                  phoneNumber: {
                    contains: normalizedSearchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                messages: {
                  some: {
                    content: {
                      contains: normalizedSearchQuery,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {},
    ],
  };

  const channels = await prisma.whatsAppChannel.findMany({
    where: { workspaceId: input.workspaceId },
    select: {
      id: true,
      provider: true,
      evolutionInstanceName: true,
      agent: {
        select: {
          id: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const evolutionInstanceNames = Array.from(
    new Set(
      channels
        .filter((channel) => channel.provider === "EVOLUTION" && channel.evolutionInstanceName?.trim())
        .map((channel) => channel.evolutionInstanceName!.trim()),
    ),
  );

  const activeAgentConversations = await prisma.conversation.findMany({
    where: conversationWhere,
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: conversationListTake,
    select: {
      id: true,
      agentId: true,
      channelId: true,
      activeProductContext: true,
      contact: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          avatarUrl: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          content: true,
          direction: true,
          createdAt: true,
          deletedAt: true,
          type: true,
        },
      },
    },
  });

  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
  const latestAgentMessageRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        deletedAt: Date | null;
        type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
      }>>`
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId" AS "conversationId",
          m."content" AS "content",
          m."direction" AS "direction",
          m."createdAt" AS "createdAt",
          m."deletedAt" AS "deletedAt",
          m."type" AS "type"
        FROM "Message" m
        WHERE m."workspaceId" = ${input.workspaceId}
          AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
        ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        deletedAt: Date | null;
        type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
      }>);

  const agentIncomingCountRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        incomingCount: number;
      }>>`
        WITH selected_conversations AS (
          SELECT c."id"
          FROM "Conversation" c
          WHERE c."workspaceId" = ${input.workspaceId}
            AND c."id" IN (${Prisma.join(activeAgentConversationIds)})
        ),
        last_outbound AS (
          SELECT
            m."conversationId",
            MAX(m."createdAt") AS "lastOutboundAt"
          FROM "Message" m
          WHERE m."workspaceId" = ${input.workspaceId}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'OUTBOUND'
          GROUP BY m."conversationId"
        ),
        incoming AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "Message" m
          LEFT JOIN last_outbound lo ON lo."conversationId" = m."conversationId"
          WHERE m."workspaceId" = ${input.workspaceId}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'INBOUND'
            AND m."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
          GROUP BY m."conversationId"
        )
        SELECT
          sc."id" AS "conversationId",
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount"
        FROM selected_conversations sc
        LEFT JOIN incoming ON incoming."conversationId" = sc."id"
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        incomingCount: number;
      }>);

  const [agentIncomingCountRowsResult, latestAgentMessageRowsResult] = await Promise.allSettled([
    agentIncomingCountRowsPromise,
    latestAgentMessageRowsPromise,
  ]);
  const agentIncomingCountRows =
    agentIncomingCountRowsResult.status === "fulfilled" ? agentIncomingCountRowsResult.value : [];
  const latestAgentMessageRows =
    latestAgentMessageRowsResult.status === "fulfilled" ? latestAgentMessageRowsResult.value : [];

  const latestAgentMessageByConversationId = new Map(
    latestAgentMessageRows.map((row) => [row.conversationId, row]),
  );
  const agentIncomingCountById = new Map(agentIncomingCountRows.map((row) => [row.conversationId, row.incomingCount]));

  const agentRows: UnifiedConversation[] = activeAgentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const activeProductContext = toActiveProductContextSummary(conversation.activeProductContext);
    const tags = getConversationContextTags(activeProductContext);
    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      contactId: conversation.contact.id,
      channelId: conversation.channelId || undefined,
      label: getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      tags,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      incomingCount: agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestAgentMessageByConversationId.get(conversation.id)?.deletedAt ? "Mensaje eliminado" : latestAgentMessageByConversationId.get(conversation.id)?.content ?? null,
      lastMessageType: latestAgentMessageByConversationId.get(conversation.id)?.type ?? null,
      lastMessageDirection: latestAgentMessageByConversationId.get(conversation.id)?.direction ?? null,
      lastMessageAt: latestAgentMessageByConversationId.get(conversation.id)?.createdAt ?? null,
    };
  });

  const officialChannel = channels.find((channel) => channel.provider === "OFFICIAL_API") ?? null;
  const officialData = await getOfficialApiChatsData({
    workspaceId: input.workspaceId,
    q: input.searchQuery,
    includeSelectedConversation: false,
  });

  const officialRows: UnifiedConversation[] = officialData.isConnected
    ? officialData.conversations.map((conversation) => ({
        key: `official:${conversation.id}`,
        source: "official",
        conversationId: conversation.id,
        channelId: officialChannel?.id,
        label: conversation.contact.name?.trim() || conversation.contact.phoneNumber || conversation.contact.waId,
        secondaryLabel: conversation.contact.phoneNumber || conversation.contact.waId,
        avatarUrl: null,
        incomingCount: conversation.incomingCount ?? 0,
        lastMessage: conversation.lastMessage?.content ?? null,
        lastMessageType: conversation.lastMessage?.type ?? null,
        lastMessageDirection: conversation.lastMessage?.direction ?? null,
        lastMessageAt: conversation.lastMessage?.createdAt ?? null,
      }))
    : [];

  const merged = dedupeAndSortConversationListRows([...agentRows, ...officialRows])
    .filter((item) => {
      if (!input.searchQuery) return true;
      const q = input.searchQuery.toLowerCase();
      return (
        item.label.toLowerCase().includes(q) ||
        item.secondaryLabel.toLowerCase().includes(q) ||
        (item.lastMessage || "").toLowerCase().includes(q)
      );
    });

  const sorted = merged;
  const page = sorted.slice(input.offset, input.offset + input.limit);

  return {
    conversations: page,
    hasMore: activeAgentConversations.length > input.offset + input.limit,
    nextOffset: input.offset + page.length,
    total: sorted.length,
    evolutionInstanceNames,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const searchQuery = requestUrl.searchParams.get("q")?.trim() || "";
  const selectedConnectionKey = requestUrl.searchParams.get("connection")?.trim() || "";
  const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.max(1, Math.min(40, Number.parseInt(requestUrl.searchParams.get("limit") || "20", 10) || 20));

  const data = await getAgentConversationList({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey,
    offset,
    limit,
  });

  return NextResponse.json({
    ok: true,
    ...data,
  });
}
