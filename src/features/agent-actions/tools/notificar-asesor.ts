import { z } from "zod";
import { buildNotifyHumanMessage } from "../services/build-notify-human-message";
import { defaultAgentTrainingConfig, parseAgentTrainingConfig } from "@/lib/agent-training";

const notificarAsesorToolInputSchema = z
  .object({
    motivo: z.string().trim().min(3, "Describe el motivo").max(500, "El motivo es demasiado largo"),
    prioridad: z.enum(["baja", "media", "alta"]).optional(),
    resumen_cliente: z.string().trim().max(500, "El resumen es demasiado largo").optional(),
    ultimo_mensaje: z.string().trim().max(1200, "El ultimo mensaje es demasiado largo").optional(),
  })
  .strict();

export type NotificarAsesorToolInput = z.infer<typeof notificarAsesorToolInputSchema>;

export type NotificarAsesorToolExecution = {
  destinationPhoneNumber: string;
  destinationPhoneNumbers: string[];
  message: string;
  priority: "baja" | "media" | "alta";
};

export const NOTIFICAR_ASESOR_TOOL = {
  type: "function",
  function: {
    name: "Notificar_asesor",
    description:
      "Notifica a un asesor humano cuando el cliente necesita seguimiento, validacion o atencion personalizada.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        motivo: {
          type: "string",
          description: "Motivo breve por el que se debe notificar al asesor.",
        },
        prioridad: {
          type: "string",
          enum: ["baja", "media", "alta"],
          description: "Nivel de urgencia de la notificacion.",
        },
        resumen_cliente: {
          type: "string",
          description: "Resumen corto del caso o del cliente.",
        },
        ultimo_mensaje: {
          type: "string",
          description: "Ultimo mensaje relevante del cliente.",
        },
      },
      required: ["motivo"],
    },
  },
} as const;

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "").trim();
}

export function buildNotificarAsesorMessage(input: {
  agentName: string;
  customerLabel: string;
  customerPhoneNumber: string;
  latestUserMessage: string;
  toolInput: NotificarAsesorToolInput;
}) {
  const priority = input.toolInput.prioridad ?? "media";
  const summary = input.toolInput.resumen_cliente?.trim() || "";
  const latestMessage = input.toolInput.ultimo_mensaje?.trim() || input.latestUserMessage.trim();
  const baseMessage = buildNotifyHumanMessage({
    agentName: input.agentName,
    customerLabel: input.customerLabel,
    customerPhoneNumber: input.customerPhoneNumber,
    latestUserMessage: latestMessage,
  });

  return [
    baseMessage,
    `Prioridad: ${priority}`,
    `Motivo: ${input.toolInput.motivo.trim()}`,
    summary ? `Resumen: ${summary}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function parseNotificarAsesorToolInput(value: unknown) {
  const parsed = notificarAsesorToolInputSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function executeNotificarAsesorTool(input: {
  trainingConfig: unknown;
  agentName: string;
  customerPhoneNumber: string;
  customerName?: string | null;
  latestUserMessage?: string | null;
  toolInput: unknown;
}): NotificarAsesorToolExecution | null {
  const training = parseAgentTrainingConfig(input.trainingConfig) ?? defaultAgentTrainingConfig;
  if (!training.actions.notify.enabled) {
    return null;
  }

  // Acepta uno o varios números: el campo legado destinationPhoneNumber (un solo
  // número, usado por V1) más la lista destinationPhoneNumbers (Agente V2). Se
  // normaliza cada uno a dígitos y se deduplica.
  const recipients = [
    training.actions.notify.destinationPhoneNumber,
    ...(training.actions.notify.destinationPhoneNumbers ?? []),
  ]
    .map((value) => normalizePhoneNumber(value))
    .filter(Boolean);
  const destinationPhoneNumbers = Array.from(new Set(recipients));
  if (destinationPhoneNumbers.length === 0) {
    return null;
  }

  const parsedToolInput = parseNotificarAsesorToolInput(input.toolInput);
  if (!parsedToolInput) {
    return null;
  }

  const customerLabel = input.customerName?.trim() || input.customerPhoneNumber.trim() || "Cliente";
  const latestUserMessage = input.latestUserMessage?.trim() || "";

  return {
    destinationPhoneNumber: destinationPhoneNumbers[0],
    destinationPhoneNumbers,
    priority: parsedToolInput.prioridad ?? "media",
    message: buildNotificarAsesorMessage({
      agentName: input.agentName,
      customerLabel,
      customerPhoneNumber: input.customerPhoneNumber,
      latestUserMessage,
      toolInput: parsedToolInput,
    }),
  };
}
