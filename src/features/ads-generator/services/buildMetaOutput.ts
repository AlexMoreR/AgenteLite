import type { AdsGeneratorResult, MetaAdOutput } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";
import type { AdStrategy } from "../types/ad-output";
import type { AdCopyVariant } from "../types/ad-output";

export async function buildMetaOutput(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
  copies: AdCopyVariant[],
): Promise<AdsGeneratorResult> {
  const meta: MetaAdOutput = {
    campaignObjective: "Traffic",
    recommendedFormat: analysis.imageAvailable ? "Single image ad" : "Pending creative asset",
    creativeNotes: [
      "Usar una imagen principal consistente con el producto.",
      "Mantener el mensaje alineado con el angulo principal del anuncio.",
      "Revisar tono y CTA antes de publicar en Meta Ads Manager.",
    ],
    copyVariants: copies,
    readyToCopyText: copies
      .map(
        (copy, index) =>
          `Variante ${index + 1}\nTexto: ${copy.primaryText}\nTitular: ${copy.headline}\nDescripcion: ${copy.description}`,
      )
      .join("\n\n"),
  };

  return {
    summary: `Base mock generada para ${analysis.productName}.`,
    strategy,
    meta,
  };
}
