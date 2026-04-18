import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Bot, Cable, Route, Workflow } from "lucide-react";
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

    return (
      <section className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Modulo nuevo</p>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Flujos</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            Centraliza aqui el builder visual de chatbots y automatizaciones. Elige si quieres trabajar sobre la API oficial o un canal Evolution.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {targets.map((target) => (
            <Link
              key={`${target.sourceType}-${target.id}`}
              href={target.href}
              className="group rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_70px_-42px_rgba(15,23,42,0.24)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                    {target.sourceType === "official-api" ? <Bot className="h-5 w-5" /> : <Cable className="h-5 w-5" />}
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{target.title}</h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {target.badge}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{target.description}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--primary)]" />
              </div>
            </Link>
          ))}
        </div>

        {!targets.length ? (
          <div className="rounded-[28px] border border-dashed border-[rgba(148,163,184,0.32)] bg-white px-6 py-10 text-sm leading-6 text-slate-600">
            Aun no hay una fuente disponible para construir flujos. Conecta primero la API oficial o crea un canal Evolution.
          </div>
        ) : null}
      </section>
    );
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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/cliente/flujos"
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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/cliente/flujos"
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
          key={`flows-evolution-${query.sourceId}`}
          data={data}
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
