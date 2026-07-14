import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { detectClosingPurchaseData, parseCommercialConversationContext } from "@/lib/commercial-stage";
import { buildNotifyHumanMessage } from "./build-notify-human-message";
import { detectNotifyHumanIntent } from "../domain/notify-intent";

type ConversationLine = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
};

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "").trim();
}

export function resolveNotifyHumanAction(input: {
  trainingConfig: unknown;
  agentName: string;
  customerPhoneNumber: string;
  customerName?: string | null;
  latestUserMessage: string | null | undefined;
  history?: ConversationLine[];
  commercialContext?: unknown;
}) {
  const training = parseAgentTrainingConfig(input.trainingConfig) ?? defaultAgentTrainingConfig;
  const notifyConfig = training.actions.notify;

  if (!notifyConfig.enabled) {
    return null;
  }

  const hasNotifyIntent = detectNotifyHumanIntent({
    latestUserMessage: input.latestUserMessage,
    history: input.history,
  });
  // Cierre: el cliente entregó datos de compra (nombre/dirección) en una conversación avanzada.
  // Se pasa al asesor sin depender de que la IA lo detecte.
  const isClosing = detectClosingPurchaseData({
    latestUserMessage: input.latestUserMessage,
    previousCommercialContext: parseCommercialConversationContext(input.commercialContext),
    history: input.history,
  });

  if (!hasNotifyIntent && !isClosing) {
    return null;
  }

  const destinationPhoneNumber = normalizePhoneNumber(notifyConfig.destinationPhoneNumber);
  if (!destinationPhoneNumber) {
    return null;
  }

  const customerLabel = input.customerName?.trim() || input.customerPhoneNumber.trim() || "Cliente";

  return {
    destinationPhoneNumber,
    reason: isClosing ? ("closing" as const) : ("intent" as const),
    // En cierre le confirmamos al cliente que un asesor lo contacta para finalizar la compra
    // (el mensaje genérico de handoff no encaja). En el resto se usa el handoff estándar.
    customerMessage: isClosing
      ? "¡Perfecto! 🛒 En un momento un asesor se contacta contigo para finalizar tu compra."
      : null,
    message: buildNotifyHumanMessage({
      customerLabel,
      customerPhoneNumber: input.customerPhoneNumber,
      description: isClosing
        ? `🛒 Cliente LISTO PARA CERRAR — entregó datos de compra. Último mensaje: ${input.latestUserMessage?.trim() || ""}`
        : input.latestUserMessage?.trim() || "",
    }),
  };
}

