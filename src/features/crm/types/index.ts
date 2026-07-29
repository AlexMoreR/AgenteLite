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
  // Fecha que se MUESTRA en la ficha: ultima actividad (o la venta, si ya se gano).
  date: string;
  // Fecha en que el lead ENTRO. Es distinta de `date` y hace falta para no contar dos veces:
  // el informe filtraba por actividad, asi que un lead viejo al que alguien le tocaba la ficha
  // volvia a contar como si hubiera entrado ese dia (medido: hasta +48% en un dia).
  enteredAt: string;
  origin: CrmOrigin;
  tags: CrmTag[];
  detail: string;
  status: CrmStage;
  // Motivo de perdida (solo tiene valor cuando status === "PERDIDO"). Alimenta el top de razones
  // del informe del dueno.
  lostReason: string | null;
  // Conversacion mas reciente del contacto, para abrir su chat desde el CRM. Null si nunca
  // hablo por WhatsApp (contacto cargado a mano, sin conversacion).
  conversationId: string | null;
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
