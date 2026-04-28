import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";
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
}) {
  const training = parseAgentTrainingConfig(input.trainingConfig) ?? defaultAgentTrainingConfig;
  const notifyConfig = training.actions.notify;

  if (!notifyConfig.enabled) {
    return null;
  }

  if (!detectNotifyHumanIntent({
    latestUserMessage: input.latestUserMessage,
    history: input.history,
  })) {
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
      agentName: input.agentName,
      customerLabel,
      customerPhoneNumber: input.customerPhoneNumber,
      latestUserMessage: input.latestUserMessage?.trim() || "",
    }),
  };
}

