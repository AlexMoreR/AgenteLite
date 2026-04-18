import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, MessageSquareText, PlayCircle, Route, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function AgentChatbotsPage({ params }: PageProps) {
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
    select: {
      id: true,
      name: true,
      channels: {
        select: { id: true },
      },
      _count: {
        select: {
          conversations: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  return (
    <AgentPanelShell agentId={agent.id}>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
          <div className="space-y-5">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <MessageSquareText className="h-6 w-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-[1.4rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-2xl">Chatbots del agente</h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-600">
                Este es el espacio donde vamos a crear y operar los chatbots de este agente. Aqui debe vivir el constructor visual con React Flow, sin mandarlo a un modulo aparte llamado flujos.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Agente</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.name}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Canales</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.channels.length}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Conversaciones</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent._count.conversations}</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-slate-50/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--primary)]">
                    <Route className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Constructor visual</p>
                    <p className="text-sm leading-6 text-slate-600">
                      Aqui vamos a traer el builder visual del chatbot para definir disparadores, respuestas, capturas, condiciones y escalado dentro del agente.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-slate-50/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--primary)]">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Chatbot por agente</p>
                    <p className="text-sm leading-6 text-slate-600">
                      El objetivo aqui no es crear un modulo nuevo, sino darle a cada agente su propio chatbot y sus propias automatizaciones.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
            <div className="space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Mientras lo conectamos</h3>
                <p className="text-sm leading-7 text-slate-600">
                  Ya dejamos el lugar correcto dentro del agente. El siguiente paso es conectar aqui el React Flow que hoy vive en API oficial para que guarde por agente.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Link
                  href={`/cliente/agentes/${agent.id}/entrenamiento`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                >
                  Revisar entrenamiento
                </Link>
                <Link
                  href={`/cliente/agentes/${agent.id}/probar`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                >
                  <PlayCircle className="h-4 w-4" />
                  Probar agente
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AgentPanelShell>
  );
}
