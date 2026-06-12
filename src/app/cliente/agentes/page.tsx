import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteAgentesPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("agents");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  const agents = membership
    ? await prisma.agent.findMany({
        where: { workspaceId: membership.workspace.id, agentType: "V1" },
        orderBy: { updatedAt: "desc" },
        include: {
          channels: {
            select: { id: true },
          },
        },
      })
    : [];

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <section className="w-full space-y-4 overflow-x-hidden">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Agentes actualizados"
        errorTitle="No pudimos completar la accion"
      />

      <AgentsWorkspace
        hasWorkspace={Boolean(membership)}
        businessName={membership?.workspace.name}
        agents={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          welcomeMessage: agent.welcomeMessage,
          updatedAtLabel: new Intl.DateTimeFormat("es-CO", {
            dateStyle: "medium",
          }).format(agent.updatedAt),
          channelCount: agent.channels.length,
        }))}
      />
    </section>
  );
}
