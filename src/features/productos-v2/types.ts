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
  /**
   * Lo que el producto ES, en palabras. No es adorno: el motor la usa para reconocer el producto
   * en un mensaje, asi que una descripcion vacia lo deja dependiendo solo del nombre.
   */
  description: string;
  distinctiveWord: string;
  sells: boolean; // true = tiene precio (vende); false = solo catálogo
  price: number | null;
  anchoredFlowTitle: string | null;
  /** El playbook de ventas: lo unico de esta pantalla que ya se guarda de verdad. */
  /** Como se reconoce este producto en una conversacion. */
  matchKeywords: string[];
  matchAdTitles: string[];
  playbookIdealCustomer: string;
  playbookCustomerPain: string;
  funnelStages: Array<{
    stage: string;
    goal: string;
    script: string;
    /** Los "si no contesta" de esta etapa, en orden. Vacio = esta etapa no hace seguimiento. */
    followUps: Array<{
      id: string;
      timeType: "MINUTES" | "HOURS" | "DAYS";
      timeValue: number;
      content: string;
      cancelOnActivity: boolean;
    }>;
  }>;
  /** El embudo que se muestra vino del agente y todavia no es del producto. */
  funnelFromAgent: boolean;
  /** Hasta donde llegaron los leads en los ultimos 30 dias. */
  leadProgress: {
    murioPrimero: number;
    mandoDos: number;
    converso: number;
    larga: number;
    total: number;
  } | null;
  /** Lo que la IA leyo en las conversaciones de este producto. */
  insights: {
    leidas: number;
    pendientes: number;
    porMotivo: Array<{ motivo: string; cantidad: number }>;
    porUltimaFrase: Array<{ frase: string; cantidad: number }>;
    ejemplos: Array<{ conversationId: string; summary: string; motivo: string | null }>;
  } | null;
  playbookRules: ProductoV2PlaybookRule[];
};

export type ProductoV2Flow = {
  id: string;
  title: string;
};
