import { redirect } from "next/navigation";
import { MessageSquareText, SendHorizonal } from "lucide-react";
import { auth } from "@/auth";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
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

  const { agentId } = await params;
  const paramsData = await searchParams;
  const selectedConversationId = typeof paramsData.conversationId === "string" ? paramsData.conversationId : "";
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: membership.workspace.id,
    },
    include: {
      conversations: {
        orderBy: {
          updatedAt: "desc",
        },
        take: 50,
        include: {
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
            },
          },
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const selectedConversation =
    agent.conversations.find((conversation) => conversation.id === selectedConversationId) || agent.conversations[0] || null;

  return (
    <AgentPanelShell agentId={agent.id}>
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="flex h-[76vh] overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          <div className="flex min-h-0 w-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[rgba(148,163,184,0.12)]">
              {agent.conversations.length > 0 ? (
                agent.conversations.map((conversation) => {
                  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null;
                  const label = getContactLabel(conversation.contact);
                  const isSelected = selectedConversation?.id === conversation.id;
                  const isInbound = lastMessage?.direction === "INBOUND";
                  return (
                    <a
                      key={conversation.id}
                      href={`/cliente/agentes/${agent.id}/chats?conversationId=${conversation.id}`}
                      className={`group relative flex items-start gap-3 px-4 py-4 transition ${
                        isSelected ? "bg-[color-mix(in_srgb,var(--primary)_6%,white)]" : "hover:bg-slate-50/80"
                      }`}
                    >
                      <span
                        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
                          isSelected ? "bg-[var(--primary)]" : "bg-transparent"
                        }`}
                      />

                      <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                        {getInitials(label)}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-950">{label}</p>
                          <span className="shrink-0 text-[11px] text-slate-500">
                            {lastMessage?.createdAt
                              ? new Intl.DateTimeFormat("es-CO", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }).format(lastMessage.createdAt)
                              : ""}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {isInbound ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                          <p className="truncate text-sm text-slate-600">
                            {lastMessage?.content || "Sin mensajes visibles aun."}
                          </p>
                        </div>
                      </div>
                    </a>
                  );
                })
              ) : (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                      <MessageSquareText className="h-5 w-5" />
                    </span>
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-slate-950">Aun no hay conversaciones</h3>
                      <p className="text-sm leading-6 text-slate-600">
                        Cuando lleguen mensajes por WhatsApp, apareceran aqui para responderlos.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="flex h-[76vh] overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          {selectedConversation ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-5 py-3">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                      {getInitials(getContactLabel(selectedConversation.contact))}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-slate-950">
                        {getContactLabel(selectedConversation.contact)}
                      </h2>
                      <p className="truncate text-xs text-slate-500">{selectedConversation.contact.phoneNumber}</p>
                    </div>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      agent.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                    }`}
                  >
                    IA {agent.status === "ACTIVE" ? "Activa" : "Pausada"}
                  </span>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  {selectedConversation.messages.map((message) => {
                    const outbound = message.direction === "OUTBOUND";
                    return (
                      <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-[22px] px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] ${
                            outbound
                              ? "bg-[var(--primary)] text-white"
                              : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                          }`}
                        >
                          <p>{message.content || "-"}</p>
                          <p className={`mt-2 text-[11px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
                            {new Intl.DateTimeFormat("es-CO", {
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white px-5 py-4">
                  <form action={sendManualAgentReplyAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="conversationId" value={selectedConversation.id} />

                    <div className="flex items-center gap-3">
                      <textarea
                        name="message"
                        rows={1}
                        placeholder="Escribe un mensaje..."
                        className="flex h-12 min-h-0 flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)]"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)]"
                        aria-label="Enviar mensaje"
                      >
                        <SendHorizonal className="h-5 w-5" />
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[74vh] items-center justify-center px-6 py-10 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-950">Selecciona una conversacion</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Elige un chat de la columna izquierda para ver el historial y responder desde el panel.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AgentPanelShell>
  );
}
