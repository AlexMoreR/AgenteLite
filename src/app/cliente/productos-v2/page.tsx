import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { prisma } from "@/lib/prisma";
import { ProductoV2Workspace } from "@/features/productos-v2/components/ProductoV2Workspace";
import { getProductInsights } from "@/features/productos-v2/services/getProductInsights";
import { getProductLeadProgress } from "@/features/productos-v2/services/getProductLeadProgress";
import type { ProductoV2Item } from "@/features/productos-v2/types";

// Palabra distintiva ilustrativa: el primer token "fuerte" del nombre (no genérico). La real la
// calcula el motor comparando contra los otros productos; acá solo es para mostrar.
const GENERIC_NAME_TOKENS = new Set(["combo", "para", "con", "los", "las", "del", "kit", "set"]);
function guessDistinctiveWord(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !GENERIC_NAME_TOKENS.has(token));
  return tokens[0] ?? name.trim().split(/\s+/)[0] ?? name;
}

export default async function ClienteProductoV2Page() {
  const access = await requireClientWorkspaceAccess("products_v2");

  const [productRows, flowItems] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        price: true,
        agentKnowledge: {
          select: {
            instructions: true,
            followUpFlowId: true,
            funnelOpening: true,
            funnelQualification: true,
            funnelPresentation: true,
            funnelFaq: true,
            funnelClosing: true,
          },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    }),
    getCreatedFlowItems({ workspaceId: access.workspaceId, includeOfficialApi: false }).catch(() => []),
  ]);

  // El playbook de cada producto. Si la tabla todavia no existe (despliegue a medio camino), la
  // pantalla sigue funcionando sin playbooks en vez de caerse entera.
  const playbookRows = await prisma.productPlaybook
    .findMany({
      where: { workspaceId: access.workspaceId },
      select: {
        productId: true,
        idealCustomer: true,
        customerPain: true,
        rules: {
          where: { isActive: true },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
          select: { id: true, kind: true, trigger: true, text: true, source: true },
        },
        stages: {
          orderBy: { sortOrder: "asc" },
          select: { stage: true, goal: true, script: true, stuckAfterMessages: true },
        },
      },
    })
    .catch(() => []);
  const playbookByProductId = new Map(playbookRows.map((row) => [row.productId, row] as const));

  // Hasta donde llegaron los leads de cada producto en los ultimos 30 dias.
  const avancePorProducto = await getProductLeadProgress({
    workspaceId: access.workspaceId,
    productIds: productRows.map((product) => product.id),
  });

  // Lo que la IA leyo en las conversaciones de cada producto.
  const insightsPorProducto = new Map(
    await Promise.all(
      productRows.map(async (product) => {
        const resumen = await getProductInsights({
          workspaceId: access.workspaceId,
          productId: product.id,
        });
        return [product.id, resumen] as const;
      }),
    ),
  );

  const flowTitleById = new Map(flowItems.map((flow) => [flow.id, flow.title] as const));

  const products: ProductoV2Item[] = productRows.map((product) => {
    const knowledge = product.agentKnowledge[0];
    const priceNumber = product.price ? Number(product.price.toString()) : 0;
    const followUpFlowId = knowledge?.followUpFlowId?.trim() || "";
    const anchoredFlowTitle = followUpFlowId
      ? flowTitleById.get(followUpFlowId) ?? "Flujo del producto"
      : null;
    const playbook = playbookByProductId.get(product.id);

    /**
     * El embudo que el agente YA tenia, para no arrancar de cero.
     *
     * Si el producto todavia no tiene su embudo propio, se muestra el que el agente venia usando
     * (los cinco campos del embudo que se compilan al publicar). Asi lo que se ve en pantalla es
     * lo que de verdad esta pasando en los chats, y no un formulario vacio al lado de un agente
     * que ya dice otra cosa.
     */
    const embudoDelAgente: Array<{ stage: string; goal: string; script: string; stuckAfterMessages: number | null }> = [
      { stage: "PRESENTACION", texto: knowledge?.funnelOpening },
      { stage: "IDENTIFICACION", texto: knowledge?.funnelQualification },
      { stage: "PRODUCTO", texto: knowledge?.funnelPresentation },
      { stage: "OBJECIONES", texto: knowledge?.funnelFaq },
      { stage: "CIERRE", texto: knowledge?.funnelClosing },
    ]
      .filter((item) => item.texto?.trim())
      .map((item) => ({ stage: item.stage, goal: "", script: item.texto?.trim() ?? "", stuckAfterMessages: null }));

    const etapasGuardadas = (playbook?.stages ?? []).map((stage) => ({
      stage: stage.stage,
      goal: stage.goal?.trim() || "",
      script: stage.script?.trim() || "",
      stuckAfterMessages: stage.stuckAfterMessages ?? null,
    }));
    const tieneEmbudoPropio = etapasGuardadas.some((etapa) => etapa.goal || etapa.script);

    return {
      id: product.id,
      name: product.name,
      distinctiveWord: guessDistinctiveWord(product.name),
      sells: priceNumber > 0,
      price: priceNumber > 0 ? priceNumber : null,
      anchoredFlowTitle,
      playbookIdealCustomer: playbook?.idealCustomer?.trim() || "",
      playbookCustomerPain: playbook?.customerPain?.trim() || "",
      funnelStages: tieneEmbudoPropio ? etapasGuardadas : embudoDelAgente,
      funnelFromAgent: !tieneEmbudoPropio && embudoDelAgente.length > 0,
      leadProgress: avancePorProducto.get(product.id) ?? null,
      insights: insightsPorProducto.get(product.id) ?? null,
      playbookRules: (playbook?.rules ?? []).map((rule) => ({
        id: rule.id,
        kind: rule.kind as "DECIR" | "NO_DECIR" | "OBJECION" | "BENEFICIO",
        trigger: rule.trigger,
        text: rule.text,
        source: rule.source,
      })),
    };
  });

  return <ProductoV2Workspace products={products} />;
}
