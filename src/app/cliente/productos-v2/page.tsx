import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { prisma } from "@/lib/prisma";
import { ProductoV2Workspace } from "@/features/productos-v2/components/ProductoV2Workspace";
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
          select: { instructions: true, followUpFlowId: true },
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
        pitch: true,
        rules: {
          where: { isActive: true },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
          select: { id: true, kind: true, trigger: true, text: true, source: true },
        },
      },
    })
    .catch(() => []);
  const playbookByProductId = new Map(playbookRows.map((row) => [row.productId, row] as const));

  const flowTitleById = new Map(flowItems.map((flow) => [flow.id, flow.title] as const));

  const products: ProductoV2Item[] = productRows.map((product) => {
    const knowledge = product.agentKnowledge[0];
    const priceNumber = product.price ? Number(product.price.toString()) : 0;
    const followUpFlowId = knowledge?.followUpFlowId?.trim() || "";
    const anchoredFlowTitle = followUpFlowId
      ? flowTitleById.get(followUpFlowId) ?? "Flujo del producto"
      : null;
    const playbook = playbookByProductId.get(product.id);
    return {
      id: product.id,
      name: product.name,
      distinctiveWord: guessDistinctiveWord(product.name),
      sells: priceNumber > 0,
      price: priceNumber > 0 ? priceNumber : null,
      anchoredFlowTitle,
      playbookIdealCustomer: playbook?.idealCustomer?.trim() || "",
      playbookCustomerPain: playbook?.customerPain?.trim() || "",
      playbookPitch: playbook?.pitch?.trim() || "",
      playbookRules: (playbook?.rules ?? []).map((rule) => ({
        id: rule.id,
        kind: rule.kind as "DECIR" | "NO_DECIR" | "OBJECION" | "BENEFICIO",
        trigger: rule.trigger,
        text: rule.text,
        source: rule.source,
      })),
    };
  });

  const allFlows = flowItems.map((flow) => ({ id: flow.id, title: flow.title }));

  return <ProductoV2Workspace products={products} allFlows={allFlows} />;
}
