import { PRODUCT_FUNNEL_STAGES, type ProductFunnelStageKey } from "@/lib/product-funnel-stages";

/**
 * La red de seguridad del embudo.
 *
 * Un embudo escrito solo con texto le pide a la IA que acierte todos los dias. No acierta: se
 * queda dando vueltas en una etapa, repite la misma pregunta y el cliente se va sin que nadie se
 * entere. Esto es el limite que se cumple pase lo que pase — cuenta cuantos mensajes lleva el
 * cliente en la misma etapa y, pasado el numero que puso el dueño, entra una persona.
 *
 * La IA sigue poniendo las palabras (que es lo que hace bien); el embudo pone los rieles.
 */

/** El motor trabaja con siete etapas y el embudo del producto con cinco. */
const ETAPA_DEL_MOTOR: Record<string, ProductFunnelStageKey> = {
  CONEXION: "PRESENTACION",
  AVERIGUACION: "IDENTIFICACION",
  DIAGNOSTICO: "IDENTIFICACION",
  EXPOSICION: "PRODUCTO",
  NEGOCIACION: "OBJECIONES",
  ACUERDO: "CIERRE",
};

export function toFunnelStage(commercialStage: string | null | undefined): ProductFunnelStageKey | null {
  if (!commercialStage) {
    return null;
  }
  return ETAPA_DEL_MOTOR[commercialStage] ?? null;
}

export function funnelStageLabel(stage: string | null | undefined): string {
  return PRODUCT_FUNNEL_STAGES.find((etapa) => etapa.stage === stage)?.label ?? "el embudo";
}

export type FunnelSafetyNetInput = {
  /** La etapa del embudo en la que esta la conversacion ahora. */
  stageActual: ProductFunnelStageKey | null;
  /** Lo que venia guardado en la conversacion. */
  guardado: { stage: string | null; count: number; notifiedAt: Date | null };
  /** Cuantos mensajes tolera esa etapa antes de avisar. Null = sin red. */
  stuckAfterMessages: number | null;
};

export type FunnelSafetyNetResult = {
  /** Lo que hay que guardar en la conversacion. */
  next: { stage: string | null; count: number; notifiedAt: Date | null };
  /** Si hay que avisarle a un asesor AHORA. */
  debeNotificar: boolean;
};

/**
 * Decide si el lead esta trabado.
 *
 * Al cambiar de etapa el contador vuelve a cero y se limpia el aviso: avanzar es justamente la
 * señal de que la conversacion esta sana, y si no se limpiara, una venta larga que pasa dos veces
 * por la misma etapa no volveria a avisar nunca.
 */
export function evaluateFunnelSafetyNet(input: FunnelSafetyNetInput): FunnelSafetyNetResult {
  const { stageActual, guardado, stuckAfterMessages } = input;

  if (!stageActual) {
    return { next: guardado, debeNotificar: false };
  }

  const siguePisandoLaMisma = guardado.stage === stageActual;
  const count = siguePisandoLaMisma ? guardado.count + 1 : 1;
  const notifiedAt = siguePisandoLaMisma ? guardado.notifiedAt : null;

  const debeNotificar =
    typeof stuckAfterMessages === "number" &&
    stuckAfterMessages > 0 &&
    count >= stuckAfterMessages &&
    // Una sola vez por etapa: si no, cada mensaje siguiente dispararia otro aviso y el asesor
    // terminaria silenciando las notificaciones, que es peor que no tenerlas.
    !notifiedAt;

  return {
    next: {
      stage: stageActual,
      count,
      notifiedAt: debeNotificar ? new Date() : notifiedAt,
    },
    debeNotificar,
  };
}
