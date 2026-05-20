export const commercialStageValues = [
  "CONEXION",
  "AVERIGUACION",
  "DIAGNOSTICO",
  "EXPOSICION",
  "NEGOCIACION",
  "ACUERDO",
  "POSTVENTA",
] as const;

export type CommercialStage = (typeof commercialStageValues)[number];

export type CommercialContextLike = {
  slug?: string | null;
  productName?: string | null;
  description?: string | null;
  price?: string | null;
  instructions?: string | null;
} | null | undefined;

export type CommercialConversationLine = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
  mediaUrl?: string | null;
};

export interface CommercialStageProfile {
  stage: CommercialStage;
  objective: string;
  capture: string[];
  avoid: string[];
  nextStep: string;
}

export interface CommercialStageState {
  currentStage: CommercialStage;
  previousStage: CommercialStage | null;
  reason: string;
  confidence: number;
  signals: string[];
  updatedAt: string;
  lastUserMessage: string | null;
}

export interface CommercialStageEvaluation extends CommercialStageState {
  profile: CommercialStageProfile;
}

export interface CommercialConversationContext {
  currentStage: CommercialStage;
  productSlug: string | null;
  askedQuestions: string[];
  answeredFields: string[];
  shownPrice: boolean;
  shownProductMedia: boolean;
  askedCityOrShipping: boolean;
  presentedValue: boolean;
  objectionDetected: boolean;
  lastCommercialObjective: string;
  updatedAt: string;
  lastUserMessage: string | null;
}

export interface CommercialStageClassificationInput {
  latestUserMessage: string;
  history?: CommercialConversationLine[];
  activeProductContext?: CommercialContextLike;
  previousStage?: CommercialStage | null;
  commercialContext?: CommercialConversationContext | null;
}

const commercialStageProfiles: Record<CommercialStage, CommercialStageProfile> = {
  CONEXION: {
    stage: "CONEXION",
    objective: "Generate trust and capture name/context.",
    capture: ["name", "initial trust", "who is writing", "basic context"],
    avoid: ["closing too early", "asking for payment data", "forcing price talk"],
    nextStep: "Ask one simple question that opens the conversation.",
  },
  AVERIGUACION: {
    stage: "AVERIGUACION",
    objective: "Discover the reason for contact and the initial interest.",
    capture: ["reason", "interest", "what the client is looking for"],
    avoid: ["closing", "detailed proposal before need is clear"],
    nextStep: "Clarify what category, model or reference the client wants.",
  },
  DIAGNOSTICO: {
    stage: "DIAGNOSTICO",
    objective: "Detect need, budget, deadline and product usage.",
    capture: ["need", "budget", "deadline", "use case", "business type"],
    avoid: ["generic catalog answers", "payment data", "fast close"],
    nextStep: "Ask the missing diagnostic question to qualify the client.",
  },
  EXPOSICION: {
    stage: "EXPOSICION",
    objective: "Present a personalized proposal and build value before price.",
    capture: ["benefits", "proposal", "fit with the use case", "value"],
    avoid: ["rushing to close", "empty FAQ answers", "price without context"],
    nextStep: "Show the best-fit option and connect it with the diagnosed need.",
  },
  NEGOCIACION: {
    stage: "NEGOCIACION",
    objective: "Handle objections, doubts and purchase pauses.",
    capture: ["real objection", "trust gap", "comparison", "timing concern"],
    avoid: ["tome tu tiempo", "quedo atento", "me avisas", "cuando quieras"],
    nextStep: "Re-anchor value and ask one commercial advance question.",
  },
  ACUERDO: {
    stage: "ACUERDO",
    objective: "Close and collect the minimum data to move forward.",
    capture: ["decision", "delivery details", "payment method", "order data"],
    avoid: ["overexplaining", "reopening the diagnosis", "losing the close"],
    nextStep: "Request the needed data or confirm the purchase flow.",
  },
  POSTVENTA: {
    stage: "POSTVENTA",
    objective: "Follow up, retain and invite re-order or referral.",
    capture: ["delivery status", "satisfaction", "next need", "referrals"],
    avoid: ["pushing a new sale too early", "ignoring the follow-up"],
    nextStep: "Confirm satisfaction and offer follow-up help.",
  },
};

const greetingSignals = [
  "hola",
  "buenas",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "quien eres",
  "como estas",
];

const inquirySignals = [
  "catalogo",
  "catalogo de",
  "catalogo de camillas",
  "modelo",
  "modelos",
  "referencia",
  "referencias",
  "tiene",
  "tienen",
  "muestras",
  "quiero ver",
  "quiero saber",
  "que tienes",
  "que modelos",
];

const diagnosticSignals = [
  "para que",
  "para qué",
  "uso",
  "usaria",
  "usarias",
  "masajes",
  "estetica",
  "estetica facial",
  "tratamientos corporales",
  "negocio",
  "salon",
  "spa",
  "barberia",
  "presupuesto",
  "plazo",
  "ciudad",
  "empezando",
  "montando",
  "abriendo",
  "trabajo con",
];

const exposureSignals = [
  "precio",
  "vale",
  "cuesta",
  "costaria",
  "beneficio",
  "beneficios",
  "caracteristicas",
  "me sirve",
  "me serviria",
  "que incluye",
  "que trae",
  "detalles",
  "fotos",
];

const negotiationSignals = [
  "voy a hablar con mi marido",
  "voy a hablar con mi esposa",
  "lo voy a pensar",
  "despues te aviso",
  "despues te escribo",
  "manana",
  "mas tarde",
  "lo reviso",
  "estoy comparando",
  "esta caro",
  "no paso dinero por adelantado",
  "no paso plata por adelantado",
  "no hago pago por adelantado",
  "no hago abono",
  "no confio",
  "tengo dudas",
  "me da miedo",
  "estoy mirando",
  "estoy viendo opciones",
  "quiero pensarlo",
  "lo consulto",
  "lo consulto con",
];

const agreementSignals = [
  "como compro",
  "como hago para comprar",
  "quiero comprar",
  "quiero el combo",
  "lo quiero",
  "separemos",
  "separalo",
  "apartalo",
  "apartemos",
  "te envio datos",
  "te envio mis datos",
  "te paso mis datos",
  "te paso la direccion",
  "pasa la cuenta",
  "enviame la cuenta",
  "mandame la cuenta",
  "quiero hacer el pedido",
  "quiero cerrar",
  "te lo pago",
  "hagamos el pedido",
];

const postSaleSignals = [
  "ya me llego",
  "ya llego",
  "ya recibi",
  "recibido",
  "instalado",
  "quedo instalado",
  "gracias por la atencion",
  "gracias por todo",
  "todo bien",
  "seguimiento",
  "garantia",
  "reclamo",
];

const passiveNegotiationReplySignals = [
  "tómate tu tiempo",
  "tomate tu tiempo",
  "tome tu tiempo",
  "quedo atento",
  "quedo atenta",
  "me avisas",
  "cuando quieras",
  "aqui estoy para ayudarte",
  "aquí estoy para ayudarte",
  "sin prisa",
  "con calma",
  "cuando estes lista",
  "cuando estes listo",
  "perfecto, tomate tu tiempo",
];

const questionStopWords = new Set([
  "que",
  "como",
  "cual",
  "cuales",
  "cuando",
  "donde",
  "porque",
  "por",
  "favor",
  "me",
  "te",
  "le",
  "nos",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "tu",
  "su",
  "sus",
  "para",
  "con",
  "seria",
  "serian",
  "podria",
  "podrian",
  "puedes",
  "puede",
  "quieres",
  "quiero",
  "ofrecer",
  "ofreces",
  "ofrece",
  "servicio",
  "servicios",
  "espacio",
  "camilla",
  "combo",
  "pregunta",
  "particular",
]);

function normalizeCommercialText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeCommercialText(value)
    .split(" ")
    .filter(Boolean);
}

function normalizePhraseList(values: string[]) {
  return values.map((value) => normalizeCommercialText(value)).filter(Boolean);
}

function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function countSignals(text: string, phrases: string[]) {
  return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
}

function getQuestionSignature(value: string) {
  return tokenize(value)
    .filter((token) => !questionStopWords.has(token))
    .slice(0, 10)
    .join(" ");
}

function getOverlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left).filter((token) => !questionStopWords.has(token)));
  const rightTokens = new Set(tokenize(right).filter((token) => !questionStopWords.has(token)));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function isLikelyQuestionText(value: string) {
  const normalized = normalizeCommercialText(value);
  if (!normalized) {
    return false;
  }

  return value.includes("?") || normalized.startsWith("como ") || normalized.startsWith("cual ") || normalized.startsWith("que ");
}

function detectCommercialAnsweredFields(text: string) {
  const normalized = normalizeCommercialText(text);
  const fields = new Set<string>();

  if (includesAny(normalized, normalizePhraseList(["precio", "cuesta", "vale", "costo", "cuanto vale", "cuanto cuesta"]))) {
    fields.add("price");
  }

  if (includesAny(normalized, normalizePhraseList(["ciudad", "envio", "despacho", "ubicacion", "entrega", "domicilio", "direccion"]))) {
    fields.add("city_or_shipping");
  }

  if (includesAny(normalized, normalizePhraseList(["masajes", "estetica", "tratamientos corporales", "spa", "barberia", "salon"]))) {
    fields.add("use_case");
  }

  if (includesAny(normalized, normalizePhraseList(["presupuesto", "plazo", "mañana", "manana", "luego", "despues", "mas tarde"]))) {
    fields.add("timing_or_budget");
  }

  return Array.from(fields);
}

function buildCommercialFlags(input: CommercialConversationLine[]) {
  const askedQuestions = new Set<string>();
  const answeredFields = new Set<string>();
  let shownPrice = false;
  let shownProductMedia = false;
  let askedCityOrShipping = false;
  let presentedValue = false;
  let objectionDetected = false;

  for (const turn of input) {
    const text = normalizeCommercialText(turn.content ?? "");
    if (!text) {
      continue;
    }

    if (turn.direction === "OUTBOUND") {
      const hasMedia = Boolean(turn.mediaUrl?.trim()) || turn.type === "IMAGE" || turn.type === "VIDEO" || turn.type === "DOCUMENT" || turn.type === "STICKER";
      if (hasMedia) {
        shownProductMedia = true;
      }

      if (text.includes("$") || /\b\d{3,}\b/.test(text) || includesAny(text, normalizePhraseList(["precio", "cuesta", "vale", "costo"]))) {
        shownPrice = true;
      }

      if (includesAny(text, normalizePhraseList(["incluye", "soporta", "respaldo", "beneficio", "ideal", "cómoda", "comoda", "caracteristicas", "te comparto", "te muestro", "fotos", "foto", "video"]))) {
        presentedValue = true;
      }

      if (includesAny(text, normalizePhraseList(["ciudad", "envio", "despacho", "ubicacion", "entrega", "domicilio", "direccion"]))) {
        askedCityOrShipping = true;
      }

      if (isLikelyQuestionText(turn.content ?? "")) {
        const signature = getQuestionSignature(turn.content ?? "");
        if (signature) {
          askedQuestions.add(signature);
        }
      }
    } else {
      for (const field of detectCommercialAnsweredFields(turn.content ?? "")) {
        answeredFields.add(field);
      }

      if (includesAny(text, normalizePhraseList(["voy a hablar", "lo voy a pensar", "lo reviso", "estoy comparando", "mañana", "manana", "despues", "mas tarde", "luego", "no paso dinero", "no confio", "tengo dudas", "me da miedo"]))) {
        objectionDetected = true;
      }
    }
  }

  return {
    askedQuestions: Array.from(askedQuestions),
    answeredFields: Array.from(answeredFields),
    shownPrice,
    shownProductMedia,
    askedCityOrShipping,
    presentedValue,
    objectionDetected,
  };
}

function buildContextText(input: CommercialStageClassificationInput) {
  const historyText = (input.history ?? [])
    .slice(-6)
    .map((item) => item.content?.trim() || "")
    .filter(Boolean)
    .join(" ");

  const activeProductContext = input.activeProductContext ?? null;
  const activeContextParts = [
    activeProductContext?.productName?.trim() || "",
    activeProductContext?.description?.trim() || "",
    activeProductContext?.price?.trim() || "",
    activeProductContext?.instructions?.trim() || "",
  ].filter(Boolean);

  return normalizeCommercialText([
    input.latestUserMessage,
    historyText,
    activeContextParts.join(" "),
  ].filter(Boolean).join(" "));
}

function makeEvaluation(
  stage: CommercialStage,
  input: CommercialStageClassificationInput,
  reason: string,
  confidence: number,
  signals: string[],
): CommercialStageEvaluation {
  return {
    currentStage: stage,
    previousStage: input.previousStage ?? null,
    reason,
    confidence,
    signals,
    updatedAt: new Date().toISOString(),
    lastUserMessage: input.latestUserMessage?.trim() || null,
    profile: commercialStageProfiles[stage],
  };
}

function resolveStageFromLike(context: CommercialStageEvaluation | CommercialStageState | CommercialStageProfile | CommercialStage | CommercialConversationContext | null | undefined) {
  if (!context) {
    return null;
  }

  if (typeof context === "string") {
    return context;
  }

  if ("currentStage" in context && typeof context.currentStage === "string") {
    return context.currentStage as CommercialStage;
  }

  if ("stage" in context && typeof context.stage === "string") {
    return context.stage as CommercialStage;
  }

  return null;
}

export function buildCommercialConversationContext(input: {
  stage: CommercialStageEvaluation | CommercialStageState | CommercialStageProfile | CommercialStage | CommercialConversationContext;
  latestUserMessage: string;
  history?: CommercialConversationLine[];
  activeProductContext?: CommercialContextLike;
  previousContext?: CommercialConversationContext | null;
}): CommercialConversationContext {
  const currentStage = resolveStageFromLike(input.stage) ?? input.previousContext?.currentStage ?? "CONEXION";
  const previous = input.previousContext ?? null;
  const recentLines = (input.history ?? []).slice(-12);
  const flags = buildCommercialFlags(recentLines);
  const productSlug = input.activeProductContext?.slug?.trim() || null;
  const normalizedLatest = normalizeCommercialText(input.latestUserMessage || "");

  const mergedAskedQuestions = new Set(previous?.askedQuestions ?? []);
  for (const question of flags.askedQuestions) {
    mergedAskedQuestions.add(question);
  }

  const mergedAnsweredFields = new Set(previous?.answeredFields ?? []);
  for (const field of flags.answeredFields) {
    mergedAnsweredFields.add(field);
  }

  const lastCommercialObjective = getCommercialStageProfile(currentStage).nextStep;
  const objectionDetected = Boolean(
    previous?.objectionDetected ||
      flags.objectionDetected ||
      includesAny(normalizedLatest, normalizePhraseList(["voy a hablar", "lo voy a pensar", "lo reviso", "estoy comparando", "mañana", "manana", "despues", "mas tarde", "luego", "no paso dinero", "no confio", "tengo dudas", "me da miedo"])),
  );

  return {
    currentStage,
    productSlug: previous?.productSlug ?? productSlug,
    askedQuestions: Array.from(mergedAskedQuestions),
    answeredFields: Array.from(mergedAnsweredFields),
    shownPrice: Boolean(previous?.shownPrice || flags.shownPrice),
    shownProductMedia: Boolean(previous?.shownProductMedia || flags.shownProductMedia),
    askedCityOrShipping: Boolean(previous?.askedCityOrShipping || flags.askedCityOrShipping),
    presentedValue: Boolean(previous?.presentedValue || flags.presentedValue),
    objectionDetected,
    lastCommercialObjective,
    updatedAt: new Date().toISOString(),
    lastUserMessage: input.latestUserMessage?.trim() || null,
  };
}

export function parseCommercialConversationContext(value: unknown): CommercialConversationContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const currentStage =
    typeof raw.currentStage === "string"
      ? raw.currentStage
      : typeof raw.stage === "string"
        ? raw.stage
        : null;

  if (!currentStage) {
    return null;
  }

  return {
    currentStage: currentStage as CommercialStage,
    productSlug: typeof raw.productSlug === "string" ? raw.productSlug : null,
    askedQuestions: Array.isArray(raw.askedQuestions) ? raw.askedQuestions.filter((item): item is string => typeof item === "string") : [],
    answeredFields: Array.isArray(raw.answeredFields) ? raw.answeredFields.filter((item): item is string => typeof item === "string") : [],
    shownPrice: Boolean(raw.shownPrice),
    shownProductMedia: Boolean(raw.shownProductMedia),
    askedCityOrShipping: Boolean(raw.askedCityOrShipping),
    presentedValue: Boolean(raw.presentedValue),
    objectionDetected: Boolean(raw.objectionDetected),
    lastCommercialObjective: typeof raw.lastCommercialObjective === "string" ? raw.lastCommercialObjective : getCommercialStageProfile(currentStage as CommercialStage).nextStep,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    lastUserMessage: typeof raw.lastUserMessage === "string" ? raw.lastUserMessage : null,
  };
}

export function getCommercialStageProfile(stage: CommercialStage): CommercialStageProfile {
  return commercialStageProfiles[stage];
}

export function classifyCommercialStage(input: CommercialStageClassificationInput): CommercialStageEvaluation {
  const latest = normalizeCommercialText(input.latestUserMessage || "");
  const contextText = buildContextText(input);
  const activeProductName = normalizeCommercialText(input.activeProductContext?.productName?.trim() || "");
  const activeProductDescription = normalizeCommercialText(input.activeProductContext?.description?.trim() || "");
  const hasActiveProductContext = Boolean(activeProductName || activeProductDescription || input.activeProductContext?.price?.trim());
  const commercialContext = input.commercialContext ?? null;
  const hasAdvancedCommercialContext = Boolean(
    commercialContext &&
      (commercialContext.currentStage === "EXPOSICION" ||
        commercialContext.currentStage === "NEGOCIACION" ||
        commercialContext.currentStage === "ACUERDO" ||
        commercialContext.currentStage === "POSTVENTA" ||
        commercialContext.shownPrice ||
        commercialContext.shownProductMedia ||
        commercialContext.askedCityOrShipping ||
        commercialContext.presentedValue),
  );

  if (!latest) {
    return makeEvaluation(
      commercialContext?.currentStage ?? input.previousStage ?? "CONEXION",
      input,
      "Empty message, keep previous stage or start from connection.",
      0,
      [],
    );
  }

  const postSaleHits = countSignals(latest, normalizePhraseList(postSaleSignals));
  if (postSaleHits > 0) {
    return makeEvaluation("POSTVENTA", input, "Post-sale / follow-up signal detected.", 95, postSaleSignals.filter((signal) => latest.includes(normalizeCommercialText(signal))));
  }

  const negotiationHits = countSignals(latest, normalizePhraseList(negotiationSignals));
  if (negotiationHits > 0 || (hasAdvancedCommercialContext && includesAny(latest, normalizePhraseList(["mañana", "manana", "luego", "despues", "más tarde", "mas tarde", "te confirmo", "lo reviso"])))) {
    return makeEvaluation("NEGOCIACION", input, "Purchase pause or objection detected.", 90, negotiationSignals.filter((signal) => latest.includes(normalizeCommercialText(signal))));
  }

  const agreementHits = countSignals(latest, normalizePhraseList(agreementSignals));
  if (agreementHits > 0) {
    const directAgreementSignals = agreementSignals.filter((signal) => latest.includes(normalizeCommercialText(signal)));
    return makeEvaluation(
      "ACUERDO",
      input,
      "Explicit purchase intent or checkout signal detected.",
      88,
      directAgreementSignals,
    );
  }

  const diagnosticHits = countSignals(contextText, normalizePhraseList(diagnosticSignals));
  if (diagnosticHits > 0 && !hasAdvancedCommercialContext) {
    return makeEvaluation("DIAGNOSTICO", input, "Need, budget, timeline or use-case signal detected.", 78, diagnosticSignals.filter((signal) => contextText.includes(normalizeCommercialText(signal))));
  }

  if (diagnosticHits > 0 && hasAdvancedCommercialContext) {
    return makeEvaluation(
      commercialContext?.currentStage ?? input.previousStage ?? "EXPOSICION",
      input,
      "Conversation already advanced; avoid reopening diagnostics.",
      55,
      diagnosticSignals.filter((signal) => contextText.includes(normalizeCommercialText(signal))),
    );
  }

  const exposureHits = countSignals(contextText, normalizePhraseList(exposureSignals));
  if (exposureHits > 0 && hasActiveProductContext) {
    return makeEvaluation("EXPOSICION", input, "Product context present and value / price discussion detected.", 72, exposureSignals.filter((signal) => contextText.includes(normalizeCommercialText(signal))));
  }

  const inquiryHits = countSignals(contextText, normalizePhraseList(inquirySignals));
  if (inquiryHits > 0 && !hasAdvancedCommercialContext) {
    return makeEvaluation("AVERIGUACION", input, "Catalog / model / reference inquiry detected.", 70, inquirySignals.filter((signal) => contextText.includes(normalizeCommercialText(signal))));
  }

  const greetingHits = countSignals(latest, normalizePhraseList(greetingSignals));
  if (greetingHits > 0 && !hasAdvancedCommercialContext) {
    return makeEvaluation("CONEXION", input, "Greeting or first-contact signal detected.", 55, greetingSignals.filter((signal) => latest.includes(normalizeCommercialText(signal))));
  }

  if (hasAdvancedCommercialContext) {
    return makeEvaluation(
      commercialContext?.currentStage ?? input.previousStage ?? "EXPOSICION",
      input,
      "Keep the advanced commercial stage and avoid restarting the funnel.",
      58,
      [],
    );
  }

  if (hasActiveProductContext) {
    return makeEvaluation("EXPOSICION", input, "Active product context exists, defaulting to value presentation.", 62, [input.activeProductContext?.productName?.trim() || "active product context"]);
  }

  return makeEvaluation(input.previousStage ?? "CONEXION", input, "No strong stage signal detected; keep or default to connection.", 35, []);
}

export function buildCommercialStagePromptSection(context: CommercialStageEvaluation | CommercialStageState | CommercialStageProfile) {
  const stage: CommercialStage = "currentStage" in context
    ? context.currentStage
    : "stage" in context
      ? context.stage
      : "CONEXION";
  const profile = getCommercialStageProfile(stage);

  const sharedRules =
    stage === "NEGOCIACION"
      ? [
          "If the customer pauses the purchase, treat it as a commercial objection.",
          "Do not answer with passive phrases like 'toma tu tiempo', 'quedo atento', 'me avisas', or 'cuando quieras'.",
          "Use this structure: brief validation + value re-anchoring + one commercial advance question.",
        ]
      : [
          "Respect the current stage and do not skip ahead to data capture or closing before the stage allows it.",
        ];

  return [
    "ETAPA COMERCIAL ACTUAL",
    `- Etapa: ${profile.stage}`,
    `- Objetivo: ${profile.objective}`,
    `- Debe capturar: ${profile.capture.join(", ")}`,
    `- Debe evitar: ${profile.avoid.join(", ")}`,
    `- Siguiente paso permitido: ${profile.nextStep}`,
    ...sharedRules.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function buildCommercialConversationContextPromptSection(context: CommercialConversationContext) {
  const askedQuestions = context.askedQuestions.slice(-5);
  const answeredFields = context.answeredFields.slice(-8);

  return [
    "CONTEXTO COMERCIAL ACUMULADO",
    `- Etapa actual: ${context.currentStage}`,
    `- Producto activo: ${context.productSlug ?? "sin producto"}`,
    `- Precio mostrado: ${context.shownPrice ? "si" : "no"}`,
    `- Fotos / video mostrados: ${context.shownProductMedia ? "si" : "no"}`,
    `- Ciudad / envio ya consultado: ${context.askedCityOrShipping ? "si" : "no"}`,
    `- Valor presentado: ${context.presentedValue ? "si" : "no"}`,
    `- Objecion detectada: ${context.objectionDetected ? "si" : "no"}`,
    askedQuestions.length ? `- Preguntas ya hechas: ${askedQuestions.join(" | ")}` : null,
    answeredFields.length ? `- Campos ya cubiertos: ${answeredFields.join(", ")}` : null,
    `- Objetivo comercial actual: ${context.lastCommercialObjective}`,
    "- No repitas preguntas ya cubiertas por el historial.",
    "- Si el precio, las fotos o el envio ya fueron tratados, no vuelvas a abrir la etapa de diagnostico.",
    "- Si la conversacion ya esta avanzada, responde sobre lo pendiente o avanza al siguiente paso comercial.",
  ].filter(Boolean).join("\n");
}

export function shouldRequestPurchaseData(stage: CommercialStage) {
  return stage === "ACUERDO";
}

export function shouldPrioritizeCommercialStageOverFaq(stage: CommercialStage) {
  return stage === "CONEXION" || stage === "AVERIGUACION" || stage === "DIAGNOSTICO";
}

export function isPassiveNegotiationReply(value: string) {
  const normalized = normalizeCommercialText(value);
  if (!normalized) {
    return true;
  }

  return normalizePhraseList(passiveNegotiationReplySignals).some((phrase) => normalized.includes(phrase));
}

export function buildNegotiationAdvanceReply(input: {
  latestUserMessage: string;
  activeProductContext?: CommercialContextLike;
}) {
  const latest = normalizeCommercialText(input.latestUserMessage);
  const productName = input.activeProductContext?.productName?.trim() || "";
  const productLabel = productName ? `*${productName}*` : "la opcion";

  if (includesAny(latest, normalizePhraseList(["marido", "esposa", "esposo", "familia", "lo reviso", "lo voy a pensar", "mas tarde", "despues te aviso"]))) {
    return `Claro 😊 Para que lo revisen mejor, ¿quieres que te deje el resumen del ${productLabel} con precio, lo que incluye y el siguiente paso para comprarlo?`;
  }

  if (includesAny(latest, normalizePhraseList(["esta caro", "precio", "pago", "adelanto", "confianza", "duda", "comparando"]))) {
    return `Claro 👍 Para ayudarte a decidir mejor, ¿lo estas revisando mas por *precio*, *espacio* o *confianza* en la compra?`;
  }

  return `Entiendo 👌 Para avanzar sin perder el hilo, ¿quieres que te deje el resumen del ${productLabel} con precio y lo que incluye o prefieres revisar primero alguna duda puntual?`;
}

export function shouldOverrideNegotiationReply(value: string) {
  const normalized = normalizeCommercialText(value);
  if (!normalized) {
    return true;
  }

  if (!value.includes("?")) {
    return true;
  }

  return isPassiveNegotiationReply(value);
}

export function shouldAvoidCommercialOpeningRepeat(replyText: string, context: CommercialConversationContext | null | undefined) {
  if (!context) {
    return false;
  }

  const normalizedReply = normalizeCommercialText(replyText);
  if (!normalizedReply || !normalizedReply.includes("?")) {
    return false;
  }

  const advancedStage = context.currentStage === "EXPOSICION" || context.currentStage === "NEGOCIACION" || context.currentStage === "ACUERDO" || context.currentStage === "POSTVENTA";
  if (!advancedStage) {
    return false;
  }

  const replySignature = getQuestionSignature(replyText);
  if (!replySignature) {
    return false;
  }

  if (
    advancedStage &&
    normalizedReply.includes("servicios") &&
    normalizedReply.includes("ofrecer") &&
    (normalizedReply.includes("camilla") || normalizedReply.includes("espacio") || normalizedReply.includes("masajes") || normalizedReply.includes("estetica"))
  ) {
    return true;
  }

  const repeatedFromHistory = context.askedQuestions.some((question) => getOverlapScore(replySignature, question) >= 0.45);
  if (repeatedFromHistory) {
    return true;
  }

  const openingTokens = ["servicios", "ofrecer", "masajes", "estetica", "tratamientos", "camilla", "espacio"];
  const hasOpeningTokens = openingTokens.filter((token) => normalizeCommercialText(replyText).includes(token)).length >= 2;
  return hasOpeningTokens && Boolean(context.shownPrice || context.shownProductMedia || context.askedCityOrShipping || context.presentedValue);
}

export function shouldOverrideCommercialReply(replyText: string, context: CommercialConversationContext | null | undefined) {
  if (!context) {
    return false;
  }

  const normalizedReply = normalizeCommercialText(replyText);
  const advancedStage = context.currentStage === "EXPOSICION" || context.currentStage === "NEGOCIACION" || context.currentStage === "ACUERDO" || context.currentStage === "POSTVENTA";
  if (
    advancedStage &&
    normalizedReply.includes("servicios") &&
    normalizedReply.includes("ofrecer") &&
    (normalizedReply.includes("camilla") || normalizedReply.includes("espacio") || normalizedReply.includes("masajes") || normalizedReply.includes("estetica"))
  ) {
    return true;
  }

  if (context.currentStage === "NEGOCIACION" && shouldOverrideNegotiationReply(replyText)) {
    return true;
  }

  return shouldAvoidCommercialOpeningRepeat(replyText, context);
}

export const commercialStageFixtures = [
  {
    input: "voy a hablar con mi marido",
    expectedStage: "NEGOCIACION",
  },
  {
    input: "lo voy a pensar",
    expectedStage: "NEGOCIACION",
  },
  {
    input: "quiero ver camillas",
    expectedStage: "AVERIGUACION",
  },
  {
    input: "como compro",
    expectedStage: "ACUERDO",
  },
  {
    input: "ya me llego, gracias",
    expectedStage: "POSTVENTA",
  },
  {
    input: "manana lo voy a ver",
    expectedStage: "NEGOCIACION",
  },
] as const;
