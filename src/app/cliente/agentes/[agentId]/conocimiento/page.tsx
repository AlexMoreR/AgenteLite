import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenText, Brain, Files, PlayCircle } from "lucide-react";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function AgentKnowledgePage({ params }: PageProps) {
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
      workspace: {
        select: {
          name: true,
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
              <Brain className="h-6 w-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-[1.4rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-2xl">Conocimiento del agente</h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-600">
                Aqui vamos a concentrar la informacion que el agente necesita recordar: productos, respuestas clave, politicas y contexto del negocio.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Agente</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.name}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Workspace</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{agent.workspace.name}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Estado</p>
                <p className="mt-2 text-sm font-medium text-slate-900">Base inicial</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-slate-50/70 p-5">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--primary)] shadow-[0_14px_26px_-24px_rgba(15,23,42,0.22)]">
                  <BookOpenText className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-slate-950">Que va a vivir aqui</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Este espacio queda listo para guardar preguntas frecuentes, respuestas aprobadas, catalogo resumido y politicas del negocio sin mezclarlo con el entrenamiento general.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
            <div className="space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                <Files className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Siguiente paso recomendado</h3>
                <p className="text-sm leading-7 text-slate-600">
                  Mientras terminamos esta seccion, puedes fortalecer la memoria del agente desde el entrenamiento y probar inmediatamente como responde.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href={`/cliente/agentes/${agent.id}/entrenamiento`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                >
                  Ajustar entrenamiento
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
