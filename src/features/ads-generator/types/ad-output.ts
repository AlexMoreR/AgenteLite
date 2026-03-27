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
  recommendedFormat: string;
  creativeNotes: string[];
  copyVariants: AdCopyVariant[];
  readyToCopyText: string;
};

export type AdsGeneratorResult = {
  summary: string;
  strategy: AdStrategy;
  meta: MetaAdOutput;
};
