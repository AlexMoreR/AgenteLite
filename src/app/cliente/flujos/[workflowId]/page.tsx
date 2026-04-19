import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OfficialApiChatbotWorkspace, OfficialApiLockedState, getOfficialApiChatbotData } from "@/features/official-api";
import { getEvolutionFlowData } from "@/features/flows/services/getEvolutionFlowData";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<{
    sourceType?: string;
    sourceId?: string;
  }>;
};

export default async function ClientFlowWorkflowPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const { workflowId } = await params;
  const query = await searchParams;
  const canUseOfficialApi = await canAccessOfficialApiModule(session.user.id, session.user.role);

  if (query.sourceType === "official-api") {
    if (!canUseOfficialApi) {
      redirect("/unauthorized");
    }

    const data = await getOfficialApiChatbotData(membership.workspace.id);
    if (!data.isConnected) {
      return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
    }

    if (!data.defaults.scenarios.some((scenario) => scenario.id === workflowId)) {
      redirect("/cliente/flujos?sourceType=official-api");
    }

    return (
      <section>
        <OfficialApiChatbotWorkspace
          key={`flows-official-${workflowId}`}
          data={data}
          initialScenarioId={workflowId}
          basePath="/cliente/flujos"
          routeQuery="?sourceType=official-api"
          saveEndpoint="/api/cliente/flujos?sourceType=official-api"
          uploadEndpoint="/api/cliente/flujos/upload-media"
          saveSuccessDescription="La configuracion del flujo quedo lista para la API oficial."
        />
      </section>
    );
  }

  if (query.sourceType === "evolution" && query.sourceId) {
    const data = await getEvolutionFlowData(membership.workspace.id, query.sourceId);
    if (!data) {
      redirect("/cliente/flujos");
    }

    if (!data.defaults.scenarios.some((scenario) => scenario.id === workflowId)) {
      redirect(`/cliente/flujos?sourceType=evolution&sourceId=${encodeURIComponent(query.sourceId)}`);
    }

    const routeQuery = `?sourceType=evolution&sourceId=${encodeURIComponent(query.sourceId)}`;

    return (
      <section>
        <OfficialApiChatbotWorkspace
          key={`flows-evolution-${query.sourceId}-${workflowId}`}
          data={data}
          initialScenarioId={workflowId}
          basePath="/cliente/flujos"
          routeQuery={routeQuery}
          saveEndpoint={`/api/cliente/flujos?sourceType=evolution&sourceId=${encodeURIComponent(query.sourceId)}`}
          uploadEndpoint="/api/cliente/flujos/upload-media"
          saveSuccessDescription="La configuracion del flujo quedo lista para la API no oficial con Evolution."
        />
      </section>
    );
  }

  redirect("/cliente/flujos");
}
