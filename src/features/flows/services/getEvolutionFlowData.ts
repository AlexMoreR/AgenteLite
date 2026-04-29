import type { OfficialApiChatbotData } from "@/features/official-api/types/official-api";
import { prisma } from "@/lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildDefaultEvolutionFlowData(channelName: string): OfficialApiChatbotData["defaults"] {
  return {
    isBotEnabled: true,
    welcomeMessage: `Hola, soy el asistente de ${channelName}. Cuentame que necesitas y te ayudo.`,
    fallbackMessage: "Todavia no tengo una respuesta segura para eso. Si quieres, te paso con una persona del equipo.",
    businessHours: "",
    captureLeadEnabled: true,
    handoffEnabled: true,
    fallbackEnabled: true,
    replyEveryMessageEnabled: false,
    selectedScenarioId: "",
    scenarios: [],
    nodesByScenarioId: {},
    nodePositionsByScenarioId: {},
    edgesByScenarioId: {},
  };
}

export async function getEvolutionFlowData(workspaceId: string, channelId: string): Promise<OfficialApiChatbotData | null> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: channelId,
      workspaceId,
      provider: "EVOLUTION",
    },
    select: {
      id: true,
      name: true,
      status: true,
      phoneNumber: true,
      metadata: true,
      agent: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          conversations: true,
          messages: true,
        },
      },
    },
  });

  if (!channel) {
    return null;
  }

  const defaultState = buildDefaultEvolutionFlowData(channel.name);
  const metadata = isRecord(channel.metadata) ? channel.metadata : {};
  const savedState = isRecord(metadata.flowBuilderState) ? metadata.flowBuilderState : {};

  return {
    configId: channel.id,
    isConnected: true,
    workspaceName: channel.name,
    phoneNumberIdLabel: channel.phoneNumber?.trim() || "Sin numero",
    wabaIdLabel: channel.agent?.name?.trim() || "Sin agente vinculado",
    metrics: [
      {
        id: "channel-status",
        label: "Estado del canal",
        value: channel.status === "CONNECTED" ? "Conectado" : channel.status === "QRCODE" ? "Esperando QR" : "Sin conectar",
        helper: "El builder funciona igual aunque el canal aun no este conectado.",
      },
      {
        id: "conversations",
        label: "Conversaciones",
        value: new Intl.NumberFormat("es-CO").format(channel._count.conversations),
        helper: "Sirve para medir cuanto se puede automatizar desde la API no oficial con Evolution.",
      },
      {
        id: "messages",
        label: "Mensajes",
        value: new Intl.NumberFormat("es-CO").format(channel._count.messages),
        helper: "Volumen historico del canal para orientar reglas y respuestas.",
      },
    ],
    capabilities: [
      {
        id: "welcome",
        title: "Bienvenida visual",
        description: "Crea la entrada automatica del canal no oficial con Evolution.",
        status: "ready",
      },
      {
        id: "routing",
        title: "Ruteo por intencion",
        description: "Organiza bloques, palabras clave y respuesta segun el tipo de consulta.",
        status: "ready",
      },
      {
        id: "handoff",
        title: "Escalado a humano",
        description: "Mantiene la salida a una persona cuando el bot no debe seguir solo.",
        status: "recommended",
      },
    ],
    rules: [],
    templates: [
      {
        id: "follow-up",
        title: "Seguimiento corto",
        category: "API no oficial",
        message: "Hola, sigo atento a tu mensaje. Si quieres, te ayudo a continuar con tu pedido.",
      },
      {
        id: "handoff",
        title: "Paso a asesor",
        category: "API no oficial",
        message: "Voy a dejar tu caso listo para que una persona del equipo te continúe atendiendo.",
      },
    ],
    scenarios: Array.isArray(savedState.scenarios)
      ? (savedState.scenarios as Array<OfficialApiChatbotData["scenarios"][number] & { summary?: string | null }>).map((scenario, index) => ({
          id: typeof scenario.id === "string" && scenario.id.trim() ? scenario.id.trim() : `workflow-${index + 1}`,
          title: typeof scenario.title === "string" && scenario.title.trim() ? scenario.title.trim() : `Workflow ${index + 1}`,
          intent:
            typeof scenario.intent === "string" && scenario.intent.trim()
              ? scenario.intent.trim()
              : typeof scenario.summary === "string" && scenario.summary.trim()
                ? scenario.summary.trim()
                : "Intencion personalizada del builder.",
          messages: Array.isArray(scenario.messages)
            ? scenario.messages.map((message) => ({
                id: typeof message.id === "string" && message.id.trim() ? message.id.trim() : `message-${index + 1}`,
                direction: message.direction === "bot" ? "bot" : "inbound",
                content: typeof message.content === "string" ? message.content : "",
              }))
            : [],
        }))
      : [],
    checklist: [
      {
        id: "connect",
        title: "Conectar el canal",
        description: "Deja el QR vinculado para que los flujos puedan operar sobre conversaciones reales.",
        done: channel.status === "CONNECTED",
      },
      {
        id: "agent",
        title: "Confirmar agente vinculado",
        description: "Asocia el canal a un agente si quieres operar con contexto comercial.",
        done: Boolean(channel.agent?.name),
      },
    ],
    defaults: {
      ...defaultState,
      ...(savedState as Partial<OfficialApiChatbotData["defaults"]>),
    },
  };
}
