import { redirect } from "next/navigation";
import { BadgeCheck, MessageCircle } from "lucide-react";
import { auth } from "@/auth";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Card } from "@/components/ui/card";
import { OfficialApiLockedState, getOfficialApiChatsData } from "@/features/official-api";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type UnifiedConversation = {
  key: string;
  source: "agent" | "official";
  conversationId: string;
  agentId?: string;
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
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const selectedChatRef = parseChatKey(selectedChatKeyParam);

  const canUseOfficialApi = await canAccessOfficialApiModule(session.user.id, session.user.role);

  const [agents, agentConversations] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId: membership.workspace.id },
      select: {
        id: true,
        name: true,
        status: true,
        channels: {
          where: { provider: "EVOLUTION" },
          orderBy: { createdAt: "asc" },
          select: { evolutionInstanceName: true },
          take: 1,
        },
      },
    }),
    prisma.conversation.findMany({
      where: {
        workspaceId: membership.workspace.id,
        agentId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 120,
      select: {
        id: true,
        agentId: true,
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

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const selectedAgent =
    selectedChatRef?.source === "agent"
      ? agentById.get(agentConversations.find((item) => item.id === selectedChatRef.conversationId)?.agentId || "") || null
      : null;

  const avatarPhoneNumbers = [
    ...new Set(agentConversations.slice(0, 20).map((conversation) => conversation.contact.phoneNumber)),
  ];
  const selectedInstanceName = selectedAgent?.channels[0]?.evolutionInstanceName ?? null;
  const avatarUrls = selectedInstanceName
    ? Object.fromEntries(
        (
          await Promise.all(
            avatarPhoneNumbers.map(async (phoneNumber) => [
              phoneNumber,
              await fetchEvolutionProfilePictureUrl({
                instanceName: selectedInstanceName,
                phoneNumber,
              }),
            ]),
          )
        ).filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
      )
    : {};

  const agentRows: UnifiedConversation[] = agentConversations.map((conversation) => ({
    key: `agent:${conversation.id}`,
    source: "agent",
    conversationId: conversation.id,
    agentId: conversation.agentId || undefined,
    label: getAgentContactLabel(conversation.contact),
    secondaryLabel: conversation.contact.phoneNumber,
    avatarUrl: avatarUrls[conversation.contact.phoneNumber] ?? null,
    lastMessage: conversation.messages[0]?.content ?? null,
    lastMessageDirection: conversation.messages[0]?.direction ?? null,
    lastMessageAt: conversation.messages[0]?.createdAt ?? null,
  }));

  let officialRows: UnifiedConversation[] = [];
  let officialData: Awaited<ReturnType<typeof getOfficialApiChatsData>> | null = null;

  if (canUseOfficialApi) {
    officialData = await getOfficialApiChatsData({
      workspaceId: membership.workspace.id,
      conversationId: selectedChatRef?.source === "official" ? selectedChatRef.conversationId : "",
      q: searchQuery,
    });

    if (!officialData.isConnected) {
      return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
    }

    officialRows = officialData.conversations.map((conversation) => ({
      key: `official:${conversation.id}`,
      source: "official",
      conversationId: conversation.id,
      label: getOfficialContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber || conversation.contact.waId,
      avatarUrl: null,
      lastMessage: conversation.lastMessage?.content ?? null,
      lastMessageDirection: conversation.lastMessage?.direction ?? null,
      lastMessageAt: conversation.lastMessage?.createdAt ?? null,
    }));
  }

  const merged = [...agentRows, ...officialRows]
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

  let selectedConversation: {
    id: string;
    label: string;
    secondaryLabel: string;
    avatarUrl?: string | null;
    messages: Array<{
      id: string;
      content: string | null;
      direction: "INBOUND" | "OUTBOUND";
      createdAt: Date;
      authorType: "user" | "bot";
      outboundStatusLabel: string | null;
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
        contact: { select: { name: true, phoneNumber: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, content: true, direction: true, createdAt: true, rawPayload: true },
        },
      },
    });

    if (detail) {
      selectedConversation = {
        id: detail.id,
        label: getAgentContactLabel(detail.contact),
        secondaryLabel: detail.contact.phoneNumber,
        avatarUrl: selectedUnified.avatarUrl ?? null,
        messages: detail.messages.map((message) => {
          const outbound = message.direction === "OUTBOUND";
          const isManualOutbound =
            outbound &&
            typeof message.rawPayload === "object" &&
            message.rawPayload !== null &&
            "source" in message.rawPayload &&
            message.rawPayload.source === "manual";
          return {
            id: message.id,
            content: message.content,
            direction: message.direction,
            createdAt: message.createdAt,
            authorType: outbound ? (isManualOutbound ? "user" : "bot") : "user",
            outboundStatusLabel: outbound ? "entregado" : null,
          };
        }),
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
      })),
    };
  }

  return (
    <section className="space-y-4">
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
          href: `/cliente/chats?chatKey=${encodeURIComponent(item.key)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`,
        }))}
        selectedConversation={selectedConversation}
        backHref="/cliente/chats"
        headerBadge={
          selectedUnified?.source === "official" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <BadgeCheck className="h-3.5 w-3.5" />
              WhatsApp oficial
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </span>
          )
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
        emptyListDescription="Cuando lleguen mensajes por tus canales, apareceran aqui en una sola bandeja."
        emptySelectionTitle="Selecciona una conversacion"
        emptySelectionDescription="Elige un chat de la columna izquierda para ver el historial y responder desde el panel."
      />

      {!canUseOfficialApi ? (
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 text-sm text-slate-600">
          No tienes acceso al canal de API oficial. Solo veras chats de agentes.
        </Card>
      ) : null}
    </section>
  );
}
