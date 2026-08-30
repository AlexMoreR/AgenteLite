import type { CrmOrigin, CrmOriginMeta, CrmRecord, CrmStage, CrmStageMeta } from "../types";

export const CRM_STAGE_ORDER: CrmStage[] = [
  "NUEVO",
  "CALIFICADO",
  "PROPUESTA",
  "NEGOCIACION",
  "GANADO",
  "PERDIDO",
];

export const CRM_STAGE_META: Record<CrmStage, CrmStageMeta> = {
  NUEVO: {
    value: "NUEVO",
    label: "Nuevo",
    accentClassName: "text-violet-700",
    borderClassName: "border-violet-200",
    backgroundClassName: "bg-violet-50",
  },
  CALIFICADO: {
    value: "CALIFICADO",
    label: "Frio",
    accentClassName: "text-cyan-700",
    borderClassName: "border-cyan-200",
    backgroundClassName: "bg-cyan-50",
  },
  /*
    Frio celeste, Tibio amarillo, Caliente naranja: la temperatura se lee de un vistazo.

    Antes Tibio era ambar -que tira a marron- y Caliente rosa, asi que la escala no contaba nada
    y habia que leer la palabra. El color esta para no tener que leerla.
  */
  PROPUESTA: {
    value: "PROPUESTA",
    label: "Tibio",
    accentClassName: "text-yellow-800",
    borderClassName: "border-yellow-300",
    backgroundClassName: "bg-yellow-50",
  },
  NEGOCIACION: {
    value: "NEGOCIACION",
    label: "Caliente",
    accentClassName: "text-orange-700",
    borderClassName: "border-orange-300",
    backgroundClassName: "bg-orange-50",
  },
  GANADO: {
    value: "GANADO",
    label: "Ganado",
    accentClassName: "text-emerald-800",
    borderClassName: "border-emerald-300",
    backgroundClassName: "bg-emerald-50",
  },
  /**
   * Descartado va en ROJO, no en violeta.
   *
   * Compartia color con "Nuevo" y en una lista de leads eran la misma chapita lila: la etapa que
   * dice "esto se perdio" y la que dice "esto recien llega" tienen que distinguirse de un
   * vistazo. Se usa `red` y no `rose` para que tampoco se confunda con "Caliente", que es el
   * rosado de al lado, y el fondo va un tono mas fuerte para que se lea como un alto.
   */
  PERDIDO: {
    value: "PERDIDO",
    label: "Descartado",
    accentClassName: "text-red-700",
    borderClassName: "border-red-300",
    backgroundClassName: "bg-red-100",
  },
};

export const CRM_ORIGIN_META: Record<CrmOrigin, CrmOriginMeta> = {
  FACEBOOK: {
    value: "FACEBOOK",
    label: "Facebook Ads",
    accentClassName: "text-blue-700",
    borderClassName: "border-blue-200",
    backgroundClassName: "bg-blue-50",
  },
  MARKETPLACE: {
    value: "MARKETPLACE",
    label: "Marketplace",
    accentClassName: "text-emerald-700",
    borderClassName: "border-emerald-200",
    backgroundClassName: "bg-emerald-50",
  },
  RECOMENDADO: {
    value: "RECOMENDADO",
    label: "Recomendado",
    accentClassName: "text-amber-700",
    borderClassName: "border-amber-200",
    backgroundClassName: "bg-amber-50",
  },
  GENERICO: {
    value: "GENERICO",
    label: "Generico",
    accentClassName: "text-slate-700",
    borderClassName: "border-slate-200",
    backgroundClassName: "bg-slate-50",
  },
};

export function getCrmStageLabel(stage: CrmStage) {
  return CRM_STAGE_META[stage].label;
}

export function getCrmStageMeta(stage: CrmStage) {
  return CRM_STAGE_META[stage];
}

export function getCrmOriginLabel(origin: CrmOrigin) {
  return CRM_ORIGIN_META[origin].label;
}

export function getCrmOriginMeta(origin: CrmOrigin) {
  return CRM_ORIGIN_META[origin];
}

export function groupCrmRecordsByStage(records: CrmRecord[]) {
  return CRM_STAGE_ORDER.map((stage) => ({
    stage,
    title: CRM_STAGE_META[stage].label,
    records: records.filter((record) => record.status === stage),
  }));
}

/**
 * Razones por las que se pierde un lead. Se guardan como texto en Contact.lostReason (ver el
 * comentario del campo en schema.prisma): son razones de NEGOCIO y cambian con el tiempo, asi que
 * agregar una debe ser editar esta lista y nada mas, sin migrar la base de produccion.
 *
 * El orden es el que ve la vendedora al cerrar: primero las mas frecuentes, "Otro" al final.
 */
export const CRM_LOST_REASONS = [
  { value: "compro_competencia", label: "Compró a competencia" },
  { value: "sin_presupuesto", label: "Sin presupuesto" },
  { value: "solo_curioseando", label: "Solo curioseando" },
  { value: "precio_alto", label: "Precio muy alto" },
  { value: "sin_respuesta", label: "Sin respuesta" },
  { value: "otro", label: "Otro" },
] as const;

export type CrmLostReason = (typeof CRM_LOST_REASONS)[number]["value"];

// Etiquetas de motivos VIEJOS (lista previa al Playbook v1.0). Ya NO son seleccionables; solo
// sirven para MOSTRAR con nombre legible los contactos PERDIDO que ya se guardaron con esos
// valores, para que el informe de razones no muestre "decide_otro" crudo.
const LEGACY_LOST_REASON_LABELS: Record<string, string> = {
  precio: "Precio",
  no_responde: "No responde",
  comparando: "Está comparando",
  sin_dinero: "Sin dinero hoy",
  decide_otro: "Decide otra persona",
  desconfianza: "Desconfianza",
};

export function getCrmLostReasonLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return (
    CRM_LOST_REASONS.find((reason) => reason.value === value)?.label ??
    LEGACY_LOST_REASON_LABELS[value] ??
    value
  );
}

/**
 * Resultado de un intento de llamada (módulo de Llamadas). Lista FIJA — no enum ni texto libre —
 * para poder MEDIR. Se guarda como texto en CallAttempt.result (mismo patrón que lostReason: los
 * valores son de negocio y agregar uno debe ser editar esta lista, sin migrar la BD). El orden es
 * el que ve la vendedora al registrar.
 */
export const CALL_RESULTS = [
  { value: "interesada", label: "Contactado - interesada" },
  { value: "lo_piensa", label: "Contactado - lo piensa" },
  { value: "no_interesada", label: "Contactado - no interesada" },
  { value: "sin_definir", label: "Contactado - sin respuesta (dijo algo pero no definió)" },
  { value: "no_contesto", label: "No contestó - reintentar" },
  { value: "ganado", label: "Cerrado - Ganado" },
  { value: "perdido", label: "Cerrado - Perdido" },
] as const;

export type CallResult = (typeof CALL_RESULTS)[number]["value"];

/**
 * Resultado provisional de una llamada que el sistema anotó solo y todavía nadie clasificó.
 *
 * Lo pone el buzón de WaCalls cuando la llamada SÍ se habló: que hayan hablado es un hecho, pero
 * cómo quedó el cliente —interesada, lo piensa, perdido— mueve la etapa del lead, y eso lo decide
 * la asesora. Queda a la espera de que ella elija el resultado de verdad.
 *
 * A propósito NO está en CALL_RESULTS: nadie tiene que poder elegir "sin registrar" a mano, es un
 * estado de paso, no un desenlace. Por lo mismo no tiene efecto sobre la etapa.
 */
export const CALL_RESULT_PENDING = "por_registrar";

export function isPendingCallResult(value: string | null | undefined) {
  return value === CALL_RESULT_PENDING;
}

export function getCallResultLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  if (value === CALL_RESULT_PENDING) {
    return "Sin registrar";
  }
  return CALL_RESULTS.find((result) => result.value === value)?.label ?? value;
}

// El resultado "Cerrado - Perdido" EXIGE motivo (no se puede guardar sin él).
export const CALL_RESULT_LOST: CallResult = "perdido";

/**
 * Efecto de un resultado sobre la etapa del CRM (reglas del Playbook v1.0 — no inventar otras):
 *  - "lo piensa"         → Tibio (PROPUESTA) inmediato.
 *  - "Cerrado - Ganado"  → GANADO.
 *  - "Cerrado - Perdido" → PERDIDO (requiere motivo).
 * Los demás resultados NO cambian la etapa. En especial "No contestó" NO baja la temperatura.
 * La baja a Tibio por "3 intentos + 5 días + cero respuesta" NO está acá: es una evaluación
 * temporal (se agenda/evalúa aparte), no un efecto directo del resultado registrado.
 */
export const CALL_RESULT_STAGE_EFFECT: Partial<Record<CallResult, CrmStage>> = {
  lo_piensa: "PROPUESTA",
  ganado: "GANADO",
  perdido: "PERDIDO",
};

export function sortCrmRecords(records: CrmRecord[]) {
  return [...records].sort((left, right) => {
    const stageDiff = CRM_STAGE_ORDER.indexOf(left.status) - CRM_STAGE_ORDER.indexOf(right.status);

    if (stageDiff !== 0) {
      return stageDiff;
    }

    return new Date(right.date).getTime() - new Date(left.date).getTime();
  });
}
