import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sendOfficialApiReplyAction } from "@/app/actions/official-api-actions";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { SharedInbox } from "@/components/chats/shared-inbox";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import {
  OfficialApiLockedState,
  OfficialApiPanelShell,
  getOfficialApiChatsData,
} from "@/features/official-api";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getContactLabel(input: { name: string | null; phoneNumber: string | null; waId: string }) {
  return input.name?.trim() || input.phoneNumber?.trim() || input.waId;
}

export default async function OfficialApiChatsPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const paramsData = await searchParams;
  const selectedConversationId =
    typeof paramsData.conversationId === "string" ? paramsData.conversationId : "";
  const searchQuery = typeof paramsData.q === "string" ? paramsData.q.trim() : "";
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";

  const data = await getOfficialApiChatsData({
    workspaceId: membership.workspace.id,
    conversationId: selectedConversationId,
    q: searchQuery,
  });

  if (!data.isConnected) {
    return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
  }

  return (
    <OfficialApiPanelShell>
      <ChatsAutoRefresh intervalMs={5000} />
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <SharedInbox
        searchAction="/cliente/api-oficial/chats"
        selectedConversationId={selectedConversationId}
        searchQuery={searchQuery}
        conversations={data.conversations.map((conversation) => ({
          id: conversation.id,
          label: getContactLabel(conversation.contact),
          secondaryLabel: conversation.contact.phoneNumber || conversation.contact.waId,
          avatarUrl: null,
          lastMessage: conversation.lastMessage?.content ?? null,
          lastMessageDirection: conversation.lastMessage?.direction ?? null,
          lastMessageAt: conversation.lastMessage?.createdAt ?? null,
          href: `/cliente/api-oficial/chats?conversationId=${conversation.id}`,
        }))}
        selectedConversation={
          data.selectedConversation
            ? {
                id: data.selectedConversation.id,
                label: getContactLabel(data.selectedConversation.contact),
                secondaryLabel:
                  data.selectedConversation.contact.phoneNumber || data.selectedConversation.contact.waId,
                avatarUrl: null,
                messages: data.selectedConversation.messages.map((message) => ({
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
              }
            : null
        }
        backHref="/cliente/api-oficial/chats"
        headerBadge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Oficial
          </span>
        }
        composer={{
          action: sendOfficialApiReplyAction,
          hiddenFields: [{ name: "conversationId", value: data.selectedConversation?.id ?? "" }],
        }}
        emptyListTitle="Aun no hay conversaciones"
        emptyListDescription="Cuando lleguen mensajes por WhatsApp en la API oficial, apareceran aqui para responderlos."
        emptySelectionTitle="Selecciona una conversacion"
        emptySelectionDescription="Elige un chat de la columna izquierda para ver el historial y responder desde el panel."
      />
    </OfficialApiPanelShell>
  );
}
