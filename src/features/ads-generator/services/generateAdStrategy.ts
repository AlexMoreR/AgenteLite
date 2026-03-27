import type { AdProductInput } from "../types/ad-input";
import type { AdStrategy } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";

export async function generateAdStrategy(
  input: AdProductInput,
  analysis: ProductAnalysis,
): Promise<AdStrategy> {
  return {
    angle: `Promocionar ${analysis.productName} con enfoque en beneficios claros.`,
    audience: input.audienceSummary ?? "Audiencia interesada en resolver una necesidad concreta.",
    hooks: [
      "Descubre una forma mas simple de obtener resultados.",
      "Convierte el interes en accion con una propuesta clara.",
      "Destaca valor, utilidad y diferenciacion desde el primer vistazo.",
    ],
    callToAction: input.callToAction ?? "Compra ahora",
  };
}
