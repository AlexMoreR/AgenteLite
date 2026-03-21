import Image from "next/image";
import { redirect } from "next/navigation";
import { ArrowLeft, MessageSquareText, Search, SendHorizonal } from "lucide-react";
import { auth } from "@/auth";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Card } from "@/components/ui/card";
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

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

function formatDateDivider(date: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
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

  const explicitSelectedConversation =
    agent.conversations.find((conversation) => conversation.id === selectedConversationId) || null;
  const filteredConversations = searchQuery
    ? agent.conversations.filter((conversation) => {
        const label = getContactLabel(conversation.contact).toLowerCase();
        const phone = conversation.contact.phoneNumber.toLowerCase();
        const lastMessage = conversation.messages[conversation.messages.length - 1]?.content?.toLowerCase() || "";
        const query = searchQuery.toLowerCase();
        return label.includes(query) || phone.includes(query) || lastMessage.includes(query);
      })
    : agent.conversations;

  const selectedConversation =
    filteredConversations.find((conversation) => conversation.id === selectedConversationId) ||
    filteredConversations[0] ||
    null;
  const hasMobileSelection = Boolean(explicitSelectedConversation);
  const evolutionInstanceName = agent.channels[0]?.evolutionInstanceName ?? null;

  const avatarUrls = evolutionInstanceName
    ? Object.fromEntries(
        (
          await Promise.all(
            [...new Set(agent.conversations.map((conversation) => conversation.contact.phoneNumber))]
              .filter(Boolean)
              .map(async (phoneNumber) => [
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
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Mensaje enviado"
        errorTitle="No se pudo enviar"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0 md:grid md:grid-cols-[380px_minmax(0,1fr)]">
        <Card
          className={`${hasMobileSelection ? "hidden md:flex" : "flex"} h-[calc(100dvh-7rem)] min-h-0 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[76vh] md:flex-none`}
        >
          <div className="flex min-h-0 w-full flex-col">
            <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-white px-3 py-3">
              <form className="relative" action={`/cliente/agentes/${agent.id}/chats`}>
                <input type="hidden" name="conversationId" value={selectedConversationId} />
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Buscar chat..."
                  className="h-10 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:bg-white"
                />
              </form>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[rgba(148,163,184,0.12)]">
              {filteredConversations.length > 0 ? (
                filteredConversations.map((conversation) => {
                  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null;
                  const label = getContactLabel(conversation.contact);
                  const isSelected = selectedConversation?.id === conversation.id;
                  const isInbound = lastMessage?.direction === "INBOUND";
                  return (
                    <a
                      key={conversation.id}
                      href={`/cliente/agentes/${agent.id}/chats?conversationId=${conversation.id}`}
                      className={`group relative flex items-start gap-3 px-3 py-3 transition ${
                        isSelected ? "bg-[color-mix(in_srgb,var(--primary)_6%,white)]" : "hover:bg-slate-50/80"
                      }`}
                    >
                      <span
                        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${
                          isSelected ? "bg-[var(--primary)]" : "bg-transparent"
                        }`}
                      />

                      {avatarUrls[conversation.contact.phoneNumber] ? (
                        <Image
                          src={avatarUrls[conversation.contact.phoneNumber]}
                          alt={label}
                          width={44}
                          height={44}
                          unoptimized
                          className="h-11 w-11 shrink-0 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                          {getInitials(label)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-[13px] font-semibold text-slate-950">{label}</p>
                          <span className="shrink-0 text-[10px] text-slate-500">
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
                          <p className="truncate text-[13px] text-slate-600">
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

        <Card
          className={`${hasMobileSelection || agent.conversations.length === 0 ? "flex" : "hidden md:flex"} h-[calc(100dvh-3rem)] min-h-0 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[76vh] md:flex-none`}
        >
          {selectedConversation ? (
            <div className="flex min-h-0 h-full w-full flex-1 flex-col">
              <div className="sticky top-0 z-10 shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-4 py-3 md:static md:px-5">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <a
                      href={`/cliente/agentes/${agent.id}/chats`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 md:hidden"
                      aria-label="Volver a chats"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </a>
                    {avatarUrls[selectedConversation.contact.phoneNumber] ? (
                      <Image
                        src={avatarUrls[selectedConversation.contact.phoneNumber]}
                        alt={getContactLabel(selectedConversation.contact)}
                        width={40}
                        height={40}
                        unoptimized
                        className="h-10 w-10 shrink-0 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                        {getInitials(getContactLabel(selectedConversation.contact))}
                      </div>
                    )}
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

              <div className="flex min-h-0 flex-1 flex-col bg-[#f3f4f6]">
                <div
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5"
                  style={{
                    backgroundColor: "#f3f4f6",
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23cbd5e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'%3E%3Ccircle cx='28' cy='24' r='10'/%3E%3Cpath d='M62 18l8 14 14 2-10 10 2 14-14-7-12 7 2-14-10-10 14-2z'/%3E%3Cpath d='M122 18c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M169 24l20 20M189 24l-20 20'/%3E%3Crect x='20' y='76' width='28' height='18' rx='6'/%3E%3Cpath d='M26 102c6-8 16-8 22 0'/%3E%3Cpath d='M76 74l10 18 20 3-14 14 3 20-19-10-18 10 3-20-14-14 20-3z'/%3E%3Cpath d='M130 78h28v18h-28z'/%3E%3Cpath d='M144 70v36M130 87h28'/%3E%3Cpath d='M176 76c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M24 142c6-8 18-8 24 0 6 8 18 8 24 0'/%3E%3Cpath d='M86 144c0-8 6-14 14-14s14 6 14 14-6 14-14 14-14-6-14-14z'/%3E%3Cpath d='M128 136l24 24M152 136l-24 24'/%3E%3Cpath d='M174 132h26v26h-26z'/%3E%3Cpath d='M182 124v42M174 145h26'/%3E%3Ccircle cx='42' cy='188' r='16'/%3E%3Cpath d='M36 188h12M42 182v12'/%3E%3Cpath d='M92 180c8-10 22-10 30 0-8 10-22 10-30 0z'/%3E%3Cpath d='M140 180l12 12 18-18'/%3E%3Cpath d='M178 184c6-8 16-8 22 0'/%3E%3C/g%3E%3C/svg%3E\")",
                    backgroundPosition: "center",
                    backgroundSize: "220px 220px",
                  }}
                >
                  <div className="space-y-3">
                  {selectedConversation.messages.map((message, index) => {
                    const outbound = message.direction === "OUTBOUND";
                    const previousMessage = selectedConversation.messages[index - 1];
                    const currentDateKey = new Intl.DateTimeFormat("en-CA").format(message.createdAt);
                    const previousDateKey = previousMessage
                      ? new Intl.DateTimeFormat("en-CA").format(previousMessage.createdAt)
                      : null;
                    const showDateDivider = currentDateKey !== previousDateKey;
                    return (
                      <div key={message.id} className="space-y-3">
                        {showDateDivider ? (
                          <div className="flex justify-center">
                            <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium capitalize text-slate-500 shadow-sm backdrop-blur">
                              {formatDateDivider(message.createdAt)}
                            </span>
                          </div>
                        ) : null}

                        <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[72%] rounded-[12px] px-[8px] py-[8px] text-[13px] leading-5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] ${
                              outbound
                                ? "bg-[var(--primary)] text-white"
                                : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                            }`}
                          >
                            <p>{message.content || "-"}</p>
                            <div className={`mt-1.5 flex items-center justify-end gap-0 text-[10px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
                              <span>
                                {new Intl.DateTimeFormat("es-CO", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                }).format(message.createdAt)}
                              </span>
                              {outbound ? <span aria-hidden="true">✓✓</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white px-4 py-2 md:static md:px-5 md:py-4">
                  <form action={sendManualAgentReplyAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="conversationId" value={selectedConversation.id} />

                    <div className="flex items-center gap-3">
                      <textarea
                        name="message"
                        rows={1}
                        placeholder="Escribe un mensaje..."
                        className="flex h-11 min-h-0 flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:h-12"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] md:h-12 md:w-12"
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
