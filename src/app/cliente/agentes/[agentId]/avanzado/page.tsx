import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { AgentAdvancedPromptForm } from "@/components/agents/agent-advanced-prompt-form";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams?: Promise<{ ok?: string }>;
};

export default async function AgentAvanzadoPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const { agentId } = await params;
  const sp = await searchParams;
  const successMessage = sp?.ok;

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      systemPrompt: true,
      trainingConfig: true,
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultAgentTrainingConfig;

  return (
    <AgentPanelShell agentId={agentId}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <AgentAdvancedPromptForm
          agentId={agentId}
          generatedSystemPrompt={agent.systemPrompt ?? ""}
          useCustomPrompt={training.useCustomPrompt}
          customSystemPrompt={training.customSystemPrompt}
          successMessage={successMessage}
        />
      </div>
    </AgentPanelShell>
  );
}
