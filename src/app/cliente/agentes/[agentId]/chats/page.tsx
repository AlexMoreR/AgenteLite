import { redirect } from "next/navigation";
import { Bot } from "lucide-react";
import { auth } from "@/auth";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

export default async function ClienteAgenteChatsPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, paramsData] = await Promise.all([params, searchParams]);
  const selectedConversationId = typeof paramsData.conversationId === "string" ? paramsData.conversationId : "";
  const searchQuery = typeof paramsData.q === "string" ? paramsData.q.trim() : "";
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: membership.workspace.id,
    },
    include: {
      channels: {
        where: {
          provider: "EVOLUTION",
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          evolutionInstanceName: true,
        },
        take: 1,
      },
      conversations: {
        orderBy: {
          updatedAt: "desc",
        },
        take: 50,
        select: {
          id: true,
          contact: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
            },
          },
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              id: true,
              content: true,
              direction: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const explicitSelectedConversation =
    agent.conversations.find((conversation) => conversation.id === selectedConversationId) || null;
  const filteredConversations = searchQuery
    ? agent.conversations.filter((conversation) => {
        const label = getContactLabel(conversation.contact).toLowerCase();
        const phone = conversation.contact.phoneNumber.toLowerCase();
        const lastMessage = conversation.messages[0]?.content?.toLowerCase() || "";
        const query = searchQuery.toLowerCase();
        return label.includes(query) || phone.includes(query) || lastMessage.includes(query);
      })
    : agent.conversations;

  const selectedConversationSummary =
    filteredConversations.find((conversation) => conversation.id === selectedConversationId) ||
    filteredConversations[0] ||
    null;
  const hasMobileSelection = Boolean(explicitSelectedConversation);
  const evolutionInstanceName = agent.channels[0]?.evolutionInstanceName ?? null;
  const selectedConversation = selectedConversationSummary
    ? await prisma.conversation.findFirst({
        where: {
          id: selectedConversationSummary.id,
          workspaceId: membership.workspace.id,
          agentId: agent.id,
        },
        select: {
          id: true,
          contact: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
            },
          },
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              content: true,
              direction: true,
              createdAt: true,
              rawPayload: true,
            },
          },
        },
      })
    : null;

  const avatarPhoneNumbers = [
    ...new Set(
      [
        ...filteredConversations.slice(0, 12).map((conversation) => conversation.contact.phoneNumber),
        selectedConversation?.contact.phoneNumber ?? "",
      ].filter(Boolean),
    ),
  ];

  const avatarUrls = evolutionInstanceName
    ? Object.fromEntries(
        (
          await Promise.all(
            avatarPhoneNumbers.map(async (phoneNumber) => [
              phoneNumber,
              await fetchEvolutionProfilePictureUrl({
                instanceName: evolutionInstanceName,
                phoneNumber,
              }),
            ]),
          )
        ).filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
      )
    : {};

  return (
    <AgentPanelShell agentId={agent.id} hideMobileNav={hasMobileSelection}>
      <ChatsAutoRefresh />
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <SharedInbox
        searchAction={`/cliente/agentes/${agent.id}/chats`}
        selectedConversationId={selectedConversationId}
        searchQuery={searchQuery}
        conversations={filteredConversations.map((conversation) => ({
          id: conversation.id,
          label: getContactLabel(conversation.contact),
          secondaryLabel: conversation.contact.phoneNumber,
          avatarUrl: avatarUrls[conversation.contact.phoneNumber] ?? null,
          lastMessage: conversation.messages[0]?.content ?? null,
          lastMessageDirection: conversation.messages[0]?.direction ?? null,
          lastMessageAt: conversation.messages[0]?.createdAt ?? null,
          href: `/cliente/agentes/${agent.id}/chats?conversationId=${conversation.id}`,
        }))}
        selectedConversation={
          selectedConversation
            ? {
                id: selectedConversation.id,
                label: getContactLabel(selectedConversation.contact),
                secondaryLabel: selectedConversation.contact.phoneNumber,
                avatarUrl: avatarUrls[selectedConversation.contact.phoneNumber] ?? null,
                messages: selectedConversation.messages.map((message) => {
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
                    outboundStatusLabel: outbound ? "✓✓" : null,
                  };
                }),
              }
            : null
        }
        backHref={`/cliente/agentes/${agent.id}/chats`}
        headerBadge={
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              agent.status === "ACTIVE"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                agent.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
            <Bot className="h-3.5 w-3.5" />
          </span>
        }
        composer={{
          action: sendManualAgentReplyAction,
          hiddenFields: [
            { name: "agentId", value: agent.id },
            { name: "conversationId", value: selectedConversation?.id ?? "" },
          ],
        }}
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription="Cuando lleguen mensajes por WhatsApp, apareceran aqui para responderlos."
        emptySelectionTitle="Selecciona una conversacion"
        emptySelectionDescription="Elige un chat de la columna izquierda para ver el historial y responder desde el panel."
      />
    </AgentPanelShell>
  );
}
