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
  PROPUESTA: {
    value: "PROPUESTA",
    label: "Tibio",
    accentClassName: "text-amber-700",
    borderClassName: "border-amber-200",
    backgroundClassName: "bg-amber-50",
  },
  NEGOCIACION: {
    value: "NEGOCIACION",
    label: "Caliente",
    accentClassName: "text-rose-700",
    borderClassName: "border-rose-200",
    backgroundClassName: "bg-rose-50",
  },
  GANADO: {
    value: "GANADO",
    label: "Ganado",
    accentClassName: "text-emerald-800",
    borderClassName: "border-emerald-300",
    backgroundClassName: "bg-emerald-50",
  },
  PERDIDO: {
    value: "PERDIDO",
    label: "Descartado",
    accentClassName: "text-violet-700",
    borderClassName: "border-violet-200",
    backgroundClassName: "bg-violet-50",
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

export function sortCrmRecords(records: CrmRecord[]) {
  return [...records].sort((left, right) => {
    const stageDiff = CRM_STAGE_ORDER.indexOf(left.status) - CRM_STAGE_ORDER.indexOf(right.status);

    if (stageDiff !== 0) {
      return stageDiff;
    }

    return new Date(right.date).getTime() - new Date(left.date).getTime();
  });
}
