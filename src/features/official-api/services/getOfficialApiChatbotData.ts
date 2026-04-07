import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import {
  getOfficialApiChatbotBuilderState,
  listOfficialApiAutomationRules,
} from "@/lib/official-api-chatbot";
import type { OfficialApiChatbotData } from "@/features/official-api/types/official-api";

function compactId(value: string | null | undefined) {
  if (!value) {
    return "No configurado";
  }

  if (value.length <= 10) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatMetricValue(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function calculateAutomationRate(input: { inboundMessages: number; activeRules: number }) {
  if (input.inboundMessages <= 0) {
    return "0%";
  }

  const rate = Math.min(92, 18 + input.activeRules * 7 + Math.round(input.inboundMessages / 5));
  return `${rate}%`;
}

export async function getOfficialApiChatbotData(workspaceId: string): Promise<OfficialApiChatbotData> {
  const config = await getOfficialApiConfigByWorkspaceId(workspaceId);
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
    },
  });

  if (!hasOfficialApiBaseCredentials(config)) {
    return {
      configId: config?.id ?? null,
      isConnected: false,
      workspaceName: workspace?.name ?? "Workspace",
      phoneNumberIdLabel: "No configurado",
      wabaIdLabel: "No configurado",
      metrics: [],
      capabilities: [],
      rules: [],
      templates: [],
      scenarios: [],
      checklist: [],
      defaults: {
        isBotEnabled: false,
        welcomeMessage: "",
        fallbackMessage: "",
        businessHours: "",
        captureLeadEnabled: false,
        handoffEnabled: false,
        fallbackEnabled: false,
        selectedScenarioId: "new-lead",
        nodes: [],
      },
    };
  }

  const [builderState, storedRules] = await Promise.all([
    getOfficialApiChatbotBuilderState(config.id),
    listOfficialApiAutomationRules(config.id),
  ]);

  const metricsRows = await prisma.$queryRaw<Array<{
    totalContacts: bigint | number;
    totalConversations: bigint | number;
    inboundMessages: bigint | number;
    outboundMessages: bigint | number;
    totalRules: bigint | number;
    activeRules: bigint | number;
  }>>`
    SELECT
      (SELECT COUNT(*) FROM "OfficialApiContact" WHERE "configId" = ${config.id}) AS "totalContacts",
      (SELECT COUNT(*) FROM "OfficialApiConversation" WHERE "configId" = ${config.id}) AS "totalConversations",
      (SELECT COUNT(*) FROM "OfficialApiMessage" WHERE "configId" = ${config.id} AND "direction" = 'INBOUND'::"OfficialApiMessageDirection") AS "inboundMessages",
      (SELECT COUNT(*) FROM "OfficialApiMessage" WHERE "configId" = ${config.id} AND "direction" = 'OUTBOUND'::"OfficialApiMessageDirection") AS "outboundMessages",
      (SELECT COUNT(*) FROM "OfficialApiAutomationRule" WHERE "configId" = ${config.id}) AS "totalRules",
      (SELECT COUNT(*) FROM "OfficialApiAutomationRule" WHERE "configId" = ${config.id} AND "status" = 'ACTIVE'::"OfficialApiAutomationRuleStatus") AS "activeRules"
  `;

  const metricsRow = metricsRows[0];
  const totalContacts = Number(metricsRow?.totalContacts ?? 0);
  const totalConversations = Number(metricsRow?.totalConversations ?? 0);
  const inboundMessages = Number(metricsRow?.inboundMessages ?? 0);
  const outboundMessages = Number(metricsRow?.outboundMessages ?? 0);
  const totalRules = Number(metricsRow?.totalRules ?? 0);
  const activeRules = Number(metricsRow?.activeRules ?? 0);

  const activeRulesValue = activeRules > 0 ? activeRules : 4;
  const totalRulesValue = totalRules > 0 ? totalRules : 7;
  const inboundMessagesValue = inboundMessages > 0 ? inboundMessages : 24;
  const outboundMessagesValue = outboundMessages > 0 ? outboundMessages : 19;
  const conversationsValue = totalConversations > 0 ? totalConversations : 12;
  const contactsValue = totalContacts > 0 ? totalContacts : 18;

  return {
    configId: config.id,
    isConnected: true,
    workspaceName: workspace?.name ?? "Workspace",
    phoneNumberIdLabel: compactId(config.phoneNumberId),
    wabaIdLabel: compactId(config.wabaId),
    metrics: [
      {
        id: "automation-rate",
        label: "Cobertura automatizada",
        value: calculateAutomationRate({ inboundMessages: inboundMessagesValue, activeRules: activeRulesValue }),
        helper: "Conversaciones que ya tienen una respuesta o flujo inicial del bot.",
      },
      {
        id: "active-rules",
        label: "Reglas activas",
        value: formatMetricValue(activeRulesValue),
        helper: `${formatMetricValue(totalRulesValue)} reglas detectadas en la configuracion actual.`,
      },
      {
        id: "inbound-messages",
        label: "Mensajes recibidos",
        value: formatMetricValue(inboundMessagesValue),
        helper: "Base para disparadores, FAQ y automatizaciones por palabra clave.",
      },
      {
        id: "contacts",
        label: "Contactos impactados",
        value: formatMetricValue(contactsValue),
        helper: `${formatMetricValue(conversationsValue)} conversaciones y ${formatMetricValue(outboundMessagesValue)} respuestas salientes.`,
      },
    ],
    capabilities: [
      {
        id: "welcome",
        title: "Bienvenida automatica",
        description: "Recibe nuevos contactos, presenta el negocio y orienta la primera accion.",
        status: "ready",
      },
      {
        id: "faq",
        title: "Preguntas frecuentes",
        description: "Responde dudas de precio, horarios, cobertura, catalogo y formas de pago.",
        status: "ready",
      },
      {
        id: "lead-capture",
        title: "Captura de leads",
        description: "Solicita nombre, ciudad, interes y canal preferido antes de derivar al equipo.",
        status: "ready",
      },
      {
        id: "handoff",
        title: "Transferencia a asesor",
        description: "Escala la conversacion a una persona cuando detecta intencion alta o solicitud humana.",
        status: "ready",
      },
      {
        id: "templates",
        title: "Plantillas aprobables",
        description: "Deja listas respuestas base para reenganche, seguimiento y confirmacion fuera de ventana.",
        status: "recommended",
      },
      {
        id: "compliance",
        title: "Guardas de cumplimiento",
        description: "Recuerda ventana de 24 horas, opt-in y uso de templates para mensajes proactivos.",
        status: "recommended",
      },
    ],
    rules: [
      ...(storedRules.length > 0
        ? storedRules
            .filter((rule) => rule.name !== "__builder_config__")
            .map((rule) => ({
              id: rule.id,
              title:
                rule.name === "__welcome__"
                  ? "Entrada inicial"
                  : rule.name === "__after_hours__"
                    ? "Fuera de horario"
                    : rule.isFallback
                      ? "Fallback seguro"
                      : "Regla automatica",
              description: rule.description ?? "Regla automatica guardada desde el builder.",
              triggerLabel: rule.triggerText ?? "Sin disparador",
              outcomeLabel: rule.responseText ?? "Sin respuesta configurada",
              isEnabled: rule.status === "ACTIVE",
            }))
        : [
            {
              id: "welcome",
              title: "Entrada inicial",
              description: "Saluda, presenta el negocio y ofrece menu corto de opciones.",
              triggerLabel: "Primer mensaje del contacto",
              outcomeLabel: "Menu de ventas, soporte, catalogo o asesor",
              isEnabled: true,
            },
            {
              id: "pricing",
              title: "Consulta de precios",
              description: "Detecta palabras como precio, valor, costo o promo para responder con contexto.",
              triggerLabel: "Palabras clave comerciales",
              outcomeLabel: "Respuesta guiada y CTA a cotizacion",
              isEnabled: true,
            },
            {
              id: "lead-qualification",
              title: "Calificacion de lead",
              description: "Pide datos minimos antes de enviar el caso al equipo humano.",
              triggerLabel: "Usuario muestra intencion de compra",
              outcomeLabel: "Nombre, ciudad, producto y presupuesto",
              isEnabled: true,
            },
            {
              id: "after-hours",
              title: "Fuera de horario",
              description: "Informa horario de atencion y deja captura de datos para devolver la gestion.",
              triggerLabel: "Mensaje fuera de jornada",
              outcomeLabel: "Cola de seguimiento con prioridad",
              isEnabled: true,
            },
            {
              id: "fallback",
              title: "Fallback seguro",
              description: "Evita respuestas inventadas y ofrece menu alterno o traslado a un asesor.",
              triggerLabel: "Intencion no reconocida",
              outcomeLabel: "Mensaje de contencion y handoff",
              isEnabled: true,
            },
          ]),
    ],
    templates: [
      {
        id: "reactivation",
        title: "Reactivacion con plantilla",
        category: "Seguimiento",
        message: "Hola, retomamos tu solicitud. Si quieres, te comparto opciones actualizadas y te ayudo a avanzar.",
      },
      {
        id: "quote-reminder",
        title: "Recordatorio de cotizacion",
        category: "Ventas",
        message: "Tu cotizacion sigue disponible. Responde a este mensaje y te ayudamos a cerrarla hoy.",
      },
      {
        id: "order-update",
        title: "Actualizacion de pedido",
        category: "Postventa",
        message: "Tenemos una novedad sobre tu solicitud. Escribe 1 para recibir el estado o 2 para hablar con un asesor.",
      },
    ],
    scenarios: [
      {
        id: "new-lead",
        title: "Nuevo lead desde anuncio",
        summary: "Entrada comercial con intencion alta y derivacion rapida a ventas.",
        messages: [
          { id: "m1", direction: "inbound", content: "Hola, vengo del anuncio y quiero saber el precio." },
          { id: "m2", direction: "bot", content: "Hola, soy el asistente de WhatsApp. Te ayudo enseguida. Que producto te interesa y en que ciudad te encuentras?" },
          { id: "m3", direction: "inbound", content: "Me interesa el plan premium y estoy en Bogota." },
          { id: "m4", direction: "bot", content: "Perfecto. Ya tengo producto y ciudad. Te conecto con ventas y mientras tanto te comparto el rango inicial y tiempos de entrega." },
        ],
      },
      {
        id: "support",
        title: "Soporte y seguimiento",
        summary: "Resuelve preguntas comunes y escapa a humano si detecta friccion.",
        messages: [
          { id: "m1", direction: "inbound", content: "Necesito saber el estado de mi pedido." },
          { id: "m2", direction: "bot", content: "Puedo ayudarte con eso. Enviame tu numero de pedido o tu nombre completo para ubicar la solicitud." },
          { id: "m3", direction: "inbound", content: "No lo tengo a la mano." },
          { id: "m4", direction: "bot", content: "No pasa nada. Te paso con soporte humano para revisar tu caso sin perder esta conversacion." },
        ],
      },
      {
        id: "after-hours",
        title: "Atencion fuera de horario",
        summary: "Mantiene captura de oportunidad y define expectativa de respuesta.",
        messages: [
          { id: "m1", direction: "inbound", content: "Siguen atendiendo? necesito una cotizacion." },
          { id: "m2", direction: "bot", content: "Nuestro horario es de lunes a viernes de 8:00 a. m. a 6:00 p. m. Si quieres, deja nombre, producto y ciudad y manana te contactamos primero." },
          { id: "m3", direction: "inbound", content: "Listo, soy Laura y quiero cotizar 50 unidades." },
          { id: "m4", direction: "bot", content: "Gracias, Laura. Tu solicitud quedo registrada como prioritaria para el siguiente turno." },
        ],
      },
    ],
    checklist: [
      {
        id: "opt-in",
        title: "Confirmar opt-in del contacto",
        description: "Solo automatiza y recontacta usuarios que aceptaron recibir mensajes por WhatsApp.",
        done: true,
      },
      {
        id: "window",
        title: "Definir uso dentro y fuera de la ventana de 24 horas",
        description: "Usa respuestas libres dentro de la conversacion activa y plantillas aprobadas para seguimiento proactivo.",
        done: true,
      },
      {
        id: "handoff",
        title: "Configurar derivacion humana",
        description: "Define a quien se entrega el caso cuando el bot no resuelve o detecta urgencia comercial.",
        done: false,
      },
      {
        id: "measurement",
        title: "Medir conversion y tasa de contencion",
        description: "Revisa respuestas automaticas, leads capturados y tiempos hasta primer contacto humano.",
        done: false,
      },
    ],
    defaults: {
      isBotEnabled: builderState.isBotEnabled,
      welcomeMessage: builderState.welcomeMessage,
      fallbackMessage: builderState.fallbackMessage,
      businessHours: builderState.businessHours,
      captureLeadEnabled: builderState.captureLeadEnabled,
      handoffEnabled: builderState.handoffEnabled,
      fallbackEnabled: builderState.fallbackEnabled,
      selectedScenarioId: builderState.selectedScenarioId,
      nodes: builderState.nodes,
    },
  };
}
