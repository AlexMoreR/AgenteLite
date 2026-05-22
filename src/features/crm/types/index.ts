export type CrmStage =
  | "NUEVO"
  | "CALIFICADO"
  | "PROPUESTA"
  | "NEGOCIACION"
  | "GANADO"
  | "PERDIDO";

export type CrmTag = {
  label: string;
  color: string;
};

export type CrmRecord = {
  id: string;
  number: string;
  name: string;
  date: string;
  tags: CrmTag[];
  detail: string;
  status: CrmStage;
};

export type CrmStageMeta = {
  value: CrmStage;
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
