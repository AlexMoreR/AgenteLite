import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Route, Workflow } from "lucide-react";
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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/cliente/flujos?sourceType=official-api"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-[rgba(148,163,184,0.18)]">
            <Route className="h-4 w-4 text-[var(--primary)]" />
            API oficial
          </span>
        </div>

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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/cliente/flujos${routeQuery}`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-[rgba(148,163,184,0.18)]">
            <Workflow className="h-4 w-4 text-[var(--primary)]" />
            Evolution
          </span>
        </div>

        <OfficialApiChatbotWorkspace
          key={`flows-evolution-${query.sourceId}-${workflowId}`}
          data={data}
          initialScenarioId={workflowId}
          basePath="/cliente/flujos"
          routeQuery={routeQuery}
          saveEndpoint={`/api/cliente/flujos?sourceType=evolution&sourceId=${encodeURIComponent(query.sourceId)}`}
          uploadEndpoint="/api/cliente/flujos/upload-media"
          saveSuccessDescription="La configuracion del flujo quedo lista para el canal Evolution."
        />
      </section>
    );
  }

  redirect("/cliente/flujos");
}
