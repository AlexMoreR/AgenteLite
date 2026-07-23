export type ProductoV2Item = {
  id: string;
  name: string;
  distinctiveWord: string;
  sells: boolean; // true = tiene precio (vende); false = solo catálogo
  price: number | null;
  anchoredFlowTitle: string | null;
};

export type ProductoV2Flow = {
  id: string;
  title: string;
};
