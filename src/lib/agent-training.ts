import {
  buildCommercialConversationContextPromptSection,
  buildCommercialStagePromptSection,
  type CommercialConversationContext,
  type CommercialStageEvaluation,
} from "@/lib/commercial-stage";

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
    label: "Profesional y directo",
    prompt: "Habla de forma profesional, directa y clara. Prioriza la solución, evita charla casual y mantén un tono comercial.",
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
  assistantName: string;
  businessDescription: string;
  sectorRubro: string;
  instruction: string;
  targetAudiences: TargetAudience[];
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
  // Toggles de Agente V2: si están en false, el motor NO ofrece esa tool al modelo.
  // Ausente/undefined => true (preserva el comportamiento de V1, que siempre las tiene).
  enableProductLookup: boolean;
  enableFlowLookup: boolean;
  // Motor IA-primero: cuando es true, se apaga el DISPARO AUTOMÁTICO de flujos (el motor
  // determinístico deja de elegir/mandar catálogos por su cuenta) y la IA decide, usando la
  // tool enviar_flujo. La EJECUCIÓN de flujos (getFlowReply + envío de pasos) NO cambia: es la
  // misma máquina, solo que ahora la dispara la IA. Ausente/undefined => false: el disparo
  // automático sigue como hasta ahora, sin cambios.
  aiDrivenFlows?: boolean;
  actions: AgentActionsConfig;
  useCustomPrompt: boolean;
  customSystemPrompt: string;
};

export type AgentNotifyActionConfig = {
  enabled: boolean;
  destinationPhoneNumber: string;
  destinationPhoneNumbers: string[];
  instruction: string;
  pauseConversationAfterNotify: boolean;
  autoNotifyOnUnknownProduct: boolean;
};

export type AgentActionsConfig = {
  notify: AgentNotifyActionConfig;
};

export type AgentKnowledgePromptProduct = {
  followUpFlowId?: string | null;
  code?: string | null;
  slug?: string | null;
  name: string;
  description?: string | null;
  price?: string | null;
  categoryName?: string | null;
  thumbnailUrl?: string | null;
  funnelOpening?: string | null;
  funnelQualification?: string | null;
  funnelPresentation?: string | null;
  funnelFaq?: string | null;
  funnelClosing?: string | null;
  instructions?: string | null;
};

export type AgentKnowledgePromptFlow = {
  id: string;
  title: string;
  intent?: string | null;
  description?: string | null;
  sourceLabel?: string | null;
};

export const defaultAgentTrainingConfig: AgentTrainingConfig = {
  assistantName: "",
  businessDescription: "",
  sectorRubro: "",
  instruction: "",
  targetAudiences: ["Mujer"],
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
  enableProductLookup: true,
  enableFlowLookup: true,
  aiDrivenFlows: false,
  actions: {
    notify: {
      enabled: false,
      destinationPhoneNumber: "",
      destinationPhoneNumbers: [],
      instruction: "",
      pauseConversationAfterNotify: false,
      autoNotifyOnUnknownProduct: false,
    },
  },
  useCustomPrompt: false,
  customSystemPrompt: "",
};

function getTonePrompt(value: SalesTone) {
  return toneOptions.find((item) => item.value === value)?.prompt ?? toneOptions[1].prompt;
}

function getResponseLengthPrompt(value: ResponseLength) {
  return responseLengthOptions.find((item) => item.value === value)?.prompt ?? responseLengthOptions[1].prompt;
}

export function getToneLabel(value: SalesTone) {
  return toneOptions.find((item) => item.value === value)?.label ?? "Profesional y directo";
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

export function buildAgentTrainingConfig(
  // Los toggles de tools son opcionales: V1 no los setea y por defecto van en true
  // (siempre ofrece las tools). Solo Agente V2 los pasa explícitamente.
  input: Omit<AgentTrainingConfig, "enableProductLookup" | "enableFlowLookup"> &
    Partial<Pick<AgentTrainingConfig, "enableProductLookup" | "enableFlowLookup">>,
): AgentTrainingConfig {
  const notify = input.actions.notify;

  return {
    ...input,
    sectorRubro: input.sectorRubro?.trim() ?? "",
    targetAudiences: input.targetAudiences.filter((value, index, array) => array.indexOf(value) === index),
    forbiddenRules: input.forbiddenRules.filter(Boolean),
    customWelcomeMessage: input.customWelcomeMessage.trim(),
    customRules: input.customRules.trim(),
    knowledgeFlowIds: input.knowledgeFlowIds.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index),
    enableProductLookup: input.enableProductLookup !== false,
    enableFlowLookup: input.enableFlowLookup !== false,
    aiDrivenFlows: input.aiDrivenFlows === true,
    actions: {
      notify: {
        enabled: Boolean(notify.enabled),
        destinationPhoneNumber: notify.destinationPhoneNumber.trim(),
        destinationPhoneNumbers: (notify.destinationPhoneNumbers ?? []).map((value) => value.trim()).filter(Boolean),
        instruction: notify.instruction.trim(),
        pauseConversationAfterNotify: Boolean(notify.pauseConversationAfterNotify),
        autoNotifyOnUnknownProduct: Boolean(notify.autoNotifyOnUnknownProduct),
      },
    },
  };
}

export function buildDefaultNewCustomerWelcomeMessage(businessName: string) {
  const normalizedBusinessName = businessName.trim() || "[nombre del negocio]";
  return `Bienvenido/a a *${normalizedBusinessName}*\n\nDime qué producto buscas y te comparto la opción adecuada.`;
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
  commercialStageContext?: CommercialStageEvaluation | null;
  commercialConversationContext?: CommercialConversationContext | null;
}) {
  const { businessName, training } = input;
  const agentName = training.assistantName?.trim() || input.agentName;
  const sectorRubro = training.sectorRubro?.trim() || "No definido";
  const businessDataLines = [
    `* **Nombre:** ${businessName.trim() || "No definido"}`,
    `* **Sector/Rubro:** ${sectorRubro}`,
    training.location?.trim() ? `* **Ubicación/Dirección:** ${training.location.trim()}` : null,
    `* **Horarios de atención:** No definido`,
    training.contactPhone?.trim() ? `* **Número de contacto:** ${training.contactPhone.trim()}` : null,
    training.contactEmail?.trim() ? `* **Correo electrónico:** ${training.contactEmail.trim()}` : null,
    training.website?.trim() ? `* **Sitio web:** ${training.website.trim()}` : null,
    training.facebook?.trim() ? `* **Facebook:** ${training.facebook.trim()}` : null,
    training.instagram?.trim() ? `* **Instagram:** ${training.instagram.trim()}` : null,
    training.tiktok?.trim() ? `* **TikTok:** ${training.tiktok.trim()}` : null,
    training.youtube?.trim() ? `* **YouTube:** ${training.youtube.trim()}` : null,
  ].filter(Boolean) as string[];
  const businessNotes = training.businessDescription.trim()
    ? `Notas adicionales:\n${training.businessDescription.trim()}`
    : "Notas adicionales:\nSin notas adicionales.";
  const voiceRules = [
    `Adopta este tono como prioridad: ${getTonePrompt(training.salesTone)}`,
    `Longitud de respuesta obligatoria: ${getResponseLengthPrompt(training.responseLength)}`,
    training.useTuteo ? "Trata al cliente de tu, no de usted." : "No fuerces el tuteo; habla de forma neutral o respetuosa.",
    training.useCustomerName
      ? "Si ya conoces el nombre del cliente, usalo de forma natural para personalizar la conversacion."
      : "No inventes ni forces el nombre del cliente si no lo conoces.",
    training.useEmojis
      ? "Usa emojis solo cuando aporten claridad comercial; no los uses para sonar afectuoso o informal."
      : "No uses emojis salvo que aporten claridad real al mensaje.",
    training.useExpressivePunctuation
      ? "Usa signos expresivos como ! y ? cuando refuercen la cercania y el cierre comercial."
      : "No abuses de signos expresivos; prioriza claridad y limpieza.",
  ];

  const salesBehaviors = [
    training.askNameFirst
      ? training.greetNewCustomers
        ? `Si aun no sabes el nombre del cliente, preséntate ÚNICAMENTE con tu nombre ("Soy ${agentName}") sin agregar "de ${businessName}" ni ninguna referencia al negocio —el saludo de bienvenida ya lo mencionó arriba— y pide el nombre del cliente para continuar.`
        : "Si aun no sabes el nombre del cliente, tu primera respuesta debe presentarte y pedir su nombre antes de seguir vendiendo."
      : "No pidas el nombre al inicio si no hace falta para avanzar.",
    training.greetNewCustomers
      ? `El saludo inicial del chat lo maneja la aplicacion con este texto: "${resolveWelcomeMessageTemplate(training.customWelcomeMessage || buildDefaultNewCustomerWelcomeMessage(businessName), businessName)}". Solo debe usarse cuando la conversacion esta vacia; si ya existe historial, no lo repitas ni lo vuelvas a agregar.`
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

  const communicationDirectives = [
    "En cada mensaje, aplica negrita de WhatsApp (*texto* con un solo asterisco) a: nombres de productos, precios, nombre del negocio y llamadas a la acción. No uses negrita en frases completas, solo en los datos clave.",
    "Si el cliente se desvía, redirige con sutileza y resuelve objeciones de forma discreta.",
    "Evita repetir respuestas para mantener la fluidez y el profesionalismo.",
    "Evita frases genéricas como '¿En qué puedo ayudarte?'; responde de forma proactiva según el contexto.",
    "No agregues corchetes, llaves, asteriscos, paréntesis ni caracteres especiales dentro de enlaces.",
    "Cíñete estrictamente a la Base de Conocimiento. No inventes respuestas.",
    "Usa emoticones y saltos de línea para personalizar y hacer atractivos los mensajes cuando aporte claridad y cercanía.",
    "Adapta tu tono al del usuario, manteniendo respuestas breves, concisas y optimizadas para WhatsApp.",
    "Si el mensaje tiene 245 caracteres o menos, escribe un solo bloque.",
    "Si el mensaje supera 245 caracteres, usa máximo 3 párrafos con 2 saltos de línea entre ellos.",
    "Resalta en negrita (*texto*) al menos un dato importante por mensaje: producto, precio, acción o nombre del negocio.",
    "Los enlaces deben enviarse con 2 saltos de línea, sin comillas ni artefactos de código.",
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

  const instructionSection = training.instruction.trim()
    ? `INSTRUCCIÓN\n- ${training.instruction.trim()}`
    : null;

  const businessRules = [
    `Solo vendes esto: ${training.businessDescription}`,
    `Tu cliente ideal es: ${training.targetAudiences.join(", ")}`,
    `Rango de precios de referencia: ${formatPriceRange(training.priceRangeMax)}`,
    "No te salgas de esta informacion ni inventes catalogo adicional.",
  ].filter(Boolean) as string[];

  const strictRules = guardrails.length
    ? guardrails
    : ["No inventes informacion.", "No prometas algo que el negocio no pueda cumplir."];

  // CATÁLOGO COMPACTO: solo el índice de lo que se vende (nombre + código + una línea de qué
  // es). El DETALLE de cada producto (embudo, precio, medidas, cómo presentarlo) NO se hornea
  // en el prompt: se trae on-demand con consultar_productos y con el CONTEXTO DEL PRODUCTO
  // ACTIVO (que inyecta SOLO el producto del que se está hablando). Antes se pegaban TODOS los
  // embudos ("responde EXACTAMENTE este mensaje…") de todos los productos, y la IA aplicaba el
  // guion de un producto a otro distinto (p.ej. la política de color de lavacabezas a poltronas).
  const knowledgeProducts = (input.knowledgeProducts ?? [])
    .map((product) => {
      const name = product.name.trim();
      if (!name) {
        return null;
      }

      const parts = [name];
      if (product.code?.trim()) {
        parts.push(`código ${product.code.trim()}`);
      }
      const shortDescription = product.description?.trim()
        ? product.description.trim().split(/[.\n]/)[0].trim().slice(0, 120)
        : "";
      if (shortDescription) {
        parts.push(shortDescription);
      }

      return parts.join(" — ");
    })
    .filter((item): item is string => Boolean(item));

  const knowledgeSection = knowledgeProducts.length
    ? `CATÁLOGO DE PRODUCTOS (índice)\n- ${knowledgeProducts.join("\n- ")}\n- Esto es SOLO el índice de lo que vendes. Para el detalle de UN producto (precio, medidas, beneficios, cómo presentarlo) llama a consultar_productos ANTES de responder sobre ese producto.\n- Responde SOLO sobre el producto del que se está hablando: NUNCA apliques el precio, los colores, la política de despacho o los mensajes de un producto a otro distinto.\n- No inventes productos ni datos fuera de este catálogo. Si preguntan por algo que no está, no lo niegues en seco: deriva a un asesor.`
    : null;

  const consultationToolsSection = [
    "HERRAMIENTAS DE CONSULTA",
    "- Si el cliente pregunta por un producto, consulta primero la herramienta consultar_productos antes de responder.",
    "- Si la consulta habla de catalogo, opciones, modelos, referencias o quieres validar si existe un recorrido, usa consultar_flujos.",
    "- Si un producto tiene flujo hijo, ese flujo hijo solo puede usarse a partir del siguiente turno despues de que el producto ya fue consultado o ejecutado; nunca lo actives en el mismo mensaje en que se detecta el producto.",
    "- Si ya existe un producto activo con flujo hijo habilitado por contexto previo, ese flujo hijo puede consultarse o ejecutarse; si no esta habilitado, no lo ofrezcas ni lo actives.",
    "- Si consultar_productos no encuentra un producto claro, no inventes; usa consultar_flujos o sigue con una sola pregunta breve segun el contexto.",
    "- Si consultar_flujos no encuentra un recorrido claro, sigue con el agente normal o deriva a un asesor segun corresponda.",
    "- No mezcles informacion de varios productos o flujos en una sola respuesta si la consulta no fue clara.",
  ].join("\n");

  const knowledgeFlows = (input.knowledgeFlows ?? [])
    .map((flow) => {
      const title = flow.title.trim();
      if (!title) {
        return null;
      }

      const summary = [`Flujo disponible: ${title}`];
      if (flow.intent?.trim()) {
        summary.push(`Intencion: ${flow.intent.trim()}`);
      }
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
    ? `CONOCIMIENTO DE FLUJOS\n- ${knowledgeFlows.join("\n- ")}\n- Si la conversacion coincide con la intencion de uno de estos recorridos, ejecútalo o guia al cliente hacia ese flujo con claridad.\n- No inventes automatizaciones ni pasos que no existan en esta base.`
    : null;

  const commercialStageSection = input.commercialStageContext
    ? buildCommercialStagePromptSection(input.commercialStageContext)
    : null;
  const commercialConversationSection = input.commercialConversationContext
    ? buildCommercialConversationContextPromptSection(input.commercialConversationContext)
    : null;

  // Metodología ÚNICA de venta, product-agnóstica. Reemplaza los embudos rígidos por-producto
  // que antes se horneaban: la IA conversa naturalmente y trae el detalle de cada producto
  // on-demand, sin scripts literales que se mezclen entre productos.
  const playbookSection = [
    "PLAYBOOK DE VENTA (aplica IGUAL a todos los productos)",
    "Conversa de forma natural siguiendo esta metodología. NO uses mensajes fijos ni scripts literales; adapta las palabras al cliente y al producto del que se está hablando.",
    "1. Apertura: saluda, presenta brevemente el negocio y pregunta qué busca o en qué puedes ayudarle.",
    "2. Calificación: entiende qué necesita (qué producto, para qué espacio o uso). Una sola pregunta a la vez.",
    training.aiDrivenFlows
      ? "3. Presentación: cuando el cliente concreta un producto, llama a consultar_productos para su detalle y preséntalo por su valor. Si hay un catálogo/flujo para lo que pidió, ENVÍALO VOS con enviar_flujo (ver la sección ENVÍO DE CATÁLOGOS). No esperes a que otro lo mande."
      : "3. Presentación: cuando el cliente concreta un producto, llama a consultar_productos para su detalle y preséntalo por su valor (para qué sirve, beneficios). Si hay un catálogo/flujo para ese producto, lo envía el motor de flujos.",
    "4. Objeciones: si duda o pausa la compra, valida + re-ancla el valor + una pregunta que avance. Evita frases pasivas ('quedo atento', 'cuando quieras').",
    "5. Cierre: cuando muestra intención, pide los datos para cotizar (color, ciudad, nombre, dirección) y avanza al cierre.",
    "REGLA ANTI-REGRESIÓN: una vez que el cliente eligió un producto o la conversación ya avanzó, NUNCA reinicies el embudo ni repitas la pregunta de apertura/calificación (p.ej. '¿qué servicios vas a ofrecer?'). Avanza siempre al siguiente paso comercial.",
    "REGLA DE UN SOLO PRODUCTO: cada respuesta trata del producto en curso. Nunca traigas el precio, colores, política de despacho o guion de otro producto distinto.",
  ].join("\n");

  const sections = [
    `## 🏢 DATOS DEL NEGOCIO\n\n${businessDataLines.join("\n")}\n\n${businessNotes}\n\n---`,
    `ROL\nEres un asesor comercial experto por whatsapp de ${businessName}. Actuas como una persona real del negocio y tu trabajo es vender con claridad, precision y criterio comercial.`,
    `OBJETIVO\nTu objetivo es entender lo que necesita el cliente, responder solo dentro de la realidad del negocio y llevar la conversacion hacia una venta real o al siguiente paso correcto.`,
    `REGLAS NO NEGOCIABLES\n- ${nonNegotiables.join("\n- ")}`,
    instructionSection,
    `CONTEXTO DEL NEGOCIO\n- ${businessRules.join("\n- ")}${contactLines.length ? `\n\nDATOS DE CONTACTO\n- ${contactLines.join("\n- ")}` : ""}`,
    `COMO HABLAS\n- ${voiceRules.join("\n- ")}`,
    `COMPORTAMIENTO DE VENTA\n- ${salesBehaviors.join("\n- ")}`,
    playbookSection,
    training.aiDrivenFlows
      ? [
          "ENVÍO DE CATÁLOGOS (herramienta enviar_flujo)",
          "VOS decidís qué catálogo/flujo mandar y cuándo, como un buen vendedor. Los flujos son el contenido (fotos, PDFs) que le mostrás al cliente.",
          "REGLA DE ORO: UN SOLO PRODUCTO A LA VEZ. Mandá SOLO el catálogo del producto del que se está hablando en ESTA conversación. Si el cliente vino por camillas, mandás camillas y NADA MÁS. Por defecto se envía UN SOLO flujo. Mandar un catálogo que el cliente no pidió (ej: mandar manicura cuando hablan de camillas) es un ERROR GRAVE — nunca lo hagas, aunque parezca 'un extra útil'.",
          "OJO con la palabra 'combo': que el cliente diga 'combo' NO es permiso para mandar todos los combos que existen. Hay varios (combo de camillas, combo lavacabezas, combo mesa y sillas de manicura). Mandá SOLO el combo del producto que está en contexto. No mezcles: 'combo' + camilla = combo de camillas, y punto; jamás sumes el combo de manicura ni otros solo porque comparten la palabra 'combo'.",
          "1. CONCRETO → mandá directo, sin preguntar de más. Si el cliente nombra algo que corresponde a UN catálogo, llamá consultar_flujos para el flow_id exacto y enviá con enviar_flujo de inmediato (UN flujo). Ej: 'silla de peluquería' → catálogo de sillas; 'lavacabezas' → catálogo de lavacabezas; 'camillas' → catálogo de camillas.",
          "   OJO con camillas: 'camillas' manda el flujo de camillas, que YA incluye el combo de camillas adentro. No lo trates como un producto aparte ni te pongas a calificar: mandá SOLO el catálogo de camillas.",
          "2. CATEGORÍA AMPLIA o AMBIGÜEDAD REAL (varios subtipos y no sabés cuál) → NO mandes al azar ni mandes todos. OFRECÉ las opciones y preguntá cuál. Ej: '¿tienen sillas?' → 'Tenemos sillas de peluquería, de barbería, neumáticas... ¿cuál te interesa?'. Solo enviá VARIOS flujos a la vez si el cliente tiene que ELEGIR entre ellos y se lo estás preguntando en el mismo mensaje — nunca como catálogos 'de más'.",
          "   Si en esa categoría hay UNA sola opción → mandala directo, no preguntes al pedo.",
          "3. Usá el flow_id EXACTO que devolvió consultar_flujos. NUNCA inventes un id.",
          "4. NUNCA mandes un catálogo que no corresponde a lo que pidió el cliente. Si habla de camillas, JAMÁS mandes manicura, sillas ni ningún otro. Ante la duda de si un flujo corresponde, NO lo mandes.",
          "5. consultar_flujos y consultar_productos son INTERNOS: el cliente NO los ve. Nunca le digas 'espera, consulto'. Consultá en silencio y respondé con el resultado.",
          "6. Después de que enviar_flujo confirma el envío, NO describas el catálogo de nuevo ni lo reenvíes. Los flujos YA traen su propio mensaje de cierre (p.ej. 'revísalo y contame qué código/color te interesa'). Por eso: si mandaste UN SOLO flujo, NO agregues otra pregunta de cierre (el flujo ya cerró) — quedate callado o una línea muy corta. Preguntá cuál le interesa SOLO si mandaste VARIOS y el cliente tiene que elegir.",
        ].join("\n")
      : null,
    `DIRECTIVAS DE COMUNICACIÓN CON EL USUARIO\n- ${communicationDirectives.join("\n- ")}`,
    consultationToolsSection,
    knowledgeSection,
    flowKnowledgeSection,
    commercialStageSection,
    commercialConversationSection,
    `REFERENCIAS A FLUJOS\n- Si un embudo de producto menciona un flujo con formato /nombre del flujo, interpretalo como una orden de aplicar ese flujo cuando la conversacion coincida.\n- Usa solo flujos que existan en CONOCIMIENTO DE FLUJOS. Si el flujo mencionado no esta disponible, no lo inventes y continua con una pregunta concreta para avanzar.`,
    training.actions.notify.enabled
      ? `HERRAMIENTA DISPONIBLE\n- ${
          training.actions.notify.instruction.trim()
            ? `Usa la herramienta Notificar_asesor cuando: ${training.actions.notify.instruction.trim()}.`
            : "Si el cliente pide hablar con un asesor, necesita validacion humana o la conversación requiere seguimiento comercial, usa la herramienta Notificar_asesor."
        }\n- No la uses para dudas que puedas resolver por tu cuenta.\n- Cuando la uses, entrega un motivo claro y un resumen breve del caso.`
      : null,
    training.actions.notify.autoNotifyOnUnknownProduct
      ? `REGLA EXTRA DE ESCALAMIENTO\n- Si el cliente pregunta por un producto o catalogo que no existe en la base de conocimiento, deriva inmediatamente a un asesor y no respondas con una negacion.`
      : null,
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
  const { businessName, training } = input;
  const agentName = training.assistantName?.trim() || input.agentName;
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
    priceRange: formatPriceRange(training.priceRangeMax),
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
      training.actions.notify.pauseConversationAfterNotify ? "Apaga la automatizacion al notificar" : null,
      training.actions.notify.autoNotifyOnUnknownProduct ? "Notifica si no conoce el producto" : null,
      training.actions.notify.enabled ? "Notifica a asesor humano" : null,
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
    assistantName: str("assistantName"),
    businessDescription: data.businessDescription,
    sectorRubro: str("sectorRubro"),
    instruction: str("instruction"),
    targetAudiences,
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
    enableProductLookup: data.enableProductLookup !== false,
    enableFlowLookup: data.enableFlowLookup !== false,
    aiDrivenFlows: data.aiDrivenFlows === true,
    actions: normalizeAgentActionsConfig(data.actions),
    useCustomPrompt: Boolean(data.useCustomPrompt),
    customSystemPrompt: typeof data.customSystemPrompt === "string" ? data.customSystemPrompt : "",
  };
}

function normalizeAgentActionsConfig(value: unknown): AgentActionsConfig {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const notify = data.notify && typeof data.notify === "object" && !Array.isArray(data.notify)
    ? data.notify as Record<string, unknown>
    : {};

  return {
    notify: {
      enabled: Boolean(notify.enabled),
      destinationPhoneNumber: typeof notify.destinationPhoneNumber === "string" ? notify.destinationPhoneNumber.trim() : "",
      destinationPhoneNumbers: Array.isArray(notify.destinationPhoneNumbers)
        ? notify.destinationPhoneNumbers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
        : [],
      instruction: typeof notify.instruction === "string" ? notify.instruction.trim() : "",
      pauseConversationAfterNotify: Boolean(notify.pauseConversationAfterNotify),
      autoNotifyOnUnknownProduct: Boolean(notify.autoNotifyOnUnknownProduct),
    },
  };
}

function formatPriceRange(max: string) {
  const maxValue = max.trim();

  if (maxValue) {
    return `Hasta ${maxValue}`;
  }

  return "No definido";
}
