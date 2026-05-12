import { executeNotificarAsesorTool } from "../tools";

export async function sendNotificarAsesorNotification(input: {
  trainingConfig: unknown;
  agentName: string;
  customerPhoneNumber: string;
  customerName?: string | null;
  latestUserMessage?: string | null;
  toolInput: unknown;
  sendMessage: (destinationPhoneNumber: string, message: string) => Promise<unknown>;
}) {
  const execution = executeNotificarAsesorTool({
    trainingConfig: input.trainingConfig,
    agentName: input.agentName,
    customerPhoneNumber: input.customerPhoneNumber,
    customerName: input.customerName,
    latestUserMessage: input.latestUserMessage,
    toolInput: input.toolInput,
  });

  if (!execution) {
    return {
      ok: false as const,
      error: "No se pudo preparar la notificacion para el asesor.",
    };
  }

  await input.sendMessage(execution.destinationPhoneNumber, execution.message);

  return {
    ok: true as const,
    destinationPhoneNumber: execution.destinationPhoneNumber,
    priority: execution.priority,
  };
}
