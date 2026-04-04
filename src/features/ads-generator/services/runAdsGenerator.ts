import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { generateAdsGeneratorAiBundle } from "./adsGeneratorAi";
import { analyzeProduct } from "./analyzeProduct";
import { buildMetaOutput } from "./buildMetaOutput";
import { createAdCopies } from "./createAdCopies";
import { generateAdStrategy } from "./generateAdStrategy";

export async function runAdsGenerator(input: AdProductInput): Promise<AdsGeneratorResult> {
  const aiBundle = await generateAdsGeneratorAiBundle(input);
  const analysis = await analyzeProduct(input, aiBundle);
  const strategy = await generateAdStrategy(input, analysis, aiBundle);
  const copies = await createAdCopies(analysis, strategy, aiBundle);

  return buildMetaOutput(analysis, strategy, copies, aiBundle);
}
