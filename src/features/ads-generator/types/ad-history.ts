import type { AdProductInput } from "./ad-input";
import type { AdsGeneratorResult } from "./ad-output";

export type AdsGeneratorHistoryEntry = {
  id: string;
  createdAt: string;
  input: AdProductInput;
  result: AdsGeneratorResult;
};
