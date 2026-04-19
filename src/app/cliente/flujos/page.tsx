import { redirect } from "next/navigation";
import { Workflow } from "lucide-react";
import { auth } from "@/auth";
import { OfficialApiChatbotWorkspace, OfficialApiLockedState, getOfficialApiChatbotData } from "@/features/official-api";
import { getEvolutionFlowData } from "@/features/flows/services/getEvolutionFlowData";
import { getFlowTargets } from "@/features/flows/services/getFlowTargets";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<{
    sourceType?: string;
    sourceId?: string;
  }>;
};

export default async function ClientFlowsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const query = await searchParams;
  const canUseOfficialApi = await canAccessOfficialApiModule(session.user.id, session.user.role);

  if (!query.sourceType) {
    const targets = await getFlowTargets({
      workspaceId: membership.workspace.id,
      includeOfficialApi: canUseOfficialApi,
    });

    if (!targets.length) {
      return (
        <section className="space-y-4">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-3">
              <Workflow className="h-6 w-6 text-sky-600" />
              <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Flujos</h1>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Crea y administra tus flujos y automatizaciones.
            </p>
          </div>

          <div className="rounded-[28px] border border-dashed border-[rgba(148,163,184,0.32)] bg-white px-6 py-10 text-sm leading-6 text-slate-600">
            Aun no hay una fuente disponible para construir flujos. Conecta primero la API oficial o crea un canal no oficial con Evolution.
          </div>
        </section>
      );
    }

    const preferredTarget =
      targets.find((target) => target.sourceType === "official-api" && target.isConnected) ??
      targets.find((target) => target.sourceType === "official-api") ??
      targets.find((target) => target.sourceType === "evolution" && target.isConnected) ??
      targets[0];

    redirect(preferredTarget.href);
  }

  if (query.sourceType === "official-api") {
    if (!canUseOfficialApi) {
      redirect("/unauthorized");
    }

    const data = await getOfficialApiChatbotData(membership.workspace.id);
    if (!data.isConnected) {
      return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
    }

    return (
      <section>
        <OfficialApiChatbotWorkspace
          key="flows-official"
          data={data}
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

    const routeQuery = `?sourceType=evolution&sourceId=${encodeURIComponent(query.sourceId)}`;

    return (
      <section>
        <OfficialApiChatbotWorkspace
          key={`flows-evolution-${query.sourceId}`}
          data={data}
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
