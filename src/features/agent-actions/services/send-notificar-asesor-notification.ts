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

  // Envía la notificación a TODOS los números configurados (en paralelo).
  const results = await Promise.allSettled(
    execution.destinationPhoneNumbers.map((phone) => input.sendMessage(phone, execution.message)),
  );
  const sentPhoneNumbers = execution.destinationPhoneNumbers.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );

  if (sentPhoneNumbers.length === 0) {
    return {
      ok: false as const,
      error: "No se pudo enviar la notificacion a ningun asesor.",
    };
  }

  return {
    ok: true as const,
    destinationPhoneNumber: sentPhoneNumbers[0],
    destinationPhoneNumbers: sentPhoneNumbers,
    priority: execution.priority,
  };
}
