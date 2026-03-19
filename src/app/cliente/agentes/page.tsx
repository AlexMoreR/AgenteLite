import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteAgentesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const agents = membership
    ? await prisma.agent.findMany({
        where: { workspaceId: membership.workspace.id },
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
