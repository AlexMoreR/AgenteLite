import type { AdProductInput } from "../types/ad-input";
import type { AdStrategy } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";

function selectCallToAction(
  objective: ProductAnalysis["recommendedObjective"],
  customCallToAction: string | undefined,
  tone: ProductAnalysis["tone"],
) {
  if (customCallToAction?.trim()) {
    return customCallToAction.trim();
  }

  const ctaByObjective = {
    sales: tone === "premium" ? "Compra hoy" : "Compra ahora",
    leads: tone === "friendly" ? "Escribenos por WhatsApp" : "Solicita informacion",
    traffic: "Descubre mas",
    engagement: "Conoce la propuesta",
  } as const;

  return ctaByObjective[objective];
}

function selectAngle(analysis: ProductAnalysis) {
  if (analysis.primaryPainPoint) {
    return `Enfocar ${analysis.productName} como una solucion concreta para ${analysis.primaryPainPoint.toLowerCase()}.`;
  }

  if (analysis.recommendedObjective === "sales") {
    return `Vender ${analysis.productName} destacando ${analysis.primaryBenefit.toLowerCase()} y una accion clara de compra.`;
  }

  if (analysis.recommendedObjective === "leads") {
    return `Presentar ${analysis.productName} como una opcion confiable para abrir conversacion y captar interesados calificados.`;
  }

  if (analysis.recommendedObjective === "engagement") {
    return `Construir interes alrededor de ${analysis.productName} con un mensaje facil de compartir y recordar.`;
  }

  return `Posicionar ${analysis.productName} con un mensaje simple que invite a conocer mas.`;
}

function buildHooks(analysis: ProductAnalysis, cta: string) {
  const hooks = [
    `${analysis.primaryBenefit} desde el primer impacto.`,
    analysis.primaryPainPoint
      ? `Si tu cliente busca dejar atras ${analysis.primaryPainPoint.toLowerCase()}, aqui hay una respuesta clara.`
      : `${analysis.productName} convierte un beneficio clave en una decision facil.`,
    analysis.priceLabel
      ? `${analysis.primaryBenefit} con una propuesta lista para vender desde ${analysis.priceLabel}.`
      : `${analysis.primaryBenefit} con un cierre natural: ${cta}.`,
  ];

  return hooks;
}

export async function generateAdStrategy(
  input: AdProductInput,
  analysis: ProductAnalysis,
): Promise<AdStrategy> {
  const callToAction = selectCallToAction(
    analysis.recommendedObjective,
    input.callToAction,
    analysis.tone,
  );

  return {
    angle: selectAngle(analysis),
    audience: analysis.audience,
    hooks: buildHooks(analysis, callToAction),
    callToAction,
  };
}
