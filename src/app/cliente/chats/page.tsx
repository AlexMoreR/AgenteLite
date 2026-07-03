import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendUnifiedChatReplyAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { sendChatAudioReplyAction, sendChatMediaReplyAction } from "@/app/actions/agent-actions";
import { AssignChatControl } from "@/components/chats/assign-chat-control";
import { ChatHeaderActions } from "@/components/chats/chat-header-actions";
import type { CrmStage } from "@/features/crm/types";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { ChatsRealtimeSync } from "@/components/chats/chats-realtime-sync";
import { ChatIncomingNotifier } from "@/components/chats/chat-incoming-notifier";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { extractEvolutionPhoneNumber, isEvolutionStatusBroadcastPayload, normalizePhoneFromJid } from "@/lib/evolution-webhook";
import { getEvolutionSettings } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const CHAT_MESSAGE_MAX_BATCHES = 5;
const CHAT_MESSAGE_SCROLL_PRESERVE_QUERY = "preserve";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type UnifiedConversation = {
  key: string;
  source: "agent";
  conversationId: string;
  agentId?: string;
  channelId?: string;
  label: string;
  secondaryLabel: string;
  contactId?: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  incomingCount?: number | null;
  assignedToName?: string | null;
  lastMessage: string | null;
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
  activeProductContext?: ActiveProductContextSummary | null;
};

function extractEvolutionPayloadList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.response)) {
    return record.response;
  }

  if (Array.isArray(record.data)) {
    return record.data;
  }

  if (record.response && typeof record.response === "object") {
    return [record.response];
  }

  if (record.data && typeof record.data === "object") {
    return [record.data];
  }

  return [];
}

function normalizePhoneDigits(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits || null;
}

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

function getConversationPreviewLabel(type?: UnifiedConversation["lastMessageType"] | null) {
  if (type === "AUDIO") return "Audio";
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video";
  if (type === "STICKER") return "Sticker";
  if (type === "DOCUMENT") return "Documento";
  return "";
}

function parseChatKey(input: string): { source: "agent"; conversationId: string } | null {
  if (!input) return null;
  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");
  if (source === "agent" && conversationId) {
    return { source, conversationId };
  }
  return null;
}

function parsePositiveInteger(value: string | undefined, fallback = 1) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampMessagePage(value: number) {
  return Math.min(value, CHAT_MESSAGE_MAX_BATCHES);
}

export default async function ClienteChatsPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspace.id },
    select: { businessConfig: true },
  });

  const autoTagNewLeads =
    workspace &&
    workspace.businessConfig !== null &&
    typeof workspace.businessConfig === "object" &&
    !Array.isArray(workspace.businessConfig) &&
    (workspace.businessConfig as { autoTagNewLeads?: unknown }).autoTagNewLeads !== false;
  const newLeadTagName =
    workspace &&
    workspace.businessConfig !== null &&
    typeof workspace.businessConfig === "object" &&
    !Array.isArray(workspace.businessConfig) &&
    typeof (workspace.businessConfig as { newLeadTagName?: unknown }).newLeadTagName === "string"
      ? ((workspace.businessConfig as { newLeadTagName?: string }).newLeadTagName ?? "").trim()
      : "";

  const params = await searchParams;
  const selectedChatKeyParam = typeof params.chatKey === "string" ? params.chatKey : "";
  const selectedConnectionParam = typeof params.connection === "string" ? params.connection : "";
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";

  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  const assignedParam = typeof params.assigned === "string" ? params.assigned.trim() : "";
  let assignedFilter: "all" | "mine" | "unassigned" =
    assignedParam === "mine" || assignedParam === "unassigned" ? assignedParam : "all";
  // Los no-managers (empleados) solo pueden ver sus chats asignados: nunca "Todos" ni "Sin asignar".
  if (!isManager) {
    assignedFilter = "mine";
  }
  const assignedWhere: Prisma.ConversationWhereInput =
    assignedFilter === "mine"
      ? { assignedToUserId: access.userId }
      : assignedFilter === "unassigned"
        ? { assignedToUserId: null }
        : {};

  // Filtro de estado de conversación. Por DEFECTO se ocultan las resueltas (solo abiertas):
  // las resueltas solo aparecen al elegir "Resueltas" o "Todas".
  const statusParam = typeof params.status === "string" ? params.status.trim() : "";
  const statusFilter: "all" | "open" | "resolved" =
    statusParam === "all" || statusParam === "resolved" ? statusParam : "open";
  const statusWhere: Prisma.ConversationWhereInput =
    statusFilter === "resolved"
      ? { status: { in: ["CLOSED", "ARCHIVED"] } }
      : statusFilter === "all"
        ? {}
        : { status: { in: ["OPEN", "PENDING"] } };
  const messagePage = clampMessagePage(parsePositiveInteger(typeof params.messagePage === "string" ? params.messagePage : undefined, 1));
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const scrollMode = typeof params.scroll === "string" ? params.scroll : "";

  const selectedChatRef = parseChatKey(selectedChatKeyParam);
  const conversationListTake = searchQuery || selectedChatRef ? 40 : 20;
  const conversationWhere: Prisma.ConversationWhereInput = {
    workspaceId: membership.workspace.id,
    AND: [
      selectedConnectionParam.startsWith("channel:")
        ? { channelId: selectedConnectionParam.slice("channel:".length) }
        : {},
      assignedWhere,
      statusWhere,
      searchQuery
        ? {
            OR: [
              {
                contact: {
                  name: {
                    contains: searchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                contact: {
                  phoneNumber: {
                    contains: searchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                messages: {
                  some: {
                    content: {
                      contains: searchQuery,
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

  const [evolutionSettings, channels, agentConversationsRaw] = await Promise.all([
    getEvolutionSettings(),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: membership.workspace.id },
      select: {
        id: true,
        name: true,
        provider: true,
        phoneNumber: true,
        status: true,
        evolutionInstanceName: true,
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.conversation.findMany({
      where: conversationWhere,
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: conversationListTake + 1,
      select: {
        id: true,
        agentId: true,
        channelId: true,
        automationPaused: true,
        status: true,
        assignedToUserId: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        activeProductContext: true,
        contact: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            avatarUrl: true,
          },
        },
      },
    }),
  ]);

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const evolutionInstanceNames = Array.from(
    new Set(
      channels
        .filter((channel) => channel.provider === "EVOLUTION" && channel.evolutionInstanceName?.trim())
        .map((channel) => channel.evolutionInstanceName!.trim()),
    ),
  );

  // Excluir conversaciones cuyo canal fue eliminado
  const hasMoreConversationItems = agentConversationsRaw.length > conversationListTake;
  const agentConversations = agentConversationsRaw.slice(0, conversationListTake);

  const activeAgentConversations = agentConversations.filter((conv) => {
    if (!conv.channelId) return true;
    return channelsById.has(conv.channelId);
  });

  const contactIds = Array.from(new Set(activeAgentConversations.map((conversation) => conversation.contact.id)));
  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
  const contactTagRowsPromise = contactIds.length
    ? prisma.$queryRaw<Array<{ contactId: string; name: string; color: string }>>`
        SELECT
          ct."contactId" AS "contactId",
          t."name" AS "name",
          t."color" AS "color"
        FROM "ContactTag" ct
        INNER JOIN "Tag" t ON t."id" = ct."tagId"
        WHERE ct."workspaceId" = ${membership.workspace.id}
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
      }>>`
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId" AS "conversationId",
          m."content" AS "content",
          m."direction" AS "direction",
          m."createdAt" AS "createdAt",
          m."deletedAt" AS "deletedAt",
          m."type" AS "type"
        FROM "Message" m
        WHERE m."workspaceId" = ${membership.workspace.id}
          AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
          AND COALESCE(m."rawPayload"::text, '') NOT ILIKE '%status@broadcast%'
          AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
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
  if (autoTagNewLeads && contactIds.length > 0) {
    after(async () => {
      try {
        const outboundRows = await prisma.$queryRaw<Array<{ contactId: string; outboundCount: number }>>`
          SELECT
            m."contactId" AS "contactId",
            COUNT(*)::int AS "outboundCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${membership.workspace.id}
            AND m."contactId" IN (${Prisma.join(contactIds)})
            AND m."direction" = 'OUTBOUND'
          GROUP BY m."contactId"
        `;
        const outboundCountByContactId = new Map<string, number>();
        for (const row of outboundRows) {
          outboundCountByContactId.set(row.contactId, row.outboundCount);
        }

        await Promise.allSettled(
          contactIds.map((contactId) =>
            syncLeadLifecycleForContact({
              workspaceId: membership.workspace.id,
              contactId,
              newLeadTagName,
              hasHistory: (outboundCountByContactId.get(contactId) ?? 0) > 0,
            }),
          ),
        );
      } catch {
        // No bloqueamos la carga si falla la sincronización de tags en segundo plano.
      }
    });
  }

  // Al abrir una conversacion, marcamos sus mensajes entrantes como leidos (vistos).
  // La escritura se difiere con after() para que NO bloquee el render del chat; el badge
  // de no-leídos del chat abierto se fuerza a 0 en código más abajo, así la UI queda
  // correcta de inmediato aunque la escritura termine después de la respuesta.
  const selectedAgentConversationIdForRead =
    selectedChatRef?.source === "agent" ? selectedChatRef.conversationId : null;
  if (selectedAgentConversationIdForRead) {
    after(async () => {
      try {
        await prisma.message.updateMany({
          where: {
            workspaceId: membership.workspace.id,
            conversationId: selectedAgentConversationIdForRead,
            direction: "INBOUND",
            readAt: null,
          },
          data: { readAt: new Date() },
        });
      } catch {
        // No bloqueamos ni rompemos la carga si falla el marcado como leído.
      }
    });
  }

  const agentIncomingCountRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        incomingCount: number;
      }>>`
        WITH selected_conversations AS (
          SELECT c."id"
          FROM "Conversation" c
          WHERE c."workspaceId" = ${membership.workspace.id}
            AND c."id" IN (${Prisma.join(activeAgentConversationIds)})
        ),
        incoming AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${membership.workspace.id}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'INBOUND'
            AND m."readAt" IS NULL
            AND COALESCE(m."rawPayload"::text, '') NOT ILIKE '%status@broadcast%'
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

  if (process.env.NODE_ENV !== "production") {
    if (agentIncomingCountRowsResult.status === "rejected") {
      console.warn("[CHATS PAGE] agentIncomingCountRowsPromise failed", agentIncomingCountRowsResult.reason);
    }
    if (latestAgentMessageRowsResult.status === "rejected") {
      console.warn("[CHATS PAGE] latestAgentMessageRowsPromise failed", latestAgentMessageRowsResult.reason);
    }
  }
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

  const selectedAgentConversation =
    selectedChatRef?.source === "agent"
      ? activeAgentConversations.find((item) => item.id === selectedChatRef.conversationId) || null
      : null;

  // Fetch avatars only for contacts without cached avatarUrl (max 10 per load)
  // Selected conversation contact gets priority so it always appears in the list
  const uncachedConversations = activeAgentConversations.filter((c) => !c.contact.avatarUrl);
  const selectedUncached = selectedAgentConversation && !selectedAgentConversation.contact.avatarUrl
    ? [selectedAgentConversation]
    : [];
  const restUncached = uncachedConversations
    .filter((c) => c.id !== selectedAgentConversation?.id)
    .slice(0, 10 - selectedUncached.length);
  const uncachedAvatarLookups = [...selectedUncached, ...restUncached]
    .flatMap((conversation) => {
      const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
      const instanceName = linkedChannel?.evolutionInstanceName?.trim();
      const phoneNumber = conversation.contact.phoneNumber?.trim();
      return instanceName && phoneNumber
        ? [{ contactId: conversation.contact.id, instanceName, phoneNumber }]
        : [];
    });

  if (uncachedAvatarLookups.length > 0) {
    void Promise.all(
      uncachedAvatarLookups.map(async ({ contactId, instanceName, phoneNumber }) => {
        const url = await fetchEvolutionProfilePictureUrl({ instanceName, phoneNumber });
        if (url) {
          await prisma.contact.update({ where: { id: contactId }, data: { avatarUrl: url } });
        }
      }),
    ).catch(() => null);
  }

  const agentRows: UnifiedConversation[] = activeAgentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const avatarUrl = conversation.contact.avatarUrl ?? null;
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
      label: getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      tags,
      avatarUrl,
      assignedToName: conversation.assignedTo?.name?.trim() || conversation.assignedTo?.email || null,
      // El chat abierto se marca como leído (vía after()); su badge va a 0 de inmediato.
      incomingCount:
        conversation.id === selectedAgentConversationIdForRead
          ? 0
          : agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestAgentMessageByConversationId.get(conversation.id)?.deletedAt ? "Mensaje eliminado" : latestAgentMessageByConversationId.get(conversation.id)?.content ?? null,
      lastMessageType: latestAgentMessageByConversationId.get(conversation.id)?.type ?? null,
      lastMessageDirection: latestAgentMessageByConversationId.get(conversation.id)?.direction ?? null,
      lastMessageAt: latestAgentMessageByConversationId.get(conversation.id)?.createdAt ?? null,
      activeProductContext,
    };
  });

  const selectedConnectionKey = selectedConnectionParam;
  const sidebarItems = channels.map((channel) => ({
    id: `channel:${channel.id}`,
    label: channel.name,
    helper:
      channel.phoneNumber?.trim() ||
      (channel.provider === "OFFICIAL_API" ? "WhatsApp API oficial" : "WhatsApp QR"),
    href: `/cliente/chats?connection=${encodeURIComponent(`channel:${channel.id}`)}`,
    isActive: selectedConnectionKey === `channel:${channel.id}`,
    channelType: (channel.provider === "OFFICIAL_API" ? "whatsapp_official" : "whatsapp") as
      | "whatsapp"
      | "whatsapp_official",
  }));
  const merged = dedupeAndSortConversationListRows(agentRows)
    .filter((item) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.label.toLowerCase().includes(q) ||
        item.secondaryLabel.toLowerCase().includes(q) ||
        (item.lastMessage || "").toLowerCase().includes(q)
      );
    });

  const selectedUnified = selectedChatKeyParam
    ? merged.find((item) => item.key === selectedChatKeyParam) || null
    : null;
  const selectedEvolutionInstanceName =
    selectedUnified?.source === "agent" && selectedUnified.channelId
      ? channelsById.get(selectedUnified.channelId)?.evolutionInstanceName?.trim() || null
      : null;
  const evolutionGlobalWebsocketEventsEnabled = process.env.WEBSOCKET_GLOBAL_EVENTS === "true";
  // Los empleados (no managers) solo reciben realtime del chat asignado que tienen abierto:
  // no se suscriben a todos los canales ni a los eventos globales del workspace.
  const realtimeGlobalEventsEnabled = evolutionGlobalWebsocketEventsEnabled && isManager;
  const realtimeInstanceNames = isManager
    ? evolutionInstanceNames
    : selectedEvolutionInstanceName
      ? [selectedEvolutionInstanceName]
      : [];
  const chatsRealtimeSyncEnabled = Boolean(
    evolutionSettings.apiBaseUrl &&
      evolutionSettings.apiToken &&
      (realtimeGlobalEventsEnabled || realtimeInstanceNames.length > 0),
  );
  const chatListHref = `/cliente/chats${
    selectedConnectionKey || searchQuery || assignedFilter !== "all" || statusFilter !== "open"
      ? `?${new URLSearchParams([
          ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
          ...(searchQuery ? [["q", searchQuery]] : []),
          ...(assignedFilter !== "all" ? [["assigned", assignedFilter]] : []),
          ...(statusFilter !== "open" ? [["status", statusFilter]] : []),
        ]).toString()}`
      : ""
  }`;
  const selectedChatHref = selectedUnified
    ? `/cliente/chats?${new URLSearchParams([
        ["chatKey", selectedUnified.key],
        ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
        ...(searchQuery ? [["q", searchQuery]] : []),
        ...(assignedFilter !== "all" ? [["assigned", assignedFilter]] : []),
        ...(statusFilter !== "open" ? [["status", statusFilter]] : []),
        ...(messagePage > 1 ? [["messagePage", String(messagePage)]] : []),
      ]).toString()}`
    : "";
  let selectedConversation: {
    id: string;
    label: string;
    secondaryLabel: string;
    tags?: Array<{
      label: string;
      color: string;
    }>;
    avatarUrl?: string | null;
    contactId?: string | null;
    contactName?: string | null;
    automationPaused?: boolean;
    loadMoreHref?: string | null;
    loadMoreCursor?: string | null;
    hasMoreMessages?: boolean;
    cacheKey?: string | null;
    isPreview?: boolean;
    messages: Array<{
        id: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        editedAt?: Date | null;
        deletedAt?: Date | null;
        authorType: "user" | "bot";
        outboundStatusLabel: string | null;
        type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
        mediaUrl?: string | null;
        rawPayload?: unknown;
      }>;
  } | null = null;

  if (selectedUnified?.source === "agent") {
    const selectedContactId = selectedUnified.contactId ?? null;
    const selectedTags = getConversationContextTags(selectedUnified.activeProductContext ?? null);
    const previewText = selectedUnified.lastMessage?.trim() || getConversationPreviewLabel(selectedUnified.lastMessageType);
    const previewDirection = selectedUnified.lastMessageDirection || "INBOUND";
    const previewCreatedAt = selectedUnified.lastMessageAt ?? new Date();

    // Cargamos los últimos 10 mensajes en el servidor para que el chat aparezca completo
    // y con scroll abajo desde el primer pintado (sin esperar al fetch de /live). El /live
    // solo queda para realtime/refresco. Los mediaUrl van tal cual están guardados (la
    // resolución/auto-reparación pesada la hace el /live de seguimiento, ~2.5s después).
    const detail = await loadAgentConversationDetail({
      workspaceId: membership.workspace.id,
      conversationId: selectedUnified.conversationId,
      batchSize: 10,
    });

    const detailMessages = detail?.messages.map((message) => ({
      id: message.id,
      content: message.content,
      direction: message.direction,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      authorType: (message.direction === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
      outboundStatusLabel: null,
      type: (message.type ?? "TEXT") as NonNullable<UnifiedConversation["lastMessageType"]>,
      mediaUrl: message.mediaUrl,
      rawPayload: message.rawPayload,
    }));

    const previewMessages = previewText
      ? [{
          id: `${selectedUnified.key}:preview`,
          content: previewText,
          direction: previewDirection,
          createdAt: previewCreatedAt,
          authorType: (previewDirection === "OUTBOUND" ? "bot" : "user") as "user" | "bot",
          outboundStatusLabel: null,
          type: (selectedUnified.lastMessageType ?? "TEXT") as NonNullable<UnifiedConversation["lastMessageType"]>,
          mediaUrl: null,
          rawPayload: null,
        }]
      : [];

    const hasRealMessages = Boolean(detailMessages && detailMessages.length > 0);

    selectedConversation = {
      id: selectedUnified.conversationId,
      label: selectedUnified.label,
      secondaryLabel: selectedUnified.secondaryLabel,
      tags: selectedUnified.tags ?? selectedTags,
      avatarUrl: selectedUnified.avatarUrl ?? null,
      contactId: selectedContactId,
      contactName: selectedUnified.label,
      automationPaused: detail?.automationPaused ?? selectedAgentConversation?.automationPaused ?? false,
      cacheKey: selectedUnified.key,
      messages: hasRealMessages ? detailMessages! : previewMessages,
      hasMoreMessages: hasRealMessages ? Boolean(detail?.hasMoreMessages) : false,
      loadMoreCursor: hasRealMessages ? detail?.loadMoreCursor ?? null : null,
      loadMoreHref: null,
      // Si trajimos mensajes reales NO es preview: el chat se muestra completo de una.
      isPreview: !hasRealMessages,
    };
  }

  // Etapa actual del CRM para el contacto de la conversación seleccionada.
  const selectedContactId = selectedConversation?.contactId ?? null;
  const selectedContactCrmStage = selectedContactId
    ? await (async () => {
        try {
          const rows = await prisma.$queryRaw<Array<{ crmStage: string }>>`
            SELECT c."crmStage"::text AS "crmStage"
            FROM "Contact" c
            WHERE c."id" = ${selectedContactId}
              AND c."workspaceId" = ${membership.workspace.id}
            LIMIT 1
          `;
          return rows[0]?.crmStage ?? "NUEVO";
        } catch {
          return "NUEVO";
        }
      })()
    : "NUEVO";

  const selectedConversationPhoneNumber = normalizePhoneFromJid(selectedConversation?.secondaryLabel ?? null) ?? normalizePhoneDigits(selectedConversation?.secondaryLabel);
  const selectedConversationStatusMessages = await (async () => {
    const databaseStatusMessages = selectedConversation?.id
      ? (
          await prisma.message.findMany({
            where: {
              workspaceId: membership.workspace.id,
              conversationId: selectedConversation.id,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 20,
            select: {
              id: true,
              content: true,
              type: true,
              createdAt: true,
              mediaUrl: true,
              rawPayload: true,
            },
          })
        )
          .filter((message) => isEvolutionStatusBroadcastPayload(message.rawPayload))
          .slice(0, 8)
          .map((message) => ({
            id: message.id,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
            mediaUrl: message.mediaUrl,
          }))
      : [];

    if (!selectedEvolutionInstanceName || !evolutionSettings.apiBaseUrl || !evolutionSettings.apiToken) {
      return databaseStatusMessages;
    }

    // Velocidad: el fetch de estados a Evolution es una llamada externa que bloquea el
    // render del chat. Las historias llegan por webhook y quedan persistidas, así que solo
    // hacemos la llamada en vivo cuando el contacto YA tiene estados en BD (para enriquecer);
    // si no hay ninguno, abrimos el chat al instante sin esa llamada.
    if (databaseStatusMessages.length === 0) {
      return databaseStatusMessages;
    }

    try {
      const response = await fetch(`${evolutionSettings.apiBaseUrl}/messages/fetch/${encodeURIComponent(selectedEvolutionInstanceName)}`, {
        method: "GET",
        headers: {
          apikey: evolutionSettings.apiToken,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        // Cap de seguridad: nunca bloquear la apertura del chat más de 1.5s por estados.
        signal: AbortSignal.timeout(1500),
      });

      if (!response.ok) {
        return databaseStatusMessages;
      }

      const payload = await response.json().catch(() => null);
      const liveStatusMessages = extractEvolutionPayloadList(payload)
        .filter((message) => isEvolutionStatusBroadcastPayload(message))
        .filter((message) => {
          if (!selectedConversationPhoneNumber) {
            return true;
          }

          const messagePhoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(message) ?? null) ?? normalizePhoneDigits(extractEvolutionPhoneNumber(message));
          return messagePhoneNumber ? messagePhoneNumber === selectedConversationPhoneNumber : false;
        })
        .slice(0, 8)
        .map((message, index) => {
          const rawMessage = message as Record<string, unknown>;
          const content =
            typeof rawMessage.content === "string"
              ? rawMessage.content
              : typeof rawMessage.text === "string"
                ? rawMessage.text
                : typeof rawMessage.caption === "string"
                  ? rawMessage.caption
                  : null;
          const createdAtValue =
            typeof rawMessage.createdAt === "string" || rawMessage.createdAt instanceof Date
              ? new Date(rawMessage.createdAt)
              : new Date();
          const id =
            typeof rawMessage.id === "string" && rawMessage.id.trim()
              ? rawMessage.id
              : typeof rawMessage.messageId === "string" && rawMessage.messageId.trim()
                ? rawMessage.messageId
                : `live-status-${index}`;

          return {
            id,
            content,
            type:
              typeof rawMessage.type === "string" && rawMessage.type.trim()
                ? (rawMessage.type.toUpperCase() as "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE")
                : null,
            createdAt: createdAtValue,
            mediaUrl:
              typeof rawMessage.mediaUrl === "string" && rawMessage.mediaUrl.trim()
                ? rawMessage.mediaUrl
                : null,
          };
        });

      return liveStatusMessages.length > 0 ? liveStatusMessages : databaseStatusMessages;
    } catch {
      return databaseStatusMessages;
    }
  })();

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <ChatsAutoRefresh
        intervalMs={5000}
        enabled={Boolean(selectedUnified)}
        realtimeEnabled={chatsRealtimeSyncEnabled}
        selectedConversationKey={selectedUnified?.key ?? null}
      />
      <ChatsRealtimeSync
        enabled={chatsRealtimeSyncEnabled}
        apiBaseUrl={evolutionSettings.apiBaseUrl}
        apiKey={evolutionSettings.apiToken || null}
        instanceNames={realtimeInstanceNames}
        activeInstanceName={selectedEvolutionInstanceName}
        selectedConversationKey={selectedUnified?.key ?? null}
        selectedConversationPhoneNumber={selectedUnified?.source === "agent" ? selectedUnified.secondaryLabel : null}
        globalEventsEnabled={realtimeGlobalEventsEnabled}
      />
      <ChatIncomingNotifier enabled={chatsRealtimeSyncEnabled} />
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <SharedInbox
        searchAction="/cliente/chats"
        selectedConversationId={selectedUnified?.key ?? ""}
        mobileConversationActive={Boolean(selectedChatKeyParam)}
        selectedConnectionKey={selectedConnectionKey}
        sidebarItems={sidebarItems}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        isManager={isManager}
        initialConversationBatchSize={conversationListTake}
        initialHasMoreConversations={hasMoreConversationItems}
        conversationListApiPath="/api/cliente/chats/list"
        searchQuery={searchQuery}
        messageScrollBehavior={scrollMode === CHAT_MESSAGE_SCROLL_PRESERVE_QUERY ? "preserve" : "bottom"}
        statusMessages={selectedConversationStatusMessages}
        conversations={merged.map((item) => ({
          id: item.key,
          source: item.source,
          agentId: item.agentId ?? null,
          contactId: item.contactId ?? null,
          label: item.label,
          secondaryLabel: item.secondaryLabel,
          tags: item.tags ?? [],
          channelType: "whatsapp",
          incomingCount: item.incomingCount ?? 0,
          avatarUrl: item.avatarUrl ?? null,
          assignedToName: item.assignedToName ?? null,
          lastMessage: item.lastMessage,
          lastMessageType: item.lastMessageType ?? null,
          lastMessageDirection: item.lastMessageDirection,
          lastMessageAt: item.lastMessageAt,
          href: `/cliente/chats?chatKey=${encodeURIComponent(item.key)}${selectedConnectionKey ? `&connection=${encodeURIComponent(selectedConnectionKey)}` : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${assignedFilter !== "all" ? `&assigned=${assignedFilter}` : ""}${statusFilter !== "open" ? `&status=${statusFilter}` : ""}`,
        }))}
        selectedConversation={selectedConversation}
        selectedConversationTags={selectedConversation?.tags ?? []}
        backHref={chatListHref}
        headerBadge={null}
        headerActions={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <ChatHeaderActions
              key={`header-actions:${selectedConversation.id}:${selectedAgentConversation?.status ?? "OPEN"}`}
              contactId={selectedContactId ?? null}
              stage={selectedContactCrmStage as CrmStage}
              conversationId={selectedConversation.id}
              automationPaused={Boolean(selectedConversation.automationPaused)}
              status={selectedAgentConversation?.status ?? "OPEN"}
              returnTo={selectedChatHref}
              toggleAutomationAction={toggleConversationAutomationAction}
            />
          ) : null
        }
        contactPanelActions={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <AssignChatControl
              key={`panel-assign:${selectedConversation.id}`}
              conversationId={selectedConversation.id}
              assignee={selectedAgentConversation?.assignedTo ?? null}
            />
          ) : null
        }
        composer={{
          action: sendUnifiedChatReplyAction,
          hiddenFields: selectedUnified
            ? [
                { name: "source", value: selectedUnified.source },
                { name: "conversationId", value: selectedUnified.conversationId },
                { name: "agentId", value: selectedUnified.agentId ?? "" },
                ...(selectedChatHref ? [{ name: "returnTo", value: selectedChatHref }] : []),
              ]
            : [],
          audio:
            selectedUnified && selectedUnified.source === "agent" && selectedUnified.agentId
              ? {
                  uploadPath: "/api/cliente/chats/upload-audio",
                  source: selectedUnified.source,
                  conversationId: selectedUnified.conversationId,
                  agentId: selectedUnified.agentId,
                  returnTo: selectedChatHref ?? "",
                  sendAction: sendChatAudioReplyAction,
                }
              : undefined,
          media:
            selectedUnified && selectedUnified.source === "agent" && selectedUnified.agentId
              ? {
                  uploadPath: "/api/cliente/chats/upload-media",
                  source: selectedUnified.source,
                  conversationId: selectedUnified.conversationId,
                  agentId: selectedUnified.agentId,
                  returnTo: selectedChatHref ?? "",
                  sendAction: sendChatMediaReplyAction,
                }
              : undefined,
        }}
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription="Cuando lleguen mensajes por tus canales, apareceran aqui en una sola bandeja."
        emptySelectionTitle="Tus conversaciones"
        emptySelectionDescription="Selecciona un chat de la lista para comenzar"
      />
    </section>
  );
}
