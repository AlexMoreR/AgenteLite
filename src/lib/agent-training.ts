export const targetAudienceOptions = [
  "Mujer",
  "Hombre",
  "Empresa",
  "Pymes",
  "Emprendedores",
  "Jovenes",
  "Adultos mayores",
  "Mamas",
  "Profesionales",
  "Otro",
] as const;

export const toneOptions = [
  {
    value: "muy-formal",
    label: "Muy formal",
    prompt: "Habla con tono muy formal, respetuoso y ordenado.",
  },
  {
    value: "amigable-profesional",
    label: "Amigable y profesional",
    prompt: "Habla de forma amable, profesional y clara.",
  },
  {
    value: "cercano-casual",
    label: "Cercano y casual",
    prompt: "Habla con cercania, naturalidad y confianza.",
  },
  {
    value: "entusiasta",
    label: "Entusiasta",
    prompt: "Habla con energia positiva y entusiasmo sin exagerar.",
  },
] as const;

export const responseLengthOptions = [
  {
    value: "muy-corto",
    label: "Muy corto",
    prompt: "Responde con mensajes muy cortos, directos y faciles de leer.",
  },
  {
    value: "equilibrado",
    label: "Equilibrado",
    prompt: "Responde con mensajes breves pero suficientes para avanzar la venta.",
  },
  {
    value: "detallado",
    label: "Detallado",
    prompt: "Responde con mas contexto cuando ayude a cerrar la venta o resolver dudas.",
  },
] as const;

export const forbiddenRuleOptions = [
  "Dar descuentos sin permisos",
  "Inventar info de productos",
  "Hablar de la competencia",
  "Prometer envios express",
  "Inventar precios o promociones",
  "Confirmar stock sin estar seguro",
] as const;

export type TargetAudience = (typeof targetAudienceOptions)[number];
export type SalesTone = (typeof toneOptions)[number]["value"];
export type ResponseLength = (typeof responseLengthOptions)[number]["value"];

export type AgentTrainingConfig = {
  businessDescription: string;
  targetAudiences: TargetAudience[];
  priceRangeMin: string;
  priceRangeMax: string;
  location: string;
  website: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
  salesTone: SalesTone;
  responseLength: ResponseLength;
  useEmojis: boolean;
  useExpressivePunctuation: boolean;
  useTuteo: boolean;
  useCustomerName: boolean;
  askNameFirst: boolean;
  greetNewCustomers: boolean;
  customWelcomeMessage: string;
  offerBestSeller: boolean;
  handlePriceObjections: boolean;
  askForOrder: boolean;
  sendPaymentLink: boolean;
  handoffToHuman: boolean;
  forbiddenRules: string[];
  customRules: string;
  knowledgeFlowIds: string[];
};

export type AgentKnowledgePromptProduct = {
  name: string;
  description?: string | null;
  price?: string | null;
  thumbnailUrl?: string | null;
};

export type AgentKnowledgePromptFlow = {
  title: string;
  description?: string | null;
  sourceLabel?: string | null;
};

export const defaultAgentTrainingConfig: AgentTrainingConfig = {
  businessDescription: "",
  targetAudiences: ["Mujer"],
  priceRangeMin: "",
  priceRangeMax: "",
  location: "",
  website: "",
  contactPhone: "",
  contactEmail: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  youtube: "",
  salesTone: "amigable-profesional",
  responseLength: "equilibrado",
  useEmojis: false,
  useExpressivePunctuation: true,
  useTuteo: true,
  useCustomerName: true,
  askNameFirst: true,
  greetNewCustomers: false,
  customWelcomeMessage: "",
  offerBestSeller: true,
  handlePriceObjections: true,
  askForOrder: true,
  sendPaymentLink: false,
  handoffToHuman: true,
  forbiddenRules: [...forbiddenRuleOptions.slice(0, 4)],
  customRules: "",
  knowledgeFlowIds: [],
};

function getTonePrompt(value: SalesTone) {
  return toneOptions.find((item) => item.value === value)?.prompt ?? toneOptions[1].prompt;
}

function getResponseLengthPrompt(value: ResponseLength) {
  return responseLengthOptions.find((item) => item.value === value)?.prompt ?? responseLengthOptions[1].prompt;
}

export function getToneLabel(value: SalesTone) {
  return toneOptions.find((item) => item.value === value)?.label ?? "Amigable y profesional";
}

export function getResponseLengthLabel(value: ResponseLength) {
  return responseLengthOptions.find((item) => item.value === value)?.label ?? "Equilibrado";
}

export function getResponseLengthFromValue(value: number) {
  if (value <= 33) {
    return "muy-corto" as const;
  }

  if (value >= 67) {
    return "detallado" as const;
  }

  return "equilibrado" as const;
}

export function getResponseLengthSliderValue(value: ResponseLength) {
  if (value === "muy-corto") {
    return 0;
  }

  if (value === "detallado") {
    return 100;
  }

  return 50;
}

export function buildAgentTrainingConfig(input: AgentTrainingConfig): AgentTrainingConfig {
  return {
    ...input,
    targetAudiences: input.targetAudiences.filter((value, index, array) => array.indexOf(value) === index),
    forbiddenRules: input.forbiddenRules.filter(Boolean),
    customWelcomeMessage: input.customWelcomeMessage.trim(),
    customRules: input.customRules.trim(),
    knowledgeFlowIds: input.knowledgeFlowIds.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index),
  };
}

export function buildDefaultNewCustomerWelcomeMessage(businessName: string) {
  const normalizedBusinessName = businessName.trim() || "[nombre del negocio]";
  return `Bienvenido/a a *${normalizedBusinessName}*\n\nQue te podemos ayudar el dia de hoy?`;
}

function resolveWelcomeMessageTemplate(message: string, businessName: string) {
  const normalizedBusinessName = businessName.trim();
  if (!normalizedBusinessName) {
    return message.trim();
  }

  return message
    .replace(/\[nombre del negocio\]/gi, normalizedBusinessName)
    .replace(/\{nombre del negocio\}/gi, normalizedBusinessName)
    .trim();
}

export function buildAgentSystemPrompt(input: {
  agentName: string;
  businessName: string;
  training: AgentTrainingConfig;
  knowledgeProducts?: AgentKnowledgePromptProduct[];
  knowledgeFlows?: AgentKnowledgePromptFlow[];
}) {
  const { agentName, businessName, training } = input;
  const voiceRules = [
    `Adopta este tono como prioridad: ${getTonePrompt(training.salesTone)}`,
    `Longitud de respuesta obligatoria: ${getResponseLengthPrompt(training.responseLength)}`,
    training.useTuteo ? "Trata al cliente de tu, no de usted." : "No fuerces el tuteo; habla de forma neutral o respetuosa.",
    training.useCustomerName
      ? "Si ya conoces el nombre del cliente, usalo de forma natural para personalizar la conversacion."
      : "No inventes ni forces el nombre del cliente si no lo conoces.",
    training.useEmojis
      ? "Usa emojis de forma natural y frecuente cuando ayuden a sonar cercano y comercial, sin saturar cada linea."
      : "No uses emojis salvo que el contexto lo haga estrictamente necesario.",
    training.useExpressivePunctuation
      ? "Usa signos expresivos como ! y ? cuando refuercen la cercania y el cierre comercial."
      : "No abuses de signos expresivos; prioriza claridad y limpieza.",
  ];

  const salesBehaviors = [
    training.askNameFirst
      ? "Si aun no sabes el nombre del cliente, tu primera respuesta debe presentarte y pedir su nombre antes de seguir vendiendo."
      : "No pidas el nombre al inicio si no hace falta para avanzar.",
    training.greetNewCustomers
      ? `Cuando inicies con un cliente nuevo, usa este saludo base: "${resolveWelcomeMessageTemplate(training.customWelcomeMessage || buildDefaultNewCustomerWelcomeMessage(businessName), businessName)}".`
      : "No uses un saludo fijo para todos los clientes nuevos; adapta la apertura segun el contexto.",
    training.offerBestSeller
      ? "Si el cliente duda o pide recomendacion, sugiere de forma proactiva la opcion mas vendida o mas conveniente."
      : "No empujes recomendaciones proactivas si el cliente no las necesita.",
    training.handlePriceObjections
      ? 'Si el cliente dice que esta caro, responde con argumentos de valor, beneficio, diferencia o resultado; no entres en descuento facil.'
      : "Si el cliente objeta por precio, responde solo con informacion basica y sin argumentacion comercial extensa.",
    training.askForOrder
      ? 'Despues de resolver dudas, intenta cerrar con una pregunta directa de avance como "Te lo reservo?", "Te lo envio?" o equivalente.'
      : "No fuerces el cierre directo si esa opcion esta desactivada.",
    training.sendPaymentLink
      ? "Si el cliente confirma compra, indica de inmediato el siguiente paso de pago o comparte el link de pago si esta disponible."
      : "No menciones links de pago automaticos si esa opcion esta desactivada.",
    training.handoffToHuman
      ? "Si falta informacion clave, el caso se sale de tus reglas o no puedes ayudar con seguridad, dilo con claridad y escala a una persona."
      : "No escales a humano salvo que sea estrictamente indispensable.",
  ];

  const guardrails = [
    ...training.forbiddenRules,
    ...training.customRules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ];

  const nonNegotiables = [
    "Cumple primero las reglas estrictas y los limites del negocio antes que sonar amable o creativo.",
    "No inventes informacion, precios, stock, tiempos, promociones ni politicas.",
    "No respondas como asistente general; responde solo como vendedor de este negocio.",
    "Si el cliente pide algo fuera de lo que vende el negocio, aclara el limite y redirige la conversacion.",
    "Si falta contexto para recomendar o cerrar, haz una sola pregunta concreta para avanzar.",
    "Siempre busca mover la conversacion al siguiente paso util: aclarar, recomendar, cerrar o escalar.",
  ];

  const contactLines = [
    training.location && `Ubicacion: ${training.location}`,
    training.website && `Sitio web: ${training.website}`,
    training.contactPhone && `Telefono de contacto: ${training.contactPhone}`,
    training.contactEmail && `Correo: ${training.contactEmail}`,
    training.instagram && `Instagram: ${training.instagram}`,
    training.facebook && `Facebook: ${training.facebook}`,
    training.tiktok && `TikTok: ${training.tiktok}`,
    training.youtube && `YouTube: ${training.youtube}`,
  ].filter(Boolean) as string[];

  const businessRules = [
    `Solo vendes esto: ${training.businessDescription}`,
    `Tu cliente ideal es: ${training.targetAudiences.join(", ")}`,
    `Rango de precios de referencia: ${formatPriceRange(training.priceRangeMin, training.priceRangeMax)}`,
    "No te salgas de esta informacion ni inventes catalogo adicional.",
  ];

  const strictRules = guardrails.length
    ? guardrails
    : ["No inventes informacion.", "No prometas algo que el negocio no pueda cumplir."];

  const knowledgeProducts = (input.knowledgeProducts ?? [])
    .map((product) => {
      const name = product.name.trim();
      if (!name) {
        return null;
      }

      const summary = [`Producto: ${name}`];
      if (product.description?.trim()) {
        summary.push(`Descripcion: ${product.description.trim()}`);
      }
      if (product.price?.trim()) {
        summary.push(`Precio de referencia: ${product.price.trim()}`);
      }
      if (product.thumbnailUrl?.trim()) {
        summary.push(`Imagen de referencia: ${product.thumbnailUrl.trim()}`);
      }

      return summary.join(" | ");
    })
    .filter((item): item is string => Boolean(item));

  const knowledgeSection = knowledgeProducts.length
    ? `CONOCIMIENTO DE PRODUCTOS\n- ${knowledgeProducts.join("\n- ")}\n- Usa esta base para responder con precision sobre esos productos.\n- Si te preguntan por algo fuera de esta base, no lo inventes y aclara que debes confirmarlo.`
    : null;

  const knowledgeFlows = (input.knowledgeFlows ?? [])
    .map((flow) => {
      const title = flow.title.trim();
      if (!title) {
        return null;
      }

      const summary = [`Flujo disponible: ${title}`];
      if (flow.sourceLabel?.trim()) {
        summary.push(`Origen: ${flow.sourceLabel.trim()}`);
      }
      if (flow.description?.trim()) {
        summary.push(`Uso: ${flow.description.trim()}`);
      }

      return summary.join(" | ");
    })
    .filter((item): item is string => Boolean(item));

  const flowKnowledgeSection = knowledgeFlows.length
    ? `CONOCIMIENTO DE FLUJOS\n- ${knowledgeFlows.join("\n- ")}\n- Si una conversacion coincide con uno de estos recorridos, guia al cliente hacia ese flujo o explica el siguiente paso con claridad.\n- No inventes automatizaciones ni pasos que no existan en esta base.`
    : null;

  const sections = [
    `ROL\nEres ${agentName}, vendedor virtual por WhatsApp de ${businessName}. Actuas como una persona real del negocio y tu trabajo es vender con claridad, precision y criterio comercial.`,
    `OBJETIVO\nTu objetivo es entender lo que necesita el cliente, responder solo dentro de la realidad del negocio y llevar la conversacion hacia una venta real o al siguiente paso correcto.`,
    `REGLAS NO NEGOCIABLES\n- ${nonNegotiables.join("\n- ")}`,
    `CONTEXTO DEL NEGOCIO\n- ${businessRules.join("\n- ")}${contactLines.length ? `\n\nDATOS DE CONTACTO\n- ${contactLines.join("\n- ")}` : ""}`,
    `COMO HABLAS\n- ${voiceRules.join("\n- ")}`,
    `COMPORTAMIENTO DE VENTA\n- ${salesBehaviors.join("\n- ")}`,
    knowledgeSection,
    flowKnowledgeSection,
    `COSAS QUE NUNCA DEBES HACER\n- ${strictRules.join("\n- ")}`,
    `FORMA DE RESPONDER\n- Responde en texto plano para WhatsApp.\n- Prioriza mensajes claros, utiles y faciles de leer.\n- No des listas largas salvo que ayuden a vender o aclarar opciones.\n- Cuando puedas, termina con un siguiente paso concreto.`,
  ].filter(Boolean) as string[];

  return sections.join("\n\n");
}

export function buildWelcomeMessage(input: {
  agentName: string;
  businessName: string;
  training: AgentTrainingConfig;
}) {
  const { agentName, businessName, training } = input;
  if (training.greetNewCustomers) {
    return resolveWelcomeMessageTemplate(
      training.customWelcomeMessage || buildDefaultNewCustomerWelcomeMessage(businessName),
      businessName,
    );
  }

  const greetingPrefix = training.useEmojis ? "Hola! " : "Hola, ";

  if (training.askNameFirst) {
    return `${greetingPrefix}soy ${agentName} de ${businessName}. Para ayudarte mejor, como te llamas?`;
  }

  return `${greetingPrefix}soy ${agentName} de ${businessName}. Cuentame que estas buscando y te ayudo.`;
}

export function buildFallbackMessage(training: AgentTrainingConfig) {
  const suffix = training.useEmojis ? " 🙂" : "";

  if (training.responseLength === "muy-corto") {
    return `Claro. Cuentame que necesitas y te respondo rapido.${suffix}`;
  }

  if (training.responseLength === "detallado") {
    return `Con gusto. Cuentame un poco mas de lo que buscas y te orientare paso a paso.${suffix}`;
  }

  return `Claro. Cuentame que necesitas y te ayudo a encontrar la mejor opcion.${suffix}`;
}

export function buildHandoffMessage() {
  return "Esto necesita revision humana. Si quieres, dejo la conversacion lista para que una persona del equipo continue contigo.";
}

export function summarizeTraining(training: AgentTrainingConfig) {
  return {
    audiences: training.targetAudiences.join(", "),
    tone: getToneLabel(training.salesTone),
    responseLength: getResponseLengthLabel(training.responseLength),
    priceRange: formatPriceRange(training.priceRangeMin, training.priceRangeMax),
    styleExtras: [
      training.useEmojis ? "Emojis" : null,
      training.useExpressivePunctuation ? "Signos expresivos" : null,
      training.useTuteo ? "Tuteo" : null,
      training.useCustomerName ? "Usa el nombre" : null,
      training.greetNewCustomers ? "Saludo inicial activo" : null,
    ].filter(Boolean) as string[],
    salesActions: [
      training.askNameFirst ? "Pide el nombre al inicio" : null,
      training.offerBestSeller ? "Recomienda el mas vendido" : null,
      training.handlePriceObjections ? "Maneja objeciones de precio" : null,
      training.askForOrder ? "Pide el pedido directamente" : null,
      training.sendPaymentLink ? "Envia link de pago" : null,
      training.handoffToHuman ? "Escala a humano" : null,
    ].filter(Boolean) as string[],
  };
}

export function parseAgentTrainingConfig(value: unknown): AgentTrainingConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const targetAudiences = Array.isArray(data.targetAudiences)
    ? data.targetAudiences.filter((item): item is TargetAudience => typeof item === "string" && targetAudienceOptions.includes(item as TargetAudience))
    : [];
  const forbiddenRules = Array.isArray(data.forbiddenRules)
    ? data.forbiddenRules.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const knowledgeFlowIds = Array.isArray(data.knowledgeFlowIds)
    ? data.knowledgeFlowIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (typeof data.businessDescription !== "string" || targetAudiences.length === 0) {
    return null;
  }

  const salesTone = typeof data.salesTone === "string" && toneOptions.some((item) => item.value === data.salesTone)
    ? (data.salesTone as SalesTone)
    : "amigable-profesional";
  const responseLength = typeof data.responseLength === "string" && responseLengthOptions.some((item) => item.value === data.responseLength)
    ? (data.responseLength as ResponseLength)
    : "equilibrado";

  const str = (key: string) => typeof data[key] === "string" ? (data[key] as string) : "";

  return {
    businessDescription: data.businessDescription,
    targetAudiences,
    priceRangeMin: str("priceRangeMin"),
    priceRangeMax: str("priceRangeMax"),
    location: str("location"),
    website: str("website"),
    contactPhone: str("contactPhone"),
    contactEmail: str("contactEmail"),
    instagram: str("instagram"),
    facebook: str("facebook"),
    tiktok: str("tiktok"),
    youtube: str("youtube"),
    salesTone,
    responseLength,
    useEmojis: Boolean(data.useEmojis),
    useExpressivePunctuation: Boolean(data.useExpressivePunctuation),
    useTuteo: Boolean(data.useTuteo),
    useCustomerName: Boolean(data.useCustomerName),
    askNameFirst: Boolean(data.askNameFirst),
    greetNewCustomers: Boolean(data.greetNewCustomers),
    customWelcomeMessage: typeof data.customWelcomeMessage === "string" ? data.customWelcomeMessage : "",
    offerBestSeller: Boolean(data.offerBestSeller),
    handlePriceObjections: Boolean(data.handlePriceObjections),
    askForOrder: Boolean(data.askForOrder),
    sendPaymentLink: Boolean(data.sendPaymentLink),
    handoffToHuman: Boolean(data.handoffToHuman),
    forbiddenRules,
    customRules: typeof data.customRules === "string" ? data.customRules : "",
    knowledgeFlowIds,
  };
}

function formatPriceRange(min: string, max: string) {
  const minValue = min.trim();
  const maxValue = max.trim();

  if (minValue && maxValue) {
    return `Entre ${minValue} y ${maxValue}`;
  }

  if (minValue) {
    return `Desde ${minValue}`;
  }

  if (maxValue) {
    return `Hasta ${maxValue}`;
  }

  return "No definido";
}
