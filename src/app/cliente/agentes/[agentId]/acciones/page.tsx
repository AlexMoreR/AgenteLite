import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AgentActionsWorkspace } from "@/features/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function AgentActionsPage({ params }: PageProps) {
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
      trainingConfig: true,
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultAgentTrainingConfig;

  return (
    <AgentPanelShell agentId={agent.id}>
      <AgentActionsWorkspace agentId={agent.id} training={training} />
    </AgentPanelShell>
  );
}
