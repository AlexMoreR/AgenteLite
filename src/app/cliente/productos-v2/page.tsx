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

  const flowTitleById = new Map(flowItems.map((flow) => [flow.id, flow.title] as const));

  const products: ProductoV2Item[] = productRows.map((product) => {
    const knowledge = product.agentKnowledge[0];
    const priceNumber = product.price ? Number(product.price.toString()) : 0;
    const followUpFlowId = knowledge?.followUpFlowId?.trim() || "";
    const anchoredFlowTitle = followUpFlowId
      ? flowTitleById.get(followUpFlowId) ?? "Flujo del producto"
      : null;
    return {
      id: product.id,
      name: product.name,
      distinctiveWord: guessDistinctiveWord(product.name),
      sells: priceNumber > 0,
      price: priceNumber > 0 ? priceNumber : null,
      anchoredFlowTitle,
    };
  });

  const allFlows = flowItems.map((flow) => ({ id: flow.id, title: flow.title }));

  return <ProductoV2Workspace products={products} allFlows={allFlows} />;
}
