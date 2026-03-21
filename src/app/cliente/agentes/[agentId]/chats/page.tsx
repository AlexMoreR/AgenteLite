import { redirect } from "next/navigation";
import { Bot, MessageSquareText, Power, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { toggleAgentStatusAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

const statusLabelMap = {
  DRAFT: "Borrador",
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  ARCHIVED: "Archivada",
} as const;

export default async function ClienteAgenteChatsPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const { agentId } = await params;
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
        take: 30,
        include: {
          contact: {
            select: {
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
              content: true,
              direction: true,
              createdAt: true,
            },
          },
        },
      },
      _count: {
        select: {
          conversations: true,
          messages: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  return (
    <AgentPanelShell agentId={agent.id}>
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          <div className="space-y-5">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <Bot className="h-6 w-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Gestor de conversaciones</h2>
              <p className="text-sm leading-7 text-slate-600">
                Aquí verás los chats del agente y podrás controlar si la IA responde automáticamente.
              </p>
            </div>

            <div className="rounded-[22px] border border-[rgba(148,163,184,0.12)] bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Estado de la IA</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{statusLabelMap[agent.status]}</p>
                  <p className="text-sm text-slate-600">
                    {agent.status === "ACTIVE"
                      ? "La IA puede responder mensajes."
                      : "La IA está detenida y no responderá automáticamente."}
                  </p>
                </div>

                <form action={toggleAgentStatusAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <button
                    type="submit"
                    className={`inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-medium transition ${
                      agent.status === "ACTIVE"
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]"
                    }`}
                  >
                    <Power className="h-4 w-4" />
                    {agent.status === "ACTIVE" ? "Apagar IA" : "Encender IA"}
                  </button>
                </form>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Conversaciones</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-slate-950">{agent._count.conversations}</p>
              </div>
              <div className="rounded-[22px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Mensajes</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-slate-950">{agent._count.messages}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          <div className="border-b border-[rgba(148,163,184,0.12)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Chats</h2>
                <p className="text-sm text-slate-600">Actividad reciente del agente por WhatsApp.</p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[rgba(148,163,184,0.12)]">
            {agent.conversations.length > 0 ? (
              agent.conversations.map((conversation) => {
                const lastMessage = conversation.messages[0] ?? null;
                return (
                  <div key={conversation.id} className="flex items-start gap-4 px-5 py-4">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
                      <UserRound className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">
                          {conversation.contact.name || conversation.contact.phoneNumber}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {conversation.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{conversation.contact.phoneNumber}</p>
                      <p className="truncate text-sm text-slate-700">
                        {lastMessage?.content || "Sin mensajes visibles aún."}
                      </p>
                    </div>

                    <div className="shrink-0 text-right text-xs text-slate-500">
                      {lastMessage?.createdAt
                        ? new Intl.DateTimeFormat("es-CO", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(lastMessage.createdAt)
                        : "-"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                    <MessageSquareText className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-950">Aún no hay conversaciones</h3>
                    <p className="text-sm leading-6 text-slate-600">
                      Cuando lleguen mensajes por WhatsApp, aparecerán aquí para gestionarlos.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </AgentPanelShell>
  );
}
