import type { AdProductInput } from "../types/ad-input";

export type ProductAnalysis = {
  productName: string;
  categoryName: string;
  mainOffer: string;
  benefits: string[];
  imageAvailable: boolean;
};

export async function analyzeProduct(input: AdProductInput): Promise<ProductAnalysis> {
  return {
    productName: input.productName,
    categoryName: input.categoryName ?? "General",
    mainOffer: input.productDescription,
    benefits: input.keyBenefits,
    imageAvailable: Boolean(input.image?.url),
  };
}
