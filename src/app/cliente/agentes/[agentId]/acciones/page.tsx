import { redirect } from "next/navigation";
import { AgentActionsWorkspace } from "@/features/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function AgentActionsPage({ params }: PageProps) {
  const access = await requireClientWorkspaceAccess("agents");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
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
