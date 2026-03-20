import Link from "next/link";
import { redirect } from "next/navigation";
import { Cable, MessageSquareText, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
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

  return (
    <AgentPanelShell agentId={agent.id} agentName={agent.name} description={agent.description}>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
          <div className="space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Resumen del agente</h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-600">
                Desde aquí puedes entrar a los canales del agente y seguir ampliando su configuración en los próximos módulos.
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
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
          <div className="space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
              <Cable className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Canales</h2>
              <p className="text-sm leading-7 text-slate-600">
                Administra la conexión de WhatsApp y verifica si el agente ya está vinculado.
              </p>
            </div>

            <Link
              href={`/cliente/agentes/${agent.id}/canales`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
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
