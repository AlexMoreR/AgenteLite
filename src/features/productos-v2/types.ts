export type ProductoV2PlaybookRule = {
  id: string;
  kind: "DECIR" | "NO_DECIR" | "OBJECION";
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
  playbookPitch: string;
  playbookRules: ProductoV2PlaybookRule[];
};

export type ProductoV2Flow = {
  id: string;
  title: string;
};
