import { getFlowReply, type FlowStep } from "@/lib/agent-product-flow";

/**
 * Tool con la que la IA MANDA un flujo (catálogo / fotos / PDFs), no solo lo consulta.
 *
 * Es la pieza que faltaba para el modelo IA-primero: `consultar_flujos` solo LEE (dice qué
 * flujos hay); esta ENVÍA. La IA primero consulta (en silencio), decide, y recién entonces
 * llama esta tool con los flujos que eligió.
 *
 * Acepta VARIOS flujos a la vez a propósito: la regla de venta es que ante ambigüedad se mandan
 * los catálogos relevantes juntos y se pregunta cuál — no preguntar con las manos vacías. Ej:
 * "el combo" → enviar combo camillas + combo lavacabezas, y después la IA pregunta cuál.
 *
 * Seguridad: la IA solo puede enviar flujos que estén en la lista de permitidos del agente. Un
 * flowId que no esté autorizado se RECHAZA (no se envía) y se le informa a la IA. Así la IA no
 * puede inventar un id ni mandar el flujo de otro producto que no corresponde.
 */
export const ENVIAR_FLUJO_TOOL = {
  type: "function",
  function: {
    name: "enviar_flujo",
    description:
      "Envía al cliente uno o varios flujos (catálogo, fotos, PDFs) que ya identificaste con " +
      "consultar_flujos. Usa el flow_id EXACTO que devolvió consultar_flujos. Si hay ambigüedad " +
      "entre opciones relevantes, envía todas y luego pregunta cuál le interesa. NUNCA envíes un " +
      "flujo que no corresponde a lo que pidió el cliente.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        flow_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 3,
          description:
            "Los flow_id EXACTOS (tal cual los devolvió consultar_flujos) de los flujos a enviar.",
        },
      },
      required: ["flow_ids"],
    },
  },
} as const;

export type EnviarFlujoResolved = {
  flowId: string;
  title: string;
  steps: FlowStep[];
};

export type EnviarFlujoResolution = {
  toSend: EnviarFlujoResolved[];
  rejected: string[]; // flowIds pedidos que no estaban permitidos o no tenían contenido
  // Flujos frenados por el candado de un-solo-producto: son de OTRO producto distinto al activo.
  // No se envían; el caller le dice a la IA que confirme con el cliente antes de cambiar de producto.
  rejectedOtherProduct: Array<{ flowId: string; title: string }>;
};

/**
 * Candado de un-solo-producto (LISTA BLANCA). Cuando hay un producto ACTIVO en la conversación,
 * la IA solo puede mandar flujos de ESE producto (`activeProductFlowIds`). Cualquier otro flujo
 * —sea de otro producto O un flujo suelto sin producto (p.ej. los PDFs de manicura, que no están
 * cableados a ningún producto en el grafo)— se frena y se le pide a la IA confirmar con el cliente
 * antes de cambiar de producto.
 *
 * Se usa LISTA BLANCA a propósito: bloquear "solo lo que es de otro producto" dejaría pasar los
 * flujos sueltos (justo el bug real: un "Asi" hacía que mandara el catálogo de manicura, que no
 * cuelga de ningún producto). Por eso: solo pasa lo que es del producto activo.
 *
 * Fail-safe: el caller SOLO arma este guard cuando conoce con certeza el conjunto de flujos del
 * producto activo (no vacío). Si no hay producto activo, o el producto no tiene flujos cableados,
 * no se pasa guard y no se frena nada (las rutas correctas van por el motor determinístico).
 */
export type EnviarFlujoProductGuard = {
  activeProductFlowIds: Set<string>;
};

function parseFlowIds(toolInput: unknown): string[] {
  if (!toolInput || typeof toolInput !== "object") {
    return [];
  }
  const raw = (toolInput as Record<string, unknown>).flow_ids;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

/**
 * Resuelve qué flujos se pueden enviar: valida contra la lista de permitidos y trae sus pasos.
 * NO envía nada — devuelve los pasos listos para que el caller (el webhook) los mande con su
 * propia maquinaria. Se separa a propósito para que este archivo no dependa del webhook y sea
 * fácil de probar.
 */
export async function resolveEnviarFlujoTool(input: {
  workspaceId: string;
  includeOfficialApi: boolean;
  toolInput: unknown;
  allowedFlowIds: Set<string>;
  flowTitleById: Map<string, string>;
  // Candado de un-solo-producto. Opcional: si no viene (o no hay producto activo), no se aplica.
  productGuard?: EnviarFlujoProductGuard | null;
}): Promise<EnviarFlujoResolution> {
  const requested = parseFlowIds(input.toolInput);
  const toSend: EnviarFlujoResolved[] = [];
  const rejected: string[] = [];
  const rejectedOtherProduct: Array<{ flowId: string; title: string }> = [];
  const seen = new Set<string>();

  for (const flowId of requested) {
    if (seen.has(flowId)) {
      continue;
    }
    seen.add(flowId);

    // La IA solo puede enviar flujos autorizados. Un id no permitido se rechaza, no se envía.
    if (!input.allowedFlowIds.has(flowId)) {
      rejected.push(flowId);
      continue;
    }

    // Candado de un-solo-producto (lista blanca): con producto activo, solo pasan los flujos de
    // ESE producto. Todo lo demás (otro producto o flujo suelto, p.ej. manicura) se frena y se
    // pide confirmar antes de cambiar.
    if (input.productGuard && !input.productGuard.activeProductFlowIds.has(flowId)) {
      rejectedOtherProduct.push({ flowId, title: input.flowTitleById.get(flowId) ?? "" });
      continue;
    }

    const reply = await getFlowReply({
      workspaceId: input.workspaceId,
      flowId,
      includeOfficialApi: input.includeOfficialApi,
    });

    if (!reply || reply.steps.length === 0) {
      rejected.push(flowId);
      continue;
    }

    toSend.push({
      flowId,
      title: input.flowTitleById.get(flowId) ?? "",
      steps: reply.steps,
    });
  }

  return { toSend, rejected, rejectedOtherProduct };
}
