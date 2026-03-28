export type AdStrategy = {
  angle: string;
  audience: string;
  hooks: string[];
  callToAction: string;
};

export type AdCopyVariant = {
  id: string;
  primaryText: string;
  headline: string;
  description: string;
};

export type MetaAdOutput = {
  campaignObjective: string;
  strategicSummary: string;
  recommendedSalesAngle: string;
  campaignStructure: string;
  basicSegmentation: string[];
  recommendedFormat: string;
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
  creativeIdea: string;
  budgetRecommendation: string;
  primaryMetric: string;
  creativeNotes: string[];
  publicationChecklist: string[];
  copyVariants: AdCopyVariant[];
  readyToCopyText: string;
};

export type AdsGeneratorResult = {
  summary: string;
  strategy: AdStrategy;
  meta: MetaAdOutput;
};
