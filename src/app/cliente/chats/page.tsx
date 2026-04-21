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
import { getConversationAutomationPaused } from "@/lib/conversation-automation";
import { fetchEvolutionMediaDataUrl, fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function getEvolutionPayloadRecord(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const record = rawPayload as Record<string, unknown>;
  const evolution = record.evolution;
  return evolution && typeof evolution === "object" ? (evolution as Record<string, unknown>) : record;
}

function getEvolutionMessageId(rawPayload: unknown) {
  const evolution = getEvolutionPayloadRecord(rawPayload);
  const data = evolution?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const key = (data as Record<string, unknown>).key;
  if (!key || typeof key !== "object") {
    return null;
  }

  const id = (key as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function getEvolutionMediaMimeType(rawPayload: unknown) {
  const evolution = getEvolutionPayloadRecord(rawPayload);
  const data = evolution?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const message = (data as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  for (const key of ["imageMessage", "audioMessage", "videoMessage", "documentMessage"] as const) {
    const mediaRecord = (message as Record<string, unknown>)[key];
    if (mediaRecord && typeof mediaRecord === "object") {
      const mimeType = (mediaRecord as Record<string, unknown>).mimetype;
      if (typeof mimeType === "string" && mimeType.trim()) {
        return mimeType.trim();
      }
    }
  }

  return null;
}

function shouldResolveEvolutionMediaUrl(mediaUrl?: string | null) {
  if (!mediaUrl) {
    return true;
  }

  return mediaUrl.includes("mmg.whatsapp.net") || mediaUrl.includes(".enc") || mediaUrl.startsWith("/");
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
      orderBy: { updatedAt: "desc" },
      take: 120,
      select: {
        id: true,
        agentId: true,
        channelId: true,
        contact: {
          select: { name: true, phoneNumber: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, direction: true, createdAt: true },
        },
      },
    }),
  ]);

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const selectedAgentConversation =
    selectedChatRef?.source === "agent"
      ? agentConversations.find((item) => item.id === selectedChatRef.conversationId) || null
      : null;
  const avatarLookups = [
    ...new Set(
      agentConversations
        .slice(0, 40)
        .map((conversation) => {
          const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
          const instanceName = linkedChannel?.evolutionInstanceName?.trim();
          const phoneNumber = conversation.contact.phoneNumber?.trim();
          return instanceName && phoneNumber ? `${instanceName}::${phoneNumber}` : "";
        })
        .filter(Boolean),
    ),
  ];
  const avatarUrls = Object.fromEntries(
    (
      await Promise.all(
        avatarLookups.map(async (lookupKey) => {
          const [instanceName, phoneNumber] = lookupKey.split("::");
          if (!instanceName || !phoneNumber) {
            return [lookupKey, null] as const;
          }

          return [
            lookupKey,
            await fetchEvolutionProfilePictureUrl({
              instanceName,
              phoneNumber,
            }),
          ] as const;
        }),
      )
    ).filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  const agentRows: UnifiedConversation[] = agentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const avatarLookupKey =
      linkedChannel?.evolutionInstanceName && conversation.contact.phoneNumber
        ? `${linkedChannel.evolutionInstanceName}::${conversation.contact.phoneNumber}`
        : "";

    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      channelId: conversation.channelId || undefined,
      label: getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      avatarUrl: (avatarLookupKey ? avatarUrls[avatarLookupKey] : null) ?? null,
      lastMessage: conversation.messages[0]?.content ?? null,
      lastMessageDirection: conversation.messages[0]?.direction ?? null,
      lastMessageAt: conversation.messages[0]?.createdAt ?? null,
    };
  });

  let officialRows: UnifiedConversation[] = [];
  let officialData: Awaited<ReturnType<typeof getOfficialApiChatsData>> | null = null;
  const officialChannel = channels.find((channel) => channel.provider === "OFFICIAL_API") ?? null;

  if (canUseOfficialApi) {
    officialData = await getOfficialApiChatsData({
      workspaceId: membership.workspace.id,
      conversationId: selectedChatRef?.source === "official" ? selectedChatRef.conversationId : "",
      q: searchQuery,
    });

    if (officialData.isConnected) {
      officialRows = officialData.conversations.map((conversation) => ({
        key: `official:${conversation.id}`,
        source: "official",
        conversationId: conversation.id,
        channelId: officialChannel?.id,
        label: getOfficialContactLabel(conversation.contact),
        secondaryLabel: conversation.contact.phoneNumber || conversation.contact.waId,
        avatarUrl: null,
        lastMessage: conversation.lastMessage?.content ?? null,
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
    const detail = await prisma.conversation.findFirst({
      where: {
        id: selectedUnified.conversationId,
        workspaceId: membership.workspace.id,
      },
        select: {
          id: true,
          agentId: true,
          channel: {
            select: {
              evolutionInstanceName: true,
            },
          },
          contact: { select: { name: true, phoneNumber: true } },
          messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, content: true, direction: true, createdAt: true, rawPayload: true, type: true, mediaUrl: true },
        },
      },
    });

    if (detail) {
      const automationPaused = await getConversationAutomationPaused({
        conversationId: detail.id,
        workspaceId: membership.workspace.id,
      });

      selectedConversation = {
        id: detail.id,
        label: getAgentContactLabel(detail.contact),
        secondaryLabel: detail.contact.phoneNumber,
        avatarUrl: selectedUnified.avatarUrl ?? null,
        automationPaused,
        messages: await Promise.all(detail.messages.map(async (message) => {
          const outbound = message.direction === "OUTBOUND";
          const isManualOutbound =
            outbound &&
            typeof message.rawPayload === "object" &&
            message.rawPayload !== null &&
            "source" in message.rawPayload &&
            (message.rawPayload.source === "manual" || message.rawPayload.source === "instance");
          const resolvableMediaType =
            message.type === "IMAGE" || message.type === "AUDIO" || message.type === "VIDEO" || message.type === "DOCUMENT"
              ? message.type
              : null;
          const shouldResolveMedia =
            Boolean(resolvableMediaType) &&
            shouldResolveEvolutionMediaUrl(message.mediaUrl);
          const evolutionMessageId = getEvolutionMessageId(message.rawPayload);
          const resolvedMediaUrl =
            shouldResolveMedia && detail.channel?.evolutionInstanceName && evolutionMessageId && resolvableMediaType
              ? await fetchEvolutionMediaDataUrl({
                  instanceName: detail.channel.evolutionInstanceName,
                  messageId: evolutionMessageId,
                  mediaType: resolvableMediaType,
                  mimeType: getEvolutionMediaMimeType(message.rawPayload),
                })
              : null;
          return {
            id: message.id,
            content: message.content,
            direction: message.direction,
            createdAt: message.createdAt,
            authorType: outbound ? (isManualOutbound ? "user" : "bot") : "user",
            outboundStatusLabel: outbound ? "entregado" : null,
            type: message.type,
            mediaUrl: resolvedMediaUrl || message.mediaUrl,
            rawPayload: message.rawPayload,
          };
        })),
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
      <ChatsAutoRefresh intervalMs={5000} />
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
          lastMessageDirection: item.lastMessageDirection,
          lastMessageAt: item.lastMessageAt,
          href: `/cliente/chats?chatKey=${encodeURIComponent(item.key)}${selectedConnectionKey ? `&connection=${encodeURIComponent(selectedConnectionKey)}` : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`,
        }))}
        selectedConversation={selectedConversation}
        backHref="/cliente/chats"
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
