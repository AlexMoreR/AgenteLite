// Resuelve qué reglas de seguimiento (nodos Seguimiento de Agente V2) deben
// agendarse cuando un lead llega a una etapa comercial, según cómo están
// conectados en el grafo del agente.
//
// Cada nodo Seguimiento cuelga (directo o vía cadena) de una salida de etapa del
// nodo Producto (empresa/necesidad/producto/dudas/cierre). Mapeamos esa salida a
// la(s) etapa(s) comercial(es) rastreada(s) y, si la etapa actual coincide,
// devolvemos su ruleId para agendarlo.

type GraphNode = { id: string; type?: string; data?: Record<string, unknown> };
type GraphEdge = { source?: string; target?: string; sourceHandle?: string };

// Salida de etapa del embudo (handle del nodo Producto) -> etapas comerciales.
const STAGE_HANDLE_TO_COMMERCIAL: Record<string, string[]> = {
  empresa: ["CONEXION"],
  necesidad: ["AVERIGUACION", "DIAGNOSTICO"],
  producto: ["EXPOSICION"],
  dudas: ["NEGOCIACION"],
  cierre: ["ACUERDO", "POSTVENTA"],
};

function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function resolveAgentV2StageFollowRuleIds(input: {
  graph: unknown;
  productId: string;
  currentStage: string;
}): string[] {
  const graph = input.graph as { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!nodes.length || !input.productId || !input.currentStage) {
    return [];
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const productNode = nodes.find(
    (node) => node.type === "producto" && asStr(node.data?.productId) === input.productId,
  );
  if (!productNode) {
    return [];
  }

  const ruleIds = new Set<string>();

  for (const [handle, stages] of Object.entries(STAGE_HANDLE_TO_COMMERCIAL)) {
    if (!stages.includes(input.currentStage)) {
      continue;
    }
    // Recorre hacia adelante desde la salida de esta etapa y recolecta los nodos
    // Seguimiento alcanzables (cubre cadenas Texto/Condición intermedias).
    const visited = new Set<string>();
    const queue: string[] = edges
      .filter((edge) => edge.source === productNode.id && edge.sourceHandle === handle)
      .map((edge) => edge.target)
      .filter((target): target is string => Boolean(target));

    while (queue.length) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const node = nodeById.get(current);
      if (node?.type === "seguimiento") {
        const ruleId = asStr(node.data?.ruleId);
        if (ruleId) {
          ruleIds.add(ruleId);
        }
      }
      for (const edge of edges) {
        if (edge.source === current && edge.target && !visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
  }

  return Array.from(ruleIds);
}
