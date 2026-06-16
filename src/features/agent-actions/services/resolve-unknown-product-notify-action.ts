import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
import { buildNotifyHumanMessage } from "./build-notify-human-message";
import { detectUnknownProductIntent } from "../domain/notify-intent";

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "").trim();
}

export function resolveUnknownProductNotifyAction(input: {
  trainingConfig: unknown;
  agentName: string;
  customerPhoneNumber: string;
  customerName?: string | null;
  latestUserMessage: string | null | undefined;
}) {
  const training = parseAgentTrainingConfig(input.trainingConfig) ?? defaultAgentTrainingConfig;
  const notifyConfig = training.actions.notify;

  if (!notifyConfig.enabled || !notifyConfig.autoNotifyOnUnknownProduct) {
    return null;
  }

  if (!detectUnknownProductIntent(input.latestUserMessage)) {
    return null;
  }

  const destinationPhoneNumber = normalizePhoneNumber(notifyConfig.destinationPhoneNumber);
  if (!destinationPhoneNumber) {
    return null;
  }

  const customerLabel = input.customerName?.trim() || input.customerPhoneNumber.trim() || "Cliente";

  return {
    destinationPhoneNumber,
    message: buildNotifyHumanMessage({
      customerLabel,
      customerPhoneNumber: input.customerPhoneNumber,
      description: input.latestUserMessage?.trim() || "",
    }),
  };
}
