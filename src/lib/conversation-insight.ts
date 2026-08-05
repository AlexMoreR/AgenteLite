import { prisma } from "@/lib/prisma";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

/**
 * Leer una conversacion y dejar escrito que paso.
 *
 * El CRM sabe quien escribio y cuando, pero no QUE pidio ni POR QUE se cayo: eso vive en el texto
 * del chat y solo lo sabe quien lo abre y lo lee entero. Aca lo lee la IA una vez y queda
 * guardado, para poder contarlo de a cientos —"14 se cayeron por envio"— en vez de leerlos de a
 * uno.
 *
 * No reemplaza a nadie leyendo: dice DONDE mirar.
 */

export const MOTIVOS_DE_CAIDA = [
  "precio",
  "envio o ciudad",
  "no contesto",
  "no lo vendemos",
  "el bot no supo",
  "otro",
] as const;

export type ConversationInsightResult = {
  requested: string;
  status: "VIVO" | "MUERTO" | "GANADO";
  stage: string | null;
  lostReason: string | null;
  summary: string;
};

type Turno = { direction: "INBOUND" | "OUTBOUND"; content: string | null; type: string };

/**
 * El texto que se le manda a la IA.
 *
 * Se recorta a los ultimos 30 turnos y cada uno a 300 caracteres: una conversacion de 80 mensajes
 * cuesta mas y no clasifica mejor —lo que define el desenlace esta al final. Los mensajes de
 * sistema se van: son ruido nuestro, no de la venta.
 */
export function buildInsightTranscript(turnos: Turno[]): string {
  return turnos
    .filter((turno) => turno.type !== "SYSTEM" && (turno.content ?? "").trim())
    .slice(-30)
    .map((turno) => {
      const quien = turno.direction === "INBOUND" ? "CLIENTE" : "NOSOTROS";
      return `${quien}: ${(turno.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300)}`;
    })
    .join("\n");
}

const SISTEMA = `Sos un analista de ventas. Lees una conversacion de WhatsApp entre un negocio de mobiliario para salones de belleza y un cliente, y devolves SOLO un JSON con lo que paso.

Al final del texto vas a ver una linea con CUANTOS DIAS pasaron desde el ultimo mensaje y QUIEN hablo ultimo. Usala: una conversacion donde le respondimos y el cliente no volvio a escribir en varios dias esta MUERTA, aunque el texto parezca que quedo esperando.

Campos:
- "requested": que pidio el cliente, en sus palabras, maximo 8 palabras. Si no pidio nada claro, "".
- "status": "GANADO" si dio datos para comprar o confirmo la compra; "VIVO" si la conversacion sigue viva y falta algo; "MUERTO" si se corto sin respuesta del cliente.
- "stage": en cual de estas etapas quedo: ${PRODUCT_FUNNEL_STAGES.map((etapa) => `"${etapa.stage}" (${etapa.label})`).join(", ")}.
- "lostReason": SIEMPRE, tambien si la ves viva: si esta conversacion se cortara aca, cual seria el motivo mas probable. Uno de: ${MOTIVOS_DE_CAIDA.map((motivo) => `"${motivo}"`).join(", ")}. Quien decide si esta muerta es otro; vos solo decis el motivo.
- "summary": una linea de maximo 15 palabras, concreta, para entender el caso sin abrir el chat.

Reglas del motivo (esto es lo mas importante):
- "no contesto" es el ULTIMO recurso. Casi todo lead muerto deja de contestar: eso es COMO se murio,
  no POR QUE. Usalo solo si le respondimos todo, no quedo ninguna pregunta sin responder, y aun asi
  desaparecio sin dar motivo.
- Mira QUE fue lo ultimo que pasó antes del silencio y de ahi sacá el motivo:
  - si el silencio vino despues de hablar de envio, ciudad, cobertura o tiempos de entrega → "envio o ciudad"
  - si vino despues de decir el precio, o pidiendo descuento o financiacion → "precio"
  - si el cliente pregunto algo y no se le respondio, o se le respondio con algo generico o
    equivocado → "el bot no supo"
  - si pidio un producto, medida o color que no manejamos → "no lo vendemos"
- No inventes. Si algo no esta en la conversacion, poné "" o null.`;

/**
 * Si la conversacion esta muerta lo decide una REGLA, no la IA.
 *
 * Los dias que pasaron son un dato, no una interpretacion: pedirle a la IA que los deduzca de un
 * texto sin fechas fue el error de la primera version —clasifico 28 de 30 como "vivas" porque en
 * el texto toda conversacion parece estar esperando respuesta.
 *
 * Muerta = le respondimos y el cliente no volvio a escribir en 5 dias. Si el ultimo que hablo fue
 * el cliente, la pelota es nuestra: eso no esta muerto, esta sin atender.
 */
export function estaMuerta(input: {
  diasDesdeElUltimo: number;
  ultimoHabloElCliente: boolean;
}): boolean {
  return !input.ultimoHabloElCliente && input.diasDesdeElUltimo >= 5;
}

export async function analyzeConversation(input: {
  transcript: string;
  model?: string;
}): Promise<ConversationInsightResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !input.transcript.trim()) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: input.model?.trim() || "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: input.transcript },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenAI respondio ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const crudo = payload.choices?.[0]?.message?.content?.trim();
  if (!crudo) {
    return null;
  }

  const datos = JSON.parse(crudo) as Record<string, unknown>;
  const texto = (valor: unknown, max: number) =>
    typeof valor === "string" ? valor.trim().slice(0, max) : "";

  const status = texto(datos.status, 20).toUpperCase();
  const stage = texto(datos.stage, 30).toUpperCase();
  const lostReason = texto(datos.lostReason, 40).toLowerCase();

  return {
    requested: texto(datos.requested, 80),
    // Cualquier cosa rara cae en VIVO: es el estado que no afirma nada. El llamador puede
    // pisarlo con la regla de los dias, que es mas confiable que leerlo del texto.
    status: status === "GANADO" || status === "MUERTO" ? status : "VIVO",
    stage: PRODUCT_FUNNEL_STAGES.some((etapa) => etapa.stage === stage) ? stage : null,
    // El motivo se conserva SIEMPRE, aunque la IA la haya visto viva: quien decide si esta muerta
    // es la regla de los dias, y si el motivo se descartara aca las muertas quedarian sin motivo,
    // que es justo el dato que se busca.
    lostReason: (MOTIVOS_DE_CAIDA as readonly string[]).includes(lostReason) ? lostReason : null,
    summary: texto(datos.summary, 200),
  };
}

/** Guardar (o actualizar) lo leido de una conversacion. */
export async function saveConversationInsight(input: {
  workspaceId: string;
  conversationId: string;
  productId: string | null;
  messageCount: number;
  lastOutbound: string | null;
  model: string;
  resultado: ConversationInsightResult;
}) {
  const datos = {
    workspaceId: input.workspaceId,
    productId: input.productId,
    requested: input.resultado.requested || null,
    status: input.resultado.status,
    stage: input.resultado.stage,
    lostReason: input.resultado.lostReason,
    lastOutbound: input.lastOutbound?.slice(0, 400) ?? null,
    summary: input.resultado.summary || null,
    messageCount: input.messageCount,
    model: input.model,
    analyzedAt: new Date(),
  };

  await prisma.conversationInsight.upsert({
    where: { conversationId: input.conversationId },
    create: { conversationId: input.conversationId, ...datos },
    update: datos,
  });
}
