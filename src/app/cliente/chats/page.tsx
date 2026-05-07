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
import { Card } from "@/components/ui/card";
import { OfficialApiLockedState, getOfficialApiChatsData } from "@/features/official-api";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
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
  source: "agent" | "official";
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
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
};

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getOfficialContactLabel(input: { name: string | null; phoneNumber: string | null; waId: string }) {
  return input.name?.trim() || input.phoneNumber?.trim() || input.waId;
}

function getContactTags(
  input: Array<{ name: string; color: string }>,
) {
  return input
    .filter((tag): tag is { name: string; color: string } => Boolean(tag?.name?.trim()))
    .map((tag) => ({
      label: tag.name,
      color: tag.color,
    }));
}

function parseChatKey(input: string): { source: "agent" | "official"; conversationId: string } | null {
  if (!input) return null;
  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");
  if ((source === "agent" || source === "official") && conversationId) {
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

  const canUseOfficialApiPromise = canAccessOfficialApiModule(session.user.id, session.user.role);
  const officialDataPromise = canUseOfficialApiPromise.then((canUseOfficialApi) =>
    canUseOfficialApi
      ? getOfficialApiChatsData({
          workspaceId: membership.workspace.id,
          conversationId: selectedChatRef?.source === "official" ? selectedChatRef.conversationId : "",
          q: searchQuery,
          includeSelectedConversation: selectedChatRef?.source === "official",
        })
      : null,
  );

  const [canUseOfficialApi, evolutionSettings, channels, agentConversations] = await Promise.all([
    canUseOfficialApiPromise,
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
      where: {
        workspaceId: membership.workspace.id,
        OR: [
          {
            agentId: { not: null },
          },
          {
            channel: {
              is: {
                provider: "EVOLUTION",
              },
            },
          },
        ],
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 120,
      select: {
        id: true,
        agentId: true,
        channelId: true,
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
            externalId: true,
            content: true,
            direction: true,
            createdAt: true,
            type: true,
            rawPayload: true,
            mediaUrl: true,
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
  const activeAgentConversations = agentConversations.filter((conv) => {
    if (!conv.channelId) return true;
    return channelsById.has(conv.channelId);
  });

  const contactIds = Array.from(new Set(activeAgentConversations.map((conversation) => conversation.contact.id)));
  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
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

  const agentIncomingCountRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        incomingCount: number;
      }>>`
        SELECT
          c."id" AS "conversationId",
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount"
        FROM "Conversation" c
        LEFT JOIN LATERAL (
          SELECT MAX(mo."createdAt") AS "lastOutboundAt"
          FROM "Message" mo
          WHERE mo."conversationId" = c."id"
            AND mo."direction" = 'OUTBOUND'
        ) lo ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "incomingCount"
          FROM "Message" mi
          WHERE mi."conversationId" = c."id"
            AND mi."direction" = 'INBOUND'
            AND mi."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
        ) incoming ON true
        WHERE c."workspaceId" = ${membership.workspace.id}
          AND c."id" IN (${Prisma.join(activeAgentConversationIds)})
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        incomingCount: number;
      }>);

  const [contactTagRows, agentIncomingCountRows] = await Promise.all([
    contactTagRowsPromise,
    agentIncomingCountRowsPromise,
  ]);

  const contactTagsByContactId = new Map<string, Array<{ name: string; color: string }>>();
  for (const row of contactTagRows) {
    const current = contactTagsByContactId.get(row.contactId) || [];
    current.push({ name: row.name, color: row.color });
    contactTagsByContactId.set(row.contactId, current);
  }

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
    const tags = getContactTags(contactTagsByContactId.get(conversation.contact.id) || []);

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
      lastMessage: conversation.messages[0]?.content ?? null,
      lastMessageType: conversation.messages[0]?.type ?? null,
      lastMessageDirection: conversation.messages[0]?.direction ?? null,
      lastMessageAt: conversation.messages[0]?.createdAt ?? null,
    };
  });

  let officialRows: UnifiedConversation[] = [];
  let officialData: Awaited<ReturnType<typeof getOfficialApiChatsData>> | null = null;
  const officialChannel = channels.find((channel) => channel.provider === "OFFICIAL_API") ?? null;

  if (canUseOfficialApi) {
    officialData = officialDataPromise ? await officialDataPromise : null;

    if (officialData && officialData.isConnected) {
      officialRows = officialData.conversations.map((conversation) => ({
        key: `official:${conversation.id}`,
        source: "official",
        conversationId: conversation.id,
        channelId: officialChannel?.id,
        label: getOfficialContactLabel(conversation.contact),
        secondaryLabel: conversation.contact.phoneNumber || conversation.contact.waId,
        avatarUrl: null,
        incomingCount: conversation.incomingCount ?? 0,
        lastMessage: conversation.lastMessage?.content ?? null,
        lastMessageType: conversation.lastMessage?.type ?? null,
        lastMessageDirection: conversation.lastMessage?.direction ?? null,
        lastMessageAt: conversation.lastMessage?.createdAt ?? null,
      }));
    }
  }

  const inferredConnectionKey =
    selectedChatRef?.source === "agent"
      ? selectedAgentConversation?.channelId
        ? `channel:${selectedAgentConversation.channelId}`
        : ""
      : selectedChatRef?.source === "official"
        ? officialChannel?.id
          ? `channel:${officialChannel.id}`
          : ""
        : "";

  const selectedConnectionKey = selectedConnectionParam || inferredConnectionKey;

  const merged = [...agentRows, ...officialRows]
    .filter((item) => {
      if (!selectedConnectionParam) return true;
      if (selectedConnectionParam.startsWith("channel:")) {
        const channelId = selectedConnectionParam.slice("channel:".length);
        return item.channelId === channelId;
      }
      return true;
    })
    .filter((item) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.label.toLowerCase().includes(q) ||
        item.secondaryLabel.toLowerCase().includes(q) ||
        (item.lastMessage || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const left = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
      const right = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
      return right - left;
    });

  const selectedUnified = merged.find((item) => item.key === selectedChatKeyParam) || merged[0] || null;
  const selectedEvolutionInstanceName =
    selectedUnified?.source === "agent" && selectedUnified.channelId
      ? channelsById.get(selectedUnified.channelId)?.evolutionInstanceName?.trim() || null
      : null;
  const chatListHref = `/cliente/chats${
    selectedConnectionKey || searchQuery
      ? `?${new URLSearchParams([
          ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
          ...(searchQuery ? [["q", searchQuery]] : []),
        ]).toString()}`
      : ""
  }`;
  const evolutionGlobalWebsocketEventsEnabled = process.env.WEBSOCKET_GLOBAL_EVENTS === "true";
  const isOfficialUnavailable = Boolean(canUseOfficialApi && officialChannel && officialData && !officialData.isConnected);
  const isOfficialConnectionSelected =
    Boolean(selectedConnectionKey) &&
    officialChannel !== null &&
    selectedConnectionKey === `channel:${officialChannel.id}`;
  const selectedChatHref = selectedUnified
    ? `/cliente/chats?${new URLSearchParams([
        ["chatKey", selectedUnified.key],
        ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
        ...(searchQuery ? [["q", searchQuery]] : []),
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
    cacheKey?: string | null;
    messages: Array<{
        id: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        authorType: "user" | "bot";
        outboundStatusLabel: string | null;
        type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
        mediaUrl?: string | null;
        rawPayload?: unknown;
      }>;
  } | null = null;

  if (selectedUnified?.source === "agent") {
    const selectedContactId = selectedUnified.contactId ?? null;
    const selectedTags = selectedContactId ? getContactTags(contactTagsByContactId.get(selectedContactId) || []) : [];

    selectedConversation = {
      id: selectedUnified.conversationId,
      label: selectedUnified.label,
      secondaryLabel: selectedUnified.secondaryLabel,
      tags: selectedTags,
      avatarUrl: selectedUnified.avatarUrl ?? null,
      contactId: selectedContactId,
      contactName: selectedUnified.label,
      automationPaused: false,
      cacheKey: selectedUnified.key,
      messages: [],
      loadMoreHref: null,
      loadMoreCursor: null,
    };
  }

  if (selectedUnified?.source === "official" && officialData?.selectedConversation) {
    selectedConversation = {
      id: officialData.selectedConversation.id,
      label: getOfficialContactLabel(officialData.selectedConversation.contact),
      secondaryLabel:
        officialData.selectedConversation.contact.phoneNumber || officialData.selectedConversation.contact.waId,
      avatarUrl: null,
      cacheKey: selectedUnified.key,
      messages: officialData.selectedConversation.messages.map((message) => ({
        id: message.id,
        content: message.content,
        direction: message.direction,
        createdAt: message.createdAt,
        authorType: "user",
        outboundStatusLabel:
          message.direction === "OUTBOUND"
            ? message.status === "READ"
              ? "visto"
              : "enviado"
            : null,
        type: message.type,
        mediaUrl: message.mediaUrl,
        rawPayload: message.rawPayload,
      })),
    };
  }

  return (
    <section className="chat-app-layout flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <ChatsAutoRefresh intervalMs={5000} selectedConversationKey={selectedUnified?.key ?? null} />
      <ChatsRealtimeSync
        enabled={Boolean(selectedUnified)}
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
        selectedConnectionKey={selectedConnectionKey}
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
          channelType: item.source === "official" ? "whatsapp_official" : "whatsapp",
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
        composer={
          selectedUnified
            ? {
                action: sendUnifiedChatReplyAction,
                hiddenFields: [
                  { name: "source", value: selectedUnified.source },
                  { name: "conversationId", value: selectedUnified.conversationId },
                  { name: "agentId", value: selectedUnified.agentId ?? "" },
                  ...(selectedChatHref ? [{ name: "returnTo", value: selectedChatHref }] : []),
                ],
              }
            : undefined
        }
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription={
          isOfficialConnectionSelected && isOfficialUnavailable
            ? "Este canal oficial todavia no esta disponible. Mientras tanto, puedes seguir usando los otros canales."
            : "Cuando lleguen mensajes por tus canales, apareceran aqui en una sola bandeja."
        }
        emptySelectionTitle={isOfficialConnectionSelected && isOfficialUnavailable ? "Canal oficial no disponible" : "Selecciona una conversacion"}
        emptySelectionDescription={
          isOfficialConnectionSelected && isOfficialUnavailable
            ? "Habla con un administrador para activar la API oficial en este workspace."
            : "Elige un chat de la columna izquierda para ver el historial y responder desde el panel."
        }
      />

      {isOfficialUnavailable ? (
        <OfficialApiLockedState
          title="Api oficial no disponible"
          description="La bandeja sigue activa para tus otros canales, pero la API oficial aun no esta conectada."
          workspaceName={membership.workspace.name}
        />
      ) : null}

      {!canUseOfficialApi && isOfficialConnectionSelected ? (
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 text-sm text-slate-600">
          No tienes acceso al canal de API oficial. Solo veras chats de agentes.
        </Card>
      ) : null}
    </section>
  );
}
