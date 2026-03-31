import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { analyzeProduct } from "./analyzeProduct";
import { buildMetaOutput } from "./buildMetaOutput";
import { createAdCopies } from "./createAdCopies";
import { generateAdStrategy } from "./generateAdStrategy";

export async function runAdsGenerator(input: AdProductInput): Promise<AdsGeneratorResult> {
  const analysis = await analyzeProduct(input);
  const strategy = await generateAdStrategy(input, analysis);
  const copies = await createAdCopies(analysis, strategy);

  return buildMetaOutput(analysis, strategy, copies);
}
