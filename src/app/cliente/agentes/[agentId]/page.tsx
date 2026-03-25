import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeDollarSign, Cable, MessageSquareText, Shield, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import { parseAgentTrainingConfig, summarizeTraining } from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function ClienteAgentePanelPage({ params }: PageProps) {
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
      channels: {
        select: { id: true },
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

  const training = parseAgentTrainingConfig(agent.trainingConfig);
  const trainingSummary = training ? summarizeTraining(training) : null;

  return (
    <AgentPanelShell agentId={agent.id}>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
          <div className="space-y-5">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <Sparkles className="h-6 w-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-[1.4rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-2xl">Resumen del agente</h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-600">
                Desde aqui puedes ver como quedo entrenado el agente y entrar a los canales o conversaciones cuando lo necesites.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Estado</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.status}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Canales</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.channels.length}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Mensajes</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent._count.messages}</p>
              </div>
            </div>

            {trainingSummary ? (
              <div className="space-y-4 rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-5">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">Entrenamiento</p>
                  <h3 className="text-lg font-semibold text-slate-950">Asi atendera tu agente</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Que vende</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{training.businessDescription}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Clientes</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{trainingSummary.audiences}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Rango</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{trainingSummary.priceRange}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Tono</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{trainingSummary.tone}</p>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-[rgba(148,163,184,0.14)] bg-white px-4 py-4">
                    <div className="flex items-center gap-2">
                      <BadgeDollarSign className="h-4 w-4 text-[var(--primary)]" />
                      <p className="text-sm font-semibold text-slate-900">Como responde y vende</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {trainingSummary.responseLength}
                      </span>
                      {trainingSummary.styleExtras.map((item) => (
                        <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {item}
                        </span>
                      ))}
                      {trainingSummary.salesActions.map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-xs font-medium text-[var(--primary)]"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[rgba(148,163,184,0.14)] bg-white px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-[var(--primary)]" />
                      <p className="text-sm font-semibold text-slate-900">Reglas importantes</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {training.forbiddenRules.map((item) => (
                        <span key={item} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
                          {item}
                        </span>
                      ))}
                    </div>
                    {training.customRules ? (
                      <p className="mt-3 text-sm leading-6 text-slate-600 whitespace-pre-line">{training.customRules}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[rgba(148,163,184,0.22)] bg-slate-50 px-4 py-4 text-sm text-slate-600">
                Este agente aun no tiene entrenamiento intuitivo guardado.
              </div>
            )}
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
          <div className="space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <Cable className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Canales</h2>
              <p className="text-sm leading-7 text-slate-600">
                Administra la conexion de WhatsApp y verifica si el agente ya esta vinculado.
              </p>
            </div>

            <Link
              href={`/cliente/agentes/${agent.id}/canales`}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] sm:w-auto"
            >
              <MessageSquareText className="h-4 w-4" />
              Abrir canales
            </Link>
          </div>
        </Card>
      </div>
    </AgentPanelShell>
  );
}
