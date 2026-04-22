import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenText, Boxes, Eye, Workflow, Zap } from "lucide-react";
import { auth } from "@/auth";
import { saveAgentKnowledgeProductsAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { formatMoney } from "@/lib/currency";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function isMissingAgentKnowledgeTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('relation "AgentKnowledgeProduct" does not exist') ||
    message.includes('tabla "AgentKnowledgeProduct" no existe') ||
    message.includes('Table "public.AgentKnowledgeProduct" does not exist')
  );
}

export default async function AgentKnowledgePage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const okMessage = getSingleParam(query.ok);
  const errorMessage = getSingleParam(query.error);
  const activeTab = getSingleParam(query.tab) === "flows" ? "flows" : "products";
  const canUseOfficialApi = await canAccessOfficialApiModule(session.user.id, session.user.role);

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      name: true,
      trainingConfig: true,
      workspace: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const [products, flowTargets] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        thumbnailUrl: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ name: "asc" }],
    }),
    getCreatedFlowItems({
      workspaceId: membership.workspace.id,
      includeOfficialApi: canUseOfficialApi,
    }),
  ]);

  let selectedProductIds = new Set<string>();
  try {
    const selectedRows = await prisma.$queryRaw<Array<{ productId: string }>>`
      SELECT "productId"
      FROM "AgentKnowledgeProduct"
      WHERE "agentId" = ${agent.id}
      ORDER BY "createdAt" ASC
    `;
    selectedProductIds = new Set(selectedRows.map((row) => row.productId));
  } catch (error) {
    if (!isMissingAgentKnowledgeTableError(error)) {
      throw error;
    }
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultAgentTrainingConfig;
  const availableFlowIdSet = new Set(flowTargets.map((flow) => flow.id));
  const selectedFlowIds = new Set(training.knowledgeFlowIds.filter((flowId) => availableFlowIdSet.has(flowId)));
  const tabs = [
    {
      key: "products" as const,
      label: "Productos",
      icon: Boxes,
      href: `/cliente/agentes/${agent.id}/conocimiento?tab=products`,
      count: selectedProductIds.size,
    },
    {
      key: "flows" as const,
      label: "Flujos",
      icon: Workflow,
      href: `/cliente/agentes/${agent.id}/conocimiento?tab=flows`,
      count: selectedFlowIds.size,
    },
  ];

  return (
    <AgentPanelShell agentId={agent.id}>
      <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:p-5 lg:p-6">
        <div className="space-y-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-3">
              <BookOpenText className="h-6 w-6 text-[var(--primary)]" />
              <h1 className="text-[18px] font-semibold tracking-[-0.04em] text-slate-950">Conocimiento</h1>
            </div>
            <p className="max-w-3xl text-sm text-slate-600">Selecciona los productos y flujos que este agente puede usar como contexto.</p>
          </div>

          {okMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {okMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="border-b border-[rgba(148,163,184,0.16)]">
            <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className={`inline-flex h-12 items-center gap-2 border-b-2 px-4 text-sm font-medium transition ${
                    isActive
                      ? "border-[var(--primary)] text-slate-950"
                      : "border-transparent text-slate-500 hover:text-[var(--primary)]"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-[var(--primary)]" : "text-slate-400"}`} />
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? "bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </Link>
              );
            })}
            </div>
          </div>

          <form action={saveAgentKnowledgeProductsAction} className="space-y-4">
            <input type="hidden" name="agentId" value={agent.id} />

            <div className={activeTab === "products" ? "space-y-4" : "hidden space-y-4"}>
              {products.length > 0 ? (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                  {products.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center gap-3 rounded-[12px] border border-[rgba(148,163,184,0.14)] bg-white px-3 py-2.5 transition hover:border-[color-mix(in_srgb,var(--primary)_26%,white)]"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          name="productIds"
                          value={product.id}
                          defaultChecked={selectedProductIds.has(product.id)}
                          className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[15px] font-semibold text-slate-900">{product.name}</p>
                            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                              {product.category?.name ?? "Sin categoria"}
                            </span>
                            {selectedProductIds.has(product.id) ? (
                              <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                                Seleccionado
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </label>
                      <p className="shrink-0 text-sm font-semibold text-slate-900">
                        {formatMoney(String(product.price), "COP")}
                      </p>
                      <Link
                        href={`/admin/productos/${product.id}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] bg-white text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-slate-900">Todavia no hay productos en el catalogo</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Primero crea productos para despues agregarlos al conocimiento del agente.
                  </p>
                  <Link
                    href="/admin/productos"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    Ir a productos
                  </Link>
                </div>
              )}
            </div>

            <div className={activeTab === "flows" ? "space-y-4" : "hidden space-y-4"}>
              {flowTargets.length > 0 ? (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                  {flowTargets.map((flow) => (
                    <div
                      key={flow.id}
                      className="flex items-start gap-3 rounded-[12px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3 transition hover:border-[color-mix(in_srgb,var(--primary)_26%,white)]"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          name="flowIds"
                          value={flow.id}
                          defaultChecked={selectedFlowIds.has(flow.id)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[15px] font-semibold text-slate-900">{flow.title}</p>
                            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                              {flow.badge}
                            </span>
                            {selectedFlowIds.has(flow.id) ? (
                              <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                                Seleccionado
                              </span>
                            ) : null}
                          </div>
                          <p className="max-w-2xl text-sm leading-6 text-slate-500">{flow.description}</p>
                        </div>
                      </label>
                      <Link
                        href={flow.href}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 text-xs font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        Abrir
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-slate-900">Todavia no hay flujos disponibles</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Conecta primero la API oficial o un canal con Evolution para despues agregarlos al conocimiento del agente.
                  </p>
                  <Link
                    href="/cliente/flujos"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    Ir a flujos
                  </Link>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4 sm:flex-row">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <Zap className="h-4 w-4" />
                Guardar conocimiento
              </button>
            </div>
          </form>
        </div>
      </Card>
    </AgentPanelShell>
  );
}
