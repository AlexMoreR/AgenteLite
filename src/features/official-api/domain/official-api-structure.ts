import type {
  OfficialApiDataModelDefinition,
  OfficialApiRouteDefinition,
} from "@/features/official-api/types/official-api";

export const officialApiPlannedRoutes: OfficialApiRouteDefinition[] = [
  {
    id: "configuracion",
    title: "Configuracion",
    href: "/cliente/api-oficial",
    description: "Conexion por cliente con access_token, phone_number_id y waba_id.",
    status: "phase-1",
  },
  {
    id: "chats",
    title: "Chats",
    href: "/cliente/chats",
    description: "Bandeja central para chats de agentes y API oficial.",
    status: "next-phase",
  },
  {
    id: "contactos",
    title: "Contactos",
    href: "/cliente/api-oficial/contactos",
    description: "Directorio multi-tenant sincronizado por cliente.",
    status: "next-phase",
  },
  {
    id: "webhook",
    title: "Webhook",
    href: "/api/webhooks/meta/official-api",
    description: "Recepcion de mensajes y estados enviados por Meta.",
    status: "next-phase",
  },
  {
    id: "flujos",
    title: "Flujos",
    href: "/cliente/api-oficial/flujos",
    description: "Flujos de respuesta automatica y acciones simples por cliente.",
    status: "phase-1",
  },
];

export const officialApiInitialDataModel: OfficialApiDataModelDefinition[] = [
  {
    model: "OfficialApiClientConfig",
    description: "Credenciales por workspace para Cloud API oficial y estado de conexion.",
  },
  {
    model: "OfficialApiContact",
    description: "Contactos sincronizados por cliente con identificadores de Meta.",
  },
  {
    model: "OfficialApiConversation",
    description: "Contenedor de conversaciones por contacto y workspace.",
  },
  {
    model: "OfficialApiMessage",
    description: "Mensajes entrantes y salientes con estado y payload crudo.",
  },
  {
    model: "OfficialApiWebhookEvent",
    description: "Traza tecnica de eventos recibidos desde Meta para auditoria.",
  },
  {
    model: "OfficialApiAutomationRule",
    description: "Base futura para reglas de flujos por cliente.",
  },
];

export const officialApiNextBuildSteps = [
  "Fase 2: formulario de credenciales desde administracion de usuarios y validacion basica de conexion.",
  "Fase 3: webhook oficial para recibir mensajes y estados desde Meta.",
  "Fase 4: bandeja de chats multi-tenant con contactos y mensajes reales.",
  "Fase 5: ampliar flujos con persistencia de reglas, builder visual y activacion por plantillas.",
];
