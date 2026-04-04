import type { AdProductInput } from "../types/ad-input";
import type { AdStrategy } from "../types/ad-output";
import type { AdsGeneratorAiBundle } from "./adsGeneratorAi";
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
    return `Abrir con el problema real del cliente, mostrar por que eso le quita ventas o confianza, y despues presentar el producto como la salida.`;
  }

  if (analysis.recommendedObjective === "sales") {
    return `Ir directo al beneficio que mas vende, bajar el mensaje a algo facil de entender y cerrar con una accion clara.`;
  }

  if (analysis.recommendedObjective === "leads") {
    return `Hablar como si le estuvieras vendiendo a alguien por chat: claro, directo y dejando una razon real para escribir.`;
  }

  if (analysis.recommendedObjective === "engagement") {
    return `Llamar la atencion con una idea facil de entender y una frase que invite a reaccionar o preguntar.`;
  }

  return `Abrir con una frase corta, clara y facil de entender desde la primera lectura.`;
}

function buildHooks(analysis: ProductAnalysis, cta: string) {
  const hooks = [
    `Haz que te miren dos veces.`,
    analysis.primaryPainPoint
      ? `Si eso te esta frenando ventas o confianza, aqui hay una forma mas clara de resolverlo.`
      : `Cuando algo se ve bien y se entiende rapido, vender cuesta menos.`,
    analysis.priceLabel
      ? `${analysis.primaryBenefit} desde ${analysis.priceLabel}.`
      : `${analysis.primaryBenefit}. ${cta}.`,
  ];

  return hooks;
}

export async function generateAdStrategy(
  input: AdProductInput,
  analysis: ProductAnalysis,
  aiBundle?: AdsGeneratorAiBundle | null,
): Promise<AdStrategy> {
  const callToAction =
    aiBundle?.strategy?.callToAction?.trim() ||
    selectCallToAction(analysis.recommendedObjective, input.callToAction, analysis.tone);

  return {
    angle: aiBundle?.strategy?.angle?.trim() || selectAngle(analysis),
    audience: aiBundle?.strategy?.audience?.trim() || analysis.audience,
    hooks: aiBundle?.strategy?.hooks?.length ? aiBundle.strategy.hooks : buildHooks(analysis, callToAction),
    callToAction,
  };
}
