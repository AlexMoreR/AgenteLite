import { parseConsultarFlujosToolInput, consultFlowsByWorkspace } from "../services/consult-flujos";

export const CONSULTAR_FLUJOS_TOOL = {
  type: "function",
  function: {
    name: "consultar_flujos",
    description:
      "Busca el flujo mas probable dentro de los flujos configurados del workspace y devuelve la coincidencia mas util.",
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

export function executeConsultarFlujosTool(input: {
  workspaceId: string;
  includeOfficialApi: boolean;
  toolInput: unknown;
  allowedFlowIds?: string[];
}) {
  const parsed = parseConsultarFlujosToolInput(input.toolInput);
  if (!parsed) {
    return null;
  }

  return consultFlowsByWorkspace({
    workspaceId: input.workspaceId,
    includeOfficialApi: input.includeOfficialApi,
    query: parsed.consulta,
    limit: parsed.limite,
    allowedFlowIds: input.allowedFlowIds,
  });
}
