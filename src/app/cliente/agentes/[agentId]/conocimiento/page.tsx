import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenText, Boxes, Eye, Workflow, Zap } from "lucide-react";
import { saveAgentKnowledgeProductsAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { KnowledgeProductInstructionModal } from "@/components/agents/knowledge-product-instruction-modal";
import { KnowledgeSelectionCheckbox } from "@/components/agents/knowledge-selection-checkbox";
import { Card } from "@/components/ui/card";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { formatMoney } from "@/lib/currency";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
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

function isMissingAgentKnowledgeInstructionsColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('column "instructions" does not exist') ||
    message.includes('columna "instructions" no existe') ||
    message.includes("42703")
  );
}

function isMissingAgentKnowledgeFollowUpColumnsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('column "followUpFlowId" does not exist') ||
    message.includes('columna "followUpFlowId" no existe') ||
    message.includes("42703")
  );
}

function isMissingAgentKnowledgeFunnelColumnsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('column "funnelOpening" does not exist') ||
    message.includes('column "funnelQualification" does not exist') ||
    message.includes('column "funnelPresentation" does not exist') ||
    message.includes('column "funnelFaq" does not exist') ||
    message.includes('column "funnelClosing" does not exist') ||
    message.includes('columna "funnelOpening" no existe') ||
    message.includes('columna "funnelQualification" no existe') ||
    message.includes('columna "funnelPresentation" no existe') ||
    message.includes('columna "funnelFaq" no existe') ||
    message.includes('columna "funnelClosing" no existe') ||
    message.includes("42703")
  );
}

export default async function AgentKnowledgePage({ params, searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("agents");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const okMessage = getSingleParam(query.ok);
  const errorMessage = getSingleParam(query.error);
  const activeTab = getSingleParam(query.tab) === "flows" ? "flows" : "products";
  const canUseOfficialApi = await canAccessOfficialApiModule(access.userId, access.role);

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
  let productInstructionById = new Map<string, string>();
  let productFollowUpFlowById = new Map<string, string | null>();
  let productFunnelOpeningById = new Map<string, string | null>();
  let productFunnelQualificationById = new Map<string, string | null>();
  let productFunnelPresentationById = new Map<string, string | null>();
  let productFunnelFaqById = new Map<string, string | null>();
  let productFunnelClosingById = new Map<string, string | null>();
  try {
    const selectedRows = await prisma.$queryRaw<Array<{
      productId: string;
      instructions: string | null;
      followUpFlowId: string | null;
      funnelOpening: string | null;
      funnelQualification: string | null;
      funnelPresentation: string | null;
      funnelFaq: string | null;
      funnelClosing: string | null;
    }>>`
      SELECT "productId", "instructions", "followUpFlowId", "funnelOpening", "funnelQualification", "funnelPresentation", "funnelFaq", "funnelClosing"
      FROM "AgentKnowledgeProduct"
      WHERE "agentId" = ${agent.id}
      ORDER BY "createdAt" ASC
    `;
    selectedProductIds = new Set(selectedRows.map((row) => row.productId));
    productInstructionById = new Map(selectedRows.map((row) => [row.productId, row.instructions ?? ""]));
    productFollowUpFlowById = new Map(selectedRows.map((row) => [row.productId, row.followUpFlowId ?? null]));
    productFunnelOpeningById = new Map(selectedRows.map((row) => [row.productId, row.funnelOpening ?? null]));
    productFunnelQualificationById = new Map(selectedRows.map((row) => [row.productId, row.funnelQualification ?? null]));
    productFunnelPresentationById = new Map(selectedRows.map((row) => [row.productId, row.funnelPresentation ?? null]));
    productFunnelFaqById = new Map(selectedRows.map((row) => [row.productId, row.funnelFaq ?? null]));
    productFunnelClosingById = new Map(selectedRows.map((row) => [row.productId, row.funnelClosing ?? null]));
  } catch (error) {
    if (
      isMissingAgentKnowledgeInstructionsColumnError(error) ||
      isMissingAgentKnowledgeFollowUpColumnsError(error) ||
      isMissingAgentKnowledgeFunnelColumnsError(error)
    ) {
      const selectedRows = await prisma.$queryRaw<Array<{ productId: string }>>`
        SELECT "productId"
        FROM "AgentKnowledgeProduct"
        WHERE "agentId" = ${agent.id}
        ORDER BY "createdAt" ASC
      `;
      selectedProductIds = new Set(selectedRows.map((row) => row.productId));
    } else if (!isMissingAgentKnowledgeTableError(error)) {
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
      <Card className="border border-border bg-card p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="space-y-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-3">
              <BookOpenText className="h-6 w-6 text-primary" />
              <h1 className="text-[18px] font-semibold tracking-tight text-foreground">Conocimiento</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">Selecciona los productos y flujos que este agente puede usar como contexto.</p>
          </div>

          {okMessage ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
              {okMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="border-b border-border">
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
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-primary"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
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
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition hover:border-primary/40"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <KnowledgeSelectionCheckbox
                          name="productIds"
                          value={product.id}
                          defaultChecked={selectedProductIds.has(product.id)}
                          ariaLabel={`Seleccionar ${product.name} como conocimiento del agente`}
                        />
                        <KnowledgeProductInstructionModal
                          agentId={agent.id}
                          productId={product.id}
                          productName={product.name}
                          categoryName={product.category?.name ?? "Sin categoria"}
                          description={product.description}
                          price={formatMoney(String(product.price), "COP")}
                          thumbnailUrl={product.thumbnailUrl}
                          instructions={productInstructionById.get(product.id) ?? ""}
                          funnelOpening={productFunnelOpeningById.get(product.id) ?? null}
                          funnelQualification={productFunnelQualificationById.get(product.id) ?? null}
                          funnelPresentation={productFunnelPresentationById.get(product.id) ?? null}
                          funnelFaq={productFunnelFaqById.get(product.id) ?? null}
                          funnelClosing={productFunnelClosingById.get(product.id) ?? null}
                          followUpFlowId={productFollowUpFlowById.get(product.id) ?? null}
                          isSelected={selectedProductIds.has(product.id)}
                          flows={flowTargets.map((flow) => ({
                            id: flow.id,
                            title: flow.title,
                            badge: flow.badge,
                            intent: flow.intent,
                            description: flow.description,
                          }))}
                        />
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-foreground">
                        {formatMoney(String(product.price), "COP")}
                      </p>
                      <Link
                        href={`/admin/productos/${product.id}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:border-primary hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-foreground">Todavia no hay productos en el catalogo</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Primero crea productos para despues agregarlos al conocimiento del agente.
                  </p>
                  <Link
                    href="/admin/productos"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary"
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
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition hover:border-primary/40"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <KnowledgeSelectionCheckbox
                          name="flowIds"
                          value={flow.id}
                          defaultChecked={selectedFlowIds.has(flow.id)}
                          ariaLabel={`Seleccionar ${flow.title} como flujo del agente`}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[15px] font-semibold text-foreground">{flow.title}</p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
                              {flow.badge}
                            </span>
                            {selectedFlowIds.has(flow.id) ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                Seleccionado
                              </span>
                            ) : null}
                          </div>
                          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{flow.intent || flow.description}</p>
                        </div>
                      </div>
                      <Link
                        href={flow.href}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
                      >
                        Abrir
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-foreground">Todavia no hay flujos disponibles</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Conecta primero la API oficial o un canal con Evolution para despues agregarlos al conocimiento del agente.
                  </p>
                  <Link
                    href="/cliente/flujos"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary"
                  >
                    Ir a flujos
                  </Link>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
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
