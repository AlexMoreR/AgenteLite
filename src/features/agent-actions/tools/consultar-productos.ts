import { parseConsultarProductosToolInput, consultProductsByAgent } from "../services/consult-productos";

export const CONSULTAR_PRODUCTOS_TOOL = {
  type: "function",
    function: {
      name: "consultar_productos",
      description:
      "Busca el producto mas probable dentro del catalogo del agente usando nombre, codigo, slug y categoria, y devuelve los datos utiles del producto.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        consulta: {
          type: "string",
          description: "Texto del cliente o consulta a revisar.",
        },
        limite: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Cantidad maxima de coincidencias a devolver.",
        },
      },
      required: ["consulta"],
    },
  },
} as const;

export function executeConsultarProductosTool(input: {
  agentId: string;
  toolInput: unknown;
}) {
  const parsed = parseConsultarProductosToolInput(input.toolInput);
  if (!parsed) {
    return null;
  }

  return consultProductsByAgent({
    agentId: input.agentId,
    query: parsed.consulta,
    limit: parsed.limite,
  });
}
