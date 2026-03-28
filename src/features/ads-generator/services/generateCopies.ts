import type { AdCopyVariant } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";
import type { AdStrategy } from "../types/ad-output";

function withBrand(productName: string, brandLabel: string | null) {
  return brandLabel ? `${productName} de ${brandLabel}` : productName;
}

function buildHeadline(base: string, fallback: string) {
  return base.length <= 40 ? base : fallback;
}

export async function generateCopies(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
): Promise<AdCopyVariant[]> {
  const productLabel = withBrand(analysis.productName, analysis.brandLabel);
  const supportBenefit = analysis.supportingBenefits[0] ?? analysis.primaryBenefit;
  const secondSupportBenefit = analysis.supportingBenefits[1] ?? supportBenefit;
  const proofLine =
    analysis.confidenceSignals[0] ??
    (analysis.imageAvailable ? "Creativo disponible para reforzar el mensaje." : "Mensaje listo para validar.");

  return [
    {
      id: "benefit-led",
      primaryText: `${productLabel} destaca por ${analysis.primaryBenefit.toLowerCase()}. ${analysis.mainOffer} ${strategy.callToAction}.`,
      headline: buildHeadline(
        `${analysis.primaryBenefit} con ${analysis.productName}`,
        `${analysis.productName} que si convierte`,
      ),
      description: supportBenefit,
    },
    {
      id: "pain-solution",
      primaryText: analysis.primaryPainPoint
        ? `Si tu cliente ya no quiere seguir con ${analysis.primaryPainPoint.toLowerCase()}, ${analysis.productName} ofrece ${analysis.primaryBenefit.toLowerCase()} y ${supportBenefit.toLowerCase()}. ${strategy.callToAction}.`
        : `${analysis.productName} ayuda a tomar accion con ${analysis.primaryBenefit.toLowerCase()} y un mensaje facil de entender. ${strategy.callToAction}.`,
      headline: buildHeadline(
        `Deja atras ${analysis.primaryPainPoint?.toLowerCase() ?? "la friccion diaria"}`,
        `${analysis.productName} como solucion clara`,
      ),
      description: secondSupportBenefit,
    },
    {
      id: "offer-proof",
      primaryText: analysis.priceLabel
        ? `${analysis.productName} combina ${analysis.primaryBenefit.toLowerCase()} con una oferta clara ${analysis.priceLabel}. ${proofLine} ${strategy.callToAction}.`
        : `${analysis.productName} transmite ${analysis.primaryBenefit.toLowerCase()} desde el primer vistazo. ${proofLine} ${strategy.callToAction}.`,
      headline: buildHeadline(
        `${analysis.productName} con propuesta lista`,
        `${analysis.productName} listo para anunciar`,
      ),
      description: proofLine,
    },
  ];
}
