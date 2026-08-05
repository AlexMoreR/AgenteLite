export type ProductoV2PlaybookRule = {
  id: string;
  kind: "DECIR" | "NO_DECIR" | "OBJECION" | "BENEFICIO";
  trigger: string | null;
  text: string;
  source: string;
};

export type ProductoV2Item = {
  id: string;
  name: string;
  distinctiveWord: string;
  sells: boolean; // true = tiene precio (vende); false = solo catálogo
  price: number | null;
  anchoredFlowTitle: string | null;
  /** El playbook de ventas: lo unico de esta pantalla que ya se guarda de verdad. */
  playbookIdealCustomer: string;
  playbookCustomerPain: string;
  funnelStages: Array<{ stage: string; goal: string; script: string; stuckAfterMessages: number | null }>;
  /** El embudo que se muestra vino del agente y todavia no es del producto. */
  funnelFromAgent: boolean;
  /** Cuantos leads vivos estan parados en cada etapa. */
  funnelCounts: Record<string, number>;
  playbookRules: ProductoV2PlaybookRule[];
};

export type ProductoV2Flow = {
  id: string;
  title: string;
};
