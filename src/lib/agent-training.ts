export const targetAudienceOptions = [
  "Mujer",
  "Hombre",
  "Empresa",
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
  salesTone: SalesTone;
  responseLength: ResponseLength;
  useEmojis: boolean;
  useExpressivePunctuation: boolean;
  useTuteo: boolean;
  useCustomerName: boolean;
  askNameFirst: boolean;
  offerBestSeller: boolean;
  handlePriceObjections: boolean;
  askForOrder: boolean;
  sendPaymentLink: boolean;
  handoffToHuman: boolean;
  forbiddenRules: string[];
  customRules: string;
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
    customRules: input.customRules.trim(),
  };
}

export function buildAgentSystemPrompt(input: {
  agentName: string;
  businessName: string;
  training: AgentTrainingConfig;
}) {
  const { agentName, businessName, training } = input;
  const styleNotes = [
    training.useEmojis ? "Puedes usar emojis de forma moderada si ayudan a sonar natural." : null,
    training.useExpressivePunctuation ? "Puedes usar signos como ! y ? cuando suenen naturales." : null,
    training.useTuteo ? "Tutea al cliente." : "Prefiere tratar al cliente de forma neutral o respetuosa.",
    training.useCustomerName ? "Usa el nombre del cliente cuando ya lo tengas disponible." : null,
  ].filter(Boolean);

  const salesBehaviors = [
    training.askNameFirst ? "Al inicio presentate y pide el nombre del cliente." : null,
    training.offerBestSeller ? "Si el cliente duda, recomienda de forma proactiva el producto o servicio mas vendido." : null,
    training.handlePriceObjections ? 'Si el cliente dice "esta muy caro", responde con argumentos de valor y beneficio.' : null,
    training.askForOrder ? 'Despues de resolver dudas, intenta cerrar con una pregunta directa como "Te lo reservo?" o equivalente.' : null,
    training.sendPaymentLink ? "Si el cliente confirma compra, comparte el link de pago o indica el siguiente paso de pago." : null,
    training.handoffToHuman ? "Cuando algo este fuera de tu alcance, dilo con claridad y escala a una persona." : null,
  ].filter(Boolean);

  const guardrails = [
    ...training.forbiddenRules,
    ...training.customRules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ];

  const sections = [
    `Eres ${agentName}, el vendedor virtual por WhatsApp de ${businessName}. Tu objetivo es responder como alguien del negocio, ayudar a elegir, resolver dudas y mover la conversacion hacia una venta real cuando tenga sentido.`,
    `NEGOCIO\n- Que vende: ${training.businessDescription}\n- A quien le vende: ${training.targetAudiences.join(", ")}\n- Rango de precios: ${formatPriceRange(training.priceRangeMin, training.priceRangeMax)}`,
    `ESTILO DE COMUNICACION\n- ${getTonePrompt(training.salesTone)}\n- ${getResponseLengthPrompt(training.responseLength)}${styleNotes.length ? `\n- ${styleNotes.join("\n- ")}` : ""}`,
    salesBehaviors.length ? `COMPORTAMIENTO COMERCIAL\n- ${salesBehaviors.join("\n- ")}` : "",
    guardrails.length
      ? `REGLAS ESTRICTAS\n- ${guardrails.join("\n- ")}`
      : "REGLAS ESTRICTAS\n- No inventes informacion.\n- No prometas algo que el negocio no pueda cumplir.",
    "OPERACION\n- Responde en texto plano y claro para WhatsApp.\n- No inventes datos, stock, precios ni tiempos.\n- Si falta contexto, haz una sola pregunta concreta para avanzar.\n- Prioriza ayudar, vender con honestidad y dejar claro el siguiente paso.",
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function buildWelcomeMessage(input: {
  agentName: string;
  businessName: string;
  training: AgentTrainingConfig;
}) {
  const { agentName, businessName, training } = input;

  if (training.askNameFirst) {
    return `Hola, soy ${agentName} de ${businessName}. Para ayudarte mejor, como te llamas?`;
  }

  return `Hola, soy ${agentName} de ${businessName}. Cuentame que estas buscando y te ayudo.`;
}

export function buildFallbackMessage(training: AgentTrainingConfig) {
  if (training.responseLength === "muy-corto") {
    return "Claro. Cuentame que necesitas y te respondo rapido.";
  }

  if (training.responseLength === "detallado") {
    return "Con gusto. Cuentame un poco mas de lo que buscas y te orientare paso a paso.";
  }

  return "Claro. Cuentame que necesitas y te ayudo a encontrar la mejor opcion.";
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

  if (typeof data.businessDescription !== "string" || targetAudiences.length === 0) {
    return null;
  }

  const salesTone = typeof data.salesTone === "string" && toneOptions.some((item) => item.value === data.salesTone)
    ? (data.salesTone as SalesTone)
    : "amigable-profesional";
  const responseLength = typeof data.responseLength === "string" && responseLengthOptions.some((item) => item.value === data.responseLength)
    ? (data.responseLength as ResponseLength)
    : "equilibrado";

  return {
    businessDescription: data.businessDescription,
    targetAudiences,
    priceRangeMin: typeof data.priceRangeMin === "string" ? data.priceRangeMin : "",
    priceRangeMax: typeof data.priceRangeMax === "string" ? data.priceRangeMax : "",
    salesTone,
    responseLength,
    useEmojis: Boolean(data.useEmojis),
    useExpressivePunctuation: Boolean(data.useExpressivePunctuation),
    useTuteo: Boolean(data.useTuteo),
    useCustomerName: Boolean(data.useCustomerName),
    askNameFirst: Boolean(data.askNameFirst),
    offerBestSeller: Boolean(data.offerBestSeller),
    handlePriceObjections: Boolean(data.handlePriceObjections),
    askForOrder: Boolean(data.askForOrder),
    sendPaymentLink: Boolean(data.sendPaymentLink),
    handoffToHuman: Boolean(data.handoffToHuman),
    forbiddenRules,
    customRules: typeof data.customRules === "string" ? data.customRules : "",
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
