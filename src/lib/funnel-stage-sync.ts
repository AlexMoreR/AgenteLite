import { prisma } from "@/lib/prisma";
import {
  PRODUCT_FUNNEL_STAGES,
  type ProductFunnelStageKey,
} from "@/lib/product-funnel-stages";
import type { CommercialConversationContext, CommercialStage } from "@/lib/commercial-stage";

/**
 * DEJA ESCRITO en que etapa del embudo quedo la conversacion.
 *
 * El motor ya sabia la etapa —classifyCommercialStage corre en cada mensaje— pero la guardaba
 * solo en commercialContext, con un vocabulario de 7 etapas que NO es el que ve el dueño. Las
 * columnas de la conversacion (funnelStage/funnelStageCount, migracion add_funnel_safety_net)
 * quedaron vacias: medido el 12-ago-2026, 1.653 conversaciones en NULL y UNA sola con etapa.
 *
 * Sin esto no existe el seguimiento por etapa: para mandar "el seguimiento de Cierre" hay que
 * poder leer que esta en Cierre. Y el porcentaje del embudo se sigue estimando contando mensajes
 * en vez de mirar el dato.
 *
 * No agrega una llamada a la IA: traduce lo que el motor ya decidio.
 */

// Las 7 etapas del clasificador -> las 5 que se escriben en el Playbook y ve el equipo.
// AVERIGUACION y DIAGNOSTICO son el mismo momento visto de cerca (entender que necesita), por eso
// caen las dos en IDENTIFICACION. POSTVENTA cae en CIERRE porque el embudo del producto no tiene
// un despues: la venta ya se pidio.
const COMMERCIAL_TO_FUNNEL: Record<CommercialStage, ProductFunnelStageKey> = {
  CONEXION: "PRESENTACION",
  AVERIGUACION: "IDENTIFICACION",
  DIAGNOSTICO: "IDENTIFICACION",
  EXPOSICION: "PRODUCTO",
  NEGOCIACION: "OBJECIONES",
  ACUERDO: "CIERRE",
  POSTVENTA: "CIERRE",
};

const FUNNEL_ORDER: ProductFunnelStageKey[] = PRODUCT_FUNNEL_STAGES.map((etapa) => etapa.stage);

export type FunnelStageSyncResult = {
  stage: ProductFunnelStageKey;
  count: number;
  changed: boolean;
};

/**
 * Etapa del embudo que corresponde al estado comercial.
 *
 * Traducir `currentStage` a secas no alcanza, y es la misma leccion que costo aprender en
 * crm-stage-sync: el clasificador amontona casi todo en DIAGNOSTICO, asi que el embudo quedaria
 * con todos los leads en Identificacion y no diria nada. Por eso mandan tambien las banderas de
 * HECHOS, que registran algo que efectivamente paso en el chat:
 *  - shownPrice / shownProductMedia => ya se presento el producto (PRODUCTO)
 *  - objectionDetected              => el cliente puso un pero (OBJECIONES)
 */
export function resolveFunnelStageFromContext(
  context: Pick<
    CommercialConversationContext,
    "currentStage" | "shownPrice" | "shownProductMedia" | "objectionDetected"
  >,
): ProductFunnelStageKey | null {
  let target = COMMERCIAL_TO_FUNNEL[context.currentStage] ?? null;
  if (!target) {
    return null;
  }

  if (context.shownPrice || context.shownProductMedia) {
    if (FUNNEL_ORDER.indexOf("PRODUCTO") > FUNNEL_ORDER.indexOf(target)) {
      target = "PRODUCTO";
    }
  }

  // Sin candado hacia atras a proposito: el candado de abajo decide si aplica. Una objecion
  // despues del cierre no devuelve el lead a Objeciones.
  if (context.objectionDetected) {
    target = "OBJECIONES";
  }

  return target;
}

/**
 * Anota la etapa en la conversacion. Dos candados, los mismos que el puente del CRM:
 *
 * 1. NUNCA retrocede sola. El cliente puede volver a preguntar algo basico ya estando en el
 *    cierre; eso no devuelve la venta al principio. Corregir hacia atras es decision de una
 *    persona, no del motor.
 * 2. El contador de mensajes en la etapa se reinicia SOLO al cambiar de etapa. Es lo que despues
 *    lee la red de seguridad (ProductFunnelStage.stuckAfterMessages) para avisar que un lead se
 *    quedo trabado.
 *
 * Devuelve la etapa vigente, o null si no habia nada que anotar.
 */
export async function syncFunnelStageFromCommercialStage(input: {
  conversationId: string;
  commercialContext: Pick<
    CommercialConversationContext,
    "currentStage" | "shownPrice" | "shownProductMedia" | "objectionDetected"
  >;
}): Promise<FunnelStageSyncResult | null> {
  const target = resolveFunnelStageFromContext(input.commercialContext);
  if (!target || !input.conversationId) {
    return null;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { funnelStage: true, funnelStageCount: true },
  });

  if (!conversation) {
    return null;
  }

  const current = conversation.funnelStage as ProductFunnelStageKey | null;
  const currentIndex = current ? FUNNEL_ORDER.indexOf(current) : -1;
  const targetIndex = FUNNEL_ORDER.indexOf(target);

  // Etapa guardada que ya no existe en el embudo (se renombro una etapa): se corrige escribiendo
  // la nueva en vez de quedar trabada para siempre en un valor que nadie reconoce.
  const guardadaEsInvalida = current !== null && currentIndex < 0;

  // Candado 1: solo hacia adelante. Quedarse en la misma etapa NO es retroceder: ahi lo unico
  // que pasa es que sube el contador.
  if (!guardadaEsInvalida && currentIndex >= 0 && targetIndex < currentIndex) {
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { funnelStageCount: { increment: 1 } },
    });
    return { stage: current as ProductFunnelStageKey, count: conversation.funnelStageCount + 1, changed: false };
  }

  const cambio = guardadaEsInvalida || current !== target;
  const count = cambio ? 1 : conversation.funnelStageCount + 1;

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      funnelStage: target,
      funnelStageCount: count,
      // El aviso de "trabado" es por etapa: al cambiar de etapa se vuelve a habilitar.
      ...(cambio ? { funnelNotifiedAt: null } : {}),
    },
  });

  return { stage: target, count, changed: cambio };
}
