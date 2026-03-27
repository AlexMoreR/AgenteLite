import type { AdCopyVariant } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";
import type { AdStrategy } from "../types/ad-output";

export async function generateCopies(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
): Promise<AdCopyVariant[]> {
  return [
    {
      id: "variant-1",
      primaryText: `${analysis.productName}: ${strategy.hooks[0]}`,
      headline: `${analysis.productName} para tu proximo paso`,
      description: "Version mock para validar el flujo del modulo.",
    },
    {
      id: "variant-2",
      primaryText: `${analysis.productName}: ${strategy.hooks[1]}`,
      headline: `Impulsa resultados con ${analysis.productName}`,
      description: "Texto base editable antes de conectar IA real.",
    },
    {
      id: "variant-3",
      primaryText: `${analysis.productName}: ${strategy.hooks[2]}`,
      headline: `Haz visible el valor de ${analysis.productName}`,
      description: "Salida provisional pensada para pruebas internas.",
    },
  ];
}
