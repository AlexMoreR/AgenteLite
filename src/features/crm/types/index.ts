export type CrmStage =
  | "NUEVO"
  | "CALIFICADO"
  | "PROPUESTA"
  | "NEGOCIACION"
  | "GANADO"
  | "PERDIDO";

export type CrmOrigin = "FACEBOOK" | "MARKETPLACE" | "RECOMENDADO" | "GENERICO";

export type CrmTag = {
  label: string;
  color: string;
};

export type CrmRecord = {
  id: string;
  number: string;
  name: string;
  avatarUrl: string | null;
  date: string;
  origin: CrmOrigin;
  tags: CrmTag[];
  detail: string;
  status: CrmStage;
  // Motivo de perdida (solo tiene valor cuando status === "PERDIDO"). Alimenta el top de razones
  // del informe del dueno.
  lostReason: string | null;
  isCollapsed: boolean;
};

export type CrmStageMeta = {
  value: CrmStage;
  label: string;
  accentClassName: string;
  borderClassName: string;
  backgroundClassName: string;
};

export type CrmOriginMeta = {
  value: CrmOrigin;
  label: string;
  accentClassName: string;
  borderClassName: string;
  backgroundClassName: string;
};

export type CrmStats = {
  total: number;
  active: number;
  won: number;
  lost: number;
};

export type CrmColumn = {
  stage: CrmStage;
  title: string;
  records: CrmRecord[];
};

export type CrmData = {
  workspaceName: string;
  records: CrmRecord[];
  columns: CrmColumn[];
  stats: CrmStats;
  generatedAt: string;
};
