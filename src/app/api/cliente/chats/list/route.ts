import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { scheduleContactAvatarRefresh, type ContactAvatarTarget } from "@/lib/contact-avatar-refresh";
import { extractEvolutionMessageText, extractEvolutionPushName } from "@/lib/evolution-webhook";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

type UnifiedConversation = {
  key: string;
  source: "agent";
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
  assignedToUserId?: string | null;
  assignedToName?: string | null;
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

function mergeConversationTags(
  baseTags: Array<{
    label: string;
    color: string;
  }>,
  extraTags: Array<{
    label: string;
    color: string;
  }>,
) {
  const merged: Array<{
    label: string;
    color: string;
  }> = [];
  const seen = new Set<string>();

  for (const tag of [...baseTags, ...extraTags]) {
    const label = tag.label.trim();
    if (!label) {
      continue;
    }

    const key = `${label.toLowerCase()}::${tag.color.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      label,
      color: tag.color,
    });
  }

  return merged;
}

function resolveStoredAgentMessagePreview(input: {
  content: string | null;
  deletedAt: Date | null;
  rawPayload: unknown;
}) {
  if (input.deletedAt) {
    return "Mensaje eliminado";
  }

  return input.content?.trim() || extractEvolutionMessageText(input.rawPayload) || null;
}

function resolveStoredAgentContactLabel(input: {
  contactName: string | null;
  phoneNumber: string;
  rawPayload: unknown;
}) {
  return input.contactName?.trim() || extractEvolutionPushName(input.rawPayload)?.trim() || input.phoneNumber;
}

async function getAgentConversationList(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  assignedFilter: "all" | "mine" | "unassigned";
  statusFilter: "all" | "open" | "resolved";
  currentUserId: string;
  offset: number;
  limit: number;
}) {
  const normalizedSearchQuery = input.searchQuery.trim();
  const assignedWhere: Prisma.ConversationWhereInput =
    input.assignedFilter === "mine"
      ? { assignedToUserId: input.currentUserId }
      : input.assignedFilter === "unassigned"
        ? { assignedToUserId: null }
        : {};
  const statusWhere: Prisma.ConversationWhereInput =
    input.statusFilter === "resolved"
      ? { status: { in: ["CLOSED", "ARCHIVED"] } }
      : input.statusFilter === "all"
        ? {}
        : { status: { in: ["OPEN", "PENDING"] } };
  const conversationWhere: Prisma.ConversationWhereInput = {
    workspaceId: input.workspaceId,
    AND: [
      input.selectedConnectionKey.startsWith("channel:")
        ? { channelId: input.selectedConnectionKey.slice("channel:".length) }
        : {},
      assignedWhere,
      statusWhere,
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
    skip: input.offset,
    take: input.limit + 1,
    select: {
      id: true,
      agentId: true,
      channelId: true,
      assignedToUserId: true,
      assignedTo: { select: { name: true, email: true } },
      activeProductContext: true,
        contact: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            avatarUrl: true,
            crmStage: true,
          },
        },
      },
    });

  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
  const contactIds = Array.from(new Set(activeAgentConversations.map((conversation) => conversation.contact.id)));
  const contactTagRowsPromise = contactIds.length
    ? prisma.$queryRaw<Array<{ contactId: string; name: string; color: string }>>`
        SELECT
          ct."contactId" AS "contactId",
          t."name" AS "name",
          t."color" AS "color"
        FROM "ContactTag" ct
        INNER JOIN "Tag" t ON t."id" = ct."tagId"
        WHERE ct."workspaceId" = ${input.workspaceId}
          AND ct."contactId" IN (${Prisma.join(contactIds)})
        ORDER BY ct."createdAt" ASC
      `
    : Promise.resolve([] as Array<{ contactId: string; name: string; color: string }>);
  const latestAgentMessageRowsPromise = activeAgentConversationIds.length
      ? prisma.$queryRaw<Array<{
          conversationId: string;
          content: string | null;
          direction: "INBOUND" | "OUTBOUND";
          createdAt: Date;
          deletedAt: Date | null;
          type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
          rawPayload: unknown;
        }>>`
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId" AS "conversationId",
          m."content" AS "content",
          m."direction" AS "direction",
          m."createdAt" AS "createdAt",
          m."deletedAt" AS "deletedAt",
          m."type" AS "type",
          m."rawPayload" AS "rawPayload"
        FROM "Message" m
        WHERE m."workspaceId" = ${input.workspaceId}
          AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
          AND m."isStatusBroadcast" = false
          AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
          AND m."type" IS DISTINCT FROM 'SYSTEM'
        ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        deletedAt: Date | null;
        type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
        rawPayload: unknown;
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
        incoming AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${input.workspaceId}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'INBOUND'
            AND m."readAt" IS NULL
            AND m."isStatusBroadcast" = false
            AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
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

  const [agentIncomingCountRowsResult, latestAgentMessageRowsResult, contactTagRowsResult] = await Promise.allSettled([
    agentIncomingCountRowsPromise,
    latestAgentMessageRowsPromise,
    contactTagRowsPromise,
  ]);
  const agentIncomingCountRows =
    agentIncomingCountRowsResult.status === "fulfilled" ? agentIncomingCountRowsResult.value : [];
  const latestAgentMessageRows =
    latestAgentMessageRowsResult.status === "fulfilled" ? latestAgentMessageRowsResult.value : [];
  const contactTagRows =
    contactTagRowsResult.status === "fulfilled" ? contactTagRowsResult.value : [];

  const latestAgentMessageByConversationId = new Map(
    latestAgentMessageRows.map((row) => [row.conversationId, row]),
  );
  const agentIncomingCountById = new Map(agentIncomingCountRows.map((row) => [row.conversationId, row.incomingCount]));
  const contactTagsByContactId = new Map<string, Array<{ label: string; color: string }>>();
  for (const row of contactTagRows) {
    const currentTags = contactTagsByContactId.get(row.contactId) ?? [];
    contactTagsByContactId.set(row.contactId, [
      ...currentTags,
      {
        label: row.name,
        color: row.color,
      },
    ]);
  }

  const agentRows: UnifiedConversation[] = activeAgentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const latestMessage = latestAgentMessageByConversationId.get(conversation.id);
    const activeProductContext = toActiveProductContextSummary(conversation.activeProductContext);
    const tags = mergeConversationTags(
      contactTagsByContactId.get(conversation.contact.id) ?? [],
      getConversationContextTags(activeProductContext),
    );
    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      contactId: conversation.contact.id,
      channelId: conversation.channelId || undefined,
      assignedToUserId: conversation.assignedToUserId ?? null,
      assignedToName: conversation.assignedTo?.name?.trim() || conversation.assignedTo?.email || null,
      label: latestMessage
        ? resolveStoredAgentContactLabel({
            contactName: conversation.contact.name,
            phoneNumber: conversation.contact.phoneNumber,
            rawPayload: latestMessage.rawPayload,
          })
        : getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      crmStage: conversation.contact.crmStage ?? null,
      tags,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      incomingCount: agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestMessage
        ? resolveStoredAgentMessagePreview(latestMessage)
        : null,
      lastMessageType: latestMessage?.type ?? null,
      lastMessageDirection: latestMessage?.direction ?? null,
      lastMessageAt: latestMessage?.createdAt ?? null,
    };
  });

  const merged = dedupeAndSortConversationListRows(agentRows)
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
  const page = sorted.slice(0, input.limit);

  // Refresco best-effort de las fotos de perfil de WhatsApp para los contactos visibles
  // (en segundo plano, con TTL/caché en Contact.metadata). Ver contact-avatar-refresh.ts.
  const avatarTargets = activeAgentConversations.reduce<ContactAvatarTarget[]>((acc, conversation) => {
    const channel = conversation.channelId ? channelsById.get(conversation.channelId) : null;
    const instanceName =
      channel?.provider === "EVOLUTION" ? channel.evolutionInstanceName?.trim() ?? "" : "";
    const phoneNumber = conversation.contact.phoneNumber?.trim() ?? "";
    if (instanceName && phoneNumber) {
      acc.push({ contactId: conversation.contact.id, phoneNumber, instanceName });
    }
    return acc;
  }, []);
  scheduleContactAvatarRefresh(avatarTargets);

  return {
    conversations: page,
    hasMore: sorted.length > input.limit,
    nextOffset: input.offset + page.length,
    total: sorted.length,
    evolutionInstanceNames,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
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

  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  const requestedFilterRaw = requestUrl.searchParams.get("assigned")?.trim() || "";
  let assignedFilter: "all" | "mine" | "unassigned" =
    requestedFilterRaw === "mine" || requestedFilterRaw === "unassigned" ? requestedFilterRaw : "all";
  // Los no-managers (empleados) solo pueden ver sus chats asignados: nunca "Todos" ni "Sin asignar".
  if (!isManager) {
    assignedFilter = "mine";
  }

  const requestedStatusRaw = requestUrl.searchParams.get("status")?.trim() || "";
  const statusFilter: "all" | "open" | "resolved" =
    requestedStatusRaw === "open" || requestedStatusRaw === "resolved" ? requestedStatusRaw : "all";

  const data = await getAgentConversationList({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey,
    assignedFilter,
    statusFilter,
    currentUserId: session.user.id,
    offset,
    limit,
  });

  return NextResponse.json({
    ok: true,
    assignedFilter,
    isManager,
    ...data,
  });
}
