export type AdImageSource = "creativos" | "upload" | "external";

export type AdProductImage = {
  url: string;
  alt?: string;
  source: AdImageSource;
  isPrimary?: boolean;
};

export type AdProductInput = {
  productId?: string;
  productName: string;
  productDescription: string;
  brandName?: string;
  categoryName?: string;
  price?: number;
  currency?: string;
  landingPageUrl?: string;
  objective?: "traffic" | "sales" | "leads" | "engagement";
  audienceSummary?: string;
  tone?: "direct" | "persuasive" | "premium" | "friendly";
  keyBenefits: string[];
  painPoints?: string[];
  callToAction?: string;
  image: AdProductImage | null;
};
