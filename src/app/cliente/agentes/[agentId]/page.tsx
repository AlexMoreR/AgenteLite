import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AgentPromptCopilot } from "@/components/agents/agent-prompt-copilot";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
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
    select: {
      id: true,
      name: true,
      status: true,
      description: true,
      trainingConfig: true,
      channels: {
        select: { id: true },
      },
      workspace: {
        select: {
          name: true,
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

  let copilotMessages: Array<{ id: string; role: string; content: string }> = [];
  try {
    copilotMessages = await prisma.$queryRaw<Array<{ id: string; role: string; content: string }>>`
      SELECT "id", "role", "content"
      FROM "AgentCopilotMessage"
      WHERE "agentId" = ${agent.id} AND "workspaceId" = ${membership.workspace.id}
      ORDER BY "createdAt" ASC
      LIMIT 200
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes('relation "AgentCopilotMessage" does not exist') &&
      !message.includes('tabla "AgentCopilotMessage" no existe') &&
      !message.includes('Table "public.AgentCopilotMessage" does not exist')
    ) {
      throw error;
    }
  }

  return (
    <AgentPanelShell agentId={agent.id}>
      <AgentPromptCopilot
        agentId={agent.id}
        initialMessages={copilotMessages.map((message) => ({
          id: message.id,
          role: message.role as "user" | "assistant",
          content: message.content,
        }))}
      />
    </AgentPanelShell>
  );
}
