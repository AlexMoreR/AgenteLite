import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { after } from "next/server";
import { sendUnifiedChatReplyAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { ClearChatButton } from "@/components/chats/clear-chat-button";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { ChatsRealtimeSync } from "@/components/chats/chats-realtime-sync";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { getEvolutionSettings } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
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
  lastMessage: string | null;
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
  activeProductContext?: ActiveProductContextSummary | null;
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
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
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
        last_outbound AS (
          SELECT
            m."conversationId",
            MAX(m."createdAt") AS "lastOutboundAt"
          FROM "Message" m
          WHERE m."workspaceId" = ${membership.workspace.id}
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
          WHERE m."workspaceId" = ${membership.workspace.id}
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
      avatarUrl,
      incomingCount: agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestAgentMessageByConversationId.get(conversation.id)?.deletedAt ? "Mensaje eliminado" : latestAgentMessageByConversationId.get(conversation.id)?.content ?? null,
      lastMessageType: latestAgentMessageByConversationId.get(conversation.id)?.type ?? null,
      lastMessageDirection: latestAgentMessageByConversationId.get(conversation.id)?.direction ?? null,
      lastMessageAt: latestAgentMessageByConversationId.get(conversation.id)?.createdAt ?? null,
      activeProductContext,
    };
  });

  const selectedConnectionKey = selectedConnectionParam;
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
  const selectedConversationDetailPromise =
    selectedUnified?.source === "agent"
      ? loadAgentConversationDetail({
          workspaceId: membership.workspace.id,
          conversationId: selectedUnified.conversationId,
        })
      : Promise.resolve(null);
  const selectedEvolutionInstanceName =
    selectedUnified?.source === "agent" && selectedUnified.channelId
      ? channelsById.get(selectedUnified.channelId)?.evolutionInstanceName?.trim() || null
      : null;
  const evolutionGlobalWebsocketEventsEnabled = process.env.WEBSOCKET_GLOBAL_EVENTS === "true";
  const chatsRealtimeSyncEnabled = Boolean(
    evolutionSettings.apiBaseUrl &&
      evolutionSettings.apiToken &&
      (evolutionGlobalWebsocketEventsEnabled || evolutionInstanceNames.length > 0),
  );
  const chatListHref = `/cliente/chats${
    selectedConnectionKey || searchQuery
      ? `?${new URLSearchParams([
          ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
          ...(searchQuery ? [["q", searchQuery]] : []),
        ]).toString()}`
      : ""
  }`;
  const selectedChatHref = selectedUnified
    ? `/cliente/chats?${new URLSearchParams([
        ["chatKey", selectedUnified.key],
        ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
        ...(searchQuery ? [["q", searchQuery]] : []),
        ...(messagePage > 1 ? [["messagePage", String(messagePage)]] : []),
      ]).toString()}`
    : "";
  const selectedConversationDetail = await selectedConversationDetailPromise;

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

    if (selectedConversationDetail) {
      selectedConversation = {
        id: selectedConversationDetail.id,
        label: selectedUnified.label,
        secondaryLabel: selectedUnified.secondaryLabel,
        tags: selectedTags,
        avatarUrl: selectedConversationDetail.contact.avatarUrl ?? selectedUnified.avatarUrl ?? null,
        contactId: selectedConversationDetail.contact.id,
        contactName: selectedConversationDetail.contact.name?.trim() || selectedUnified.label,
        automationPaused: selectedConversationDetail.automationPaused,
        cacheKey: selectedUnified.key,
        messages: selectedConversationDetail.messages.map((message) => ({
          id: message.id,
          content: message.content,
          direction: message.direction,
          createdAt: message.createdAt,
          editedAt: message.editedAt,
          deletedAt: message.deletedAt,
          authorType: message.direction === "OUTBOUND" ? "bot" : "user",
          outboundStatusLabel: null,
          type: message.type ?? undefined,
          mediaUrl: message.mediaUrl,
          rawPayload: message.rawPayload ?? null,
        })),
        hasMoreMessages: selectedConversationDetail.hasMoreMessages,
        loadMoreCursor: selectedConversationDetail.loadMoreCursor,
        loadMoreHref: null,
      };
    } else {
      selectedConversation = {
        id: selectedUnified.conversationId,
        label: selectedUnified.label,
        secondaryLabel: selectedUnified.secondaryLabel,
        tags: selectedTags,
        avatarUrl: selectedUnified.avatarUrl ?? null,
        contactId: selectedContactId,
        contactName: selectedUnified.label,
        automationPaused: selectedAgentConversation?.automationPaused ?? false,
        cacheKey: selectedUnified.key,
        messages: [],
        hasMoreMessages: false,
        loadMoreCursor: null,
        loadMoreHref: null,
      };
    }
  }

  return (
    <section className="chat-app-layout flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
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
        instanceNames={evolutionInstanceNames}
        activeInstanceName={selectedEvolutionInstanceName}
        selectedConversationKey={selectedUnified?.key ?? null}
        selectedConversationPhoneNumber={selectedUnified?.source === "agent" ? selectedUnified.secondaryLabel : null}
        globalEventsEnabled={evolutionGlobalWebsocketEventsEnabled}
      />
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
        initialConversationBatchSize={conversationListTake}
        initialHasMoreConversations={hasMoreConversationItems}
        conversationListApiPath="/api/cliente/chats/list"
        searchQuery={searchQuery}
        messageScrollBehavior={scrollMode === CHAT_MESSAGE_SCROLL_PRESERVE_QUERY ? "preserve" : "bottom"}
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
          lastMessage: item.lastMessage,
          lastMessageType: item.lastMessageType ?? null,
          lastMessageDirection: item.lastMessageDirection,
          lastMessageAt: item.lastMessageAt,
          href: `/cliente/chats?chatKey=${encodeURIComponent(item.key)}${selectedConnectionKey ? `&connection=${encodeURIComponent(selectedConnectionKey)}` : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`,
        }))}
        selectedConversation={selectedConversation}
        backHref={chatListHref}
        headerBadge={null}
        headerActions={
          selectedUnified?.source === "agent" && selectedConversation ? (
            <div key={`header-actions:${selectedConversation.id}`} className="flex items-center gap-1">
              <ClearChatButton
                conversationId={selectedConversation.id}
                returnTo={selectedChatHref}
              />
              <FormActionSwitch
                action={toggleConversationAutomationAction}
                checked={!selectedConversation.automationPaused}
                ariaLabel={selectedConversation.automationPaused ? "Reactivar IA" : "Pausar IA"}
                hiddenFields={[
                  { name: "conversationId", value: selectedConversation.id },
                  { name: "returnTo", value: selectedChatHref },
                ]}
              />
            </div>
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
        }}
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription="Cuando lleguen mensajes por tus canales, apareceran aqui en una sola bandeja."
        emptySelectionTitle="Selecciona una conversacion"
        emptySelectionDescription="Elige un chat de la columna izquierda para ver el historial y responder desde el panel."
      />
    </section>
  );
}
