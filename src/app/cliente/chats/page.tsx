import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sendUnifiedChatReplyAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Card } from "@/components/ui/card";
import { OfficialApiLockedState, getOfficialApiChatsData } from "@/features/official-api";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { fetchEvolutionMediaDataUrl, fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const INITIAL_CHAT_MESSAGE_LIMIT = 20;

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
  avatarUrl?: string | null;
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

function parseChatKey(input: string): { source: "agent" | "official"; conversationId: string } | null {
  if (!input) return null;
  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");
  if ((source === "agent" || source === "official") && conversationId) {
    return { source, conversationId };
  }
  return null;
}

function shouldResolveEvolutionMedia(mediaUrl?: string | null) {
  if (!mediaUrl) {
    return true;
  }

  const normalized = mediaUrl.toLowerCase();
  if (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  ) {
    return normalized.includes("mmg.whatsapp.net") || normalized.includes(".enc");
  }

  return normalized.includes("mmg.whatsapp.net") || normalized.includes(".enc");
}

function getRenderableEvolutionMessageId(input: { externalId?: string | null; id: string }) {
  return input.externalId?.trim() || input.id;
}

function getEvolutionMediaTypeForMessage(input: { type?: string | null }) {
  if (input.type === "AUDIO") return "AUDIO" as const;
  if (input.type === "VIDEO") return "VIDEO" as const;
  if (input.type === "DOCUMENT") return "DOCUMENT" as const;
  return "IMAGE" as const;
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

  const params = await searchParams;
  const selectedChatKeyParam = typeof params.chatKey === "string" ? params.chatKey : "";
  const selectedConnectionParam = typeof params.connection === "string" ? params.connection : "";
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const selectedChatRef = parseChatKey(selectedChatKeyParam);

  const canUseOfficialApi = await canAccessOfficialApiModule(session.user.id, session.user.role);
  const selectedAgentConversationId = selectedChatRef?.source === "agent" ? selectedChatRef.conversationId : "";
  const selectedAgentConversationPromise =
    selectedAgentConversationId
      ? prisma.conversation.findFirst({
          where: {
            id: selectedAgentConversationId,
            workspaceId: membership.workspace.id,
          },
          select: {
            id: true,
            agentId: true,
            automationPaused: true,
            channel: {
              select: {
                evolutionInstanceName: true,
              },
            },
            contact: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: INITIAL_CHAT_MESSAGE_LIMIT,
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
            },
          },
        })
      : null;
  const officialDataPromise =
    canUseOfficialApi
      ? getOfficialApiChatsData({
          workspaceId: membership.workspace.id,
          conversationId: selectedChatRef?.source === "official" ? selectedChatRef.conversationId : "",
          q: searchQuery,
          includeSelectedConversation: selectedChatRef?.source === "official",
        })
      : null;

  const [channels, agentConversations] = await Promise.all([
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
          select: { id: true, name: true, phoneNumber: true, avatarUrl: true },
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
  const selectedAgentConversation =
    selectedChatRef?.source === "agent"
      ? agentConversations.find((item) => item.id === selectedChatRef.conversationId) || null
      : null;

  // Fetch avatars only for contacts without cached avatarUrl (max 10 per load)
  // Selected conversation contact gets priority so it always appears in the list
  const uncachedConversations = agentConversations.filter((c) => !c.contact.avatarUrl);
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

  const agentRows: UnifiedConversation[] = agentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const avatarUrl = conversation.contact.avatarUrl ?? null;

    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      channelId: conversation.channelId || undefined,
      label: getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      avatarUrl,
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
      if (!selectedConnectionKey) return true;
      if (selectedConnectionKey.startsWith("channel:")) {
        const channelId = selectedConnectionKey.slice("channel:".length);
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
  const chatListHref = `/cliente/chats${
    selectedConnectionKey || searchQuery
      ? `?${new URLSearchParams([
          ...(selectedConnectionKey ? [["connection", selectedConnectionKey]] : []),
          ...(searchQuery ? [["q", searchQuery]] : []),
        ]).toString()}`
      : ""
  }`;
  const isOfficialUnavailable = Boolean(canUseOfficialApi && officialChannel && officialData && !officialData.isConnected);
  const isOfficialConnectionSelected =
    Boolean(selectedConnectionKey) &&
    officialChannel !== null &&
    selectedConnectionKey === `channel:${officialChannel.id}`;

  let selectedConversation: {
    id: string;
    label: string;
    secondaryLabel: string;
    avatarUrl?: string | null;
    automationPaused?: boolean;
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
    const detail = selectedAgentConversationPromise ? await selectedAgentConversationPromise : null;

    if (detail) {
      const detailChannel = detail.channel?.evolutionInstanceName
        ? { evolutionInstanceName: detail.channel.evolutionInstanceName }
        : selectedUnified.channelId
          ? channelsById.get(selectedUnified.channelId) || null
          : null;

      const resolvedMessages = await Promise.all(
        detail.messages.slice().reverse().map(async (message) => {
          const outbound = message.direction === "OUTBOUND";
          const isManualOutbound =
            outbound &&
            typeof message.rawPayload === "object" &&
            message.rawPayload !== null &&
            "source" in message.rawPayload &&
            (message.rawPayload.source === "manual" || message.rawPayload.source === "instance");

          const shouldResolveMedia =
            Boolean(detailChannel?.evolutionInstanceName) &&
            ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT"].includes(message.type || "") &&
            shouldResolveEvolutionMedia(message.mediaUrl);

          const resolvedMediaUrl =
            shouldResolveMedia && detailChannel?.evolutionInstanceName
              ? (await fetchEvolutionMediaDataUrl({
                  instanceName: detailChannel.evolutionInstanceName,
                  messageId: getRenderableEvolutionMessageId(message),
                  mediaType: getEvolutionMediaTypeForMessage({ type: message.type }),
                  mimeType:
                    message.type === "AUDIO"
                      ? "audio/ogg"
                      : message.type === "VIDEO"
                        ? "video/mp4"
                        : message.type === "DOCUMENT"
                          ? "application/octet-stream"
                          : "image/jpeg",
                })) || message.mediaUrl
              : message.mediaUrl;

          return {
            id: message.id,
            content: message.content,
            direction: message.direction,
            createdAt: message.createdAt,
            authorType: (outbound ? (isManualOutbound ? "user" : "bot") : "user") as "user" | "bot",
            outboundStatusLabel: outbound ? "entregado" : null,
            type: message.type,
            mediaUrl: resolvedMediaUrl,
            rawPayload: message.rawPayload,
          };
        }),
      );

      const avatarUrl = detail.contact.avatarUrl ?? selectedUnified.avatarUrl ?? null;
      if (!detail.contact.avatarUrl && detailChannel?.evolutionInstanceName && detail.contact.phoneNumber) {
        void fetchEvolutionProfilePictureUrl({
          instanceName: detailChannel.evolutionInstanceName,
          phoneNumber: detail.contact.phoneNumber,
        }).then((fetchedAvatar) => {
          if (fetchedAvatar) {
            void prisma.contact.update({ where: { id: detail.contact.id }, data: { avatarUrl: fetchedAvatar } });
          }
        }).catch(() => null);
      }

      selectedConversation = {
        id: detail.id,
        label: getAgentContactLabel(detail.contact),
        secondaryLabel: detail.contact.phoneNumber,
        avatarUrl,
        automationPaused: "automationPaused" in detail ? detail.automationPaused : false,
        messages: resolvedMessages,
      };
    }
  }

  if (selectedUnified?.source === "official" && officialData?.selectedConversation) {
    selectedConversation = {
      id: officialData.selectedConversation.id,
      label: getOfficialContactLabel(officialData.selectedConversation.contact),
      secondaryLabel:
        officialData.selectedConversation.contact.phoneNumber || officialData.selectedConversation.contact.waId,
      avatarUrl: null,
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
      <ChatsAutoRefresh intervalMs={15000} enabled={Boolean(selectedUnified)} />
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
        conversations={merged.map((item) => ({
          id: item.key,
          label: item.label,
          secondaryLabel: item.secondaryLabel,
          channelType: item.source === "official" ? "whatsapp_official" : "whatsapp",
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
            <FormActionSwitch
              action={toggleConversationAutomationAction}
              checked={!selectedConversation.automationPaused}
              ariaLabel={selectedConversation.automationPaused ? "Reactivar IA" : "Pausar IA"}
              hiddenFields={[
                { name: "conversationId", value: selectedConversation.id },
                { name: "returnTo", value: `/cliente/chats?chatKey=${encodeURIComponent(selectedUnified.key)}` },
              ]}
            />
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
