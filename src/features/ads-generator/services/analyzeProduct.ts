import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorAiBundle } from "./adsGeneratorAi";

export type ProductAnalysis = {
  productName: string;
  categoryName: string;
  mainOffer: string;
  benefits: string[];
  primaryBenefit: string;
  supportingBenefits: string[];
  primaryPainPoint: string | null;
  recommendedObjective: "traffic" | "sales" | "leads" | "engagement";
  priceLabel: string | null;
  brandLabel: string | null;
  tone: NonNullable<AdProductInput["tone"]>;
  audience: string;
  confidenceSignals: string[];
  imageAvailable: boolean;
  strategicSummary?: string;
  recommendedFormat?: string;
  campaignStructure?: string;
  basicSegmentation?: string[];
  creativeIdea?: string;
  budgetRecommendation?: string;
  primaryMetric?: string;
  publicationChecklist?: string[];
};

const objectivePriority = {
  sales: 4,
  leads: 3,
  traffic: 2,
  engagement: 1,
} as const;

function normalizeText(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function extractMainOffer(description: string, productName: string) {
  const firstSentence = description
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find(Boolean);

  if (firstSentence) {
    return sentenceCase(firstSentence);
  }

  return `${productName} pensado para resolver una necesidad concreta.`;
}

function inferObjective(input: AdProductInput, description: string, painPoints: string[]) {
  if (input.objective) {
    return input.objective;
  }

  const landing = normalizeText(input.landingPageUrl);
  const combinedText = [description, ...painPoints, input.callToAction ?? ""].join(" ").toLowerCase();

  if (
    /(agenda|cotiza|asesoria|whatsapp|diagnostico|demo|consulta|formulario|contacto)/.test(combinedText) ||
    /(contact|quote|demo|lead|whatsapp)/.test(landing)
  ) {
    return "leads";
  }

  if (
    /(comprar|compra|pedido|envio|carrito|paga|checkout|oferta|descuento)/.test(combinedText) ||
    typeof input.price === "number"
  ) {
    return "sales";
  }

  if (/(comparte|descubre|viral|comunidad|interactua|comentarios)/.test(combinedText)) {
    return "engagement";
  }

  return "traffic";
}

function scoreBenefit(benefit: string, objective: ProductAnalysis["recommendedObjective"]) {
  const normalized = normalizeText(benefit);
  let score = benefit.trim().length > 0 ? 1 : 0;

  if (/(ahorra|rapido|facil|practico|simple|menos tiempo|en minutos)/.test(normalized)) {
    score += 5;
  }
  if (/(vende|conversion|resultado|crece|mas clientes|mas ventas|retorno)/.test(normalized)) {
    score += 5;
  }
  if (/(premium|exclusivo|lujo|elegante|alta gama)/.test(normalized)) {
    score += 3;
  }
  if (/(duradero|resistente|calidad|seguro|confiable|garantia)/.test(normalized)) {
    score += 4;
  }
  if (/(hidrata|protege|cuida|reduce|mejora|alivia|comodidad|bienestar)/.test(normalized)) {
    score += 4;
  }

  score += objectivePriority[objective];
  return score;
}

function dedupe(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeText(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatPrice(price: number | undefined, currency: string | undefined) {
  if (typeof price !== "number" || Number.isNaN(price)) {
    return null;
  }

  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: price % 1 === 0 ? 0 : 2,
    }).format(price);
  } catch {
    return `${currency || "COP"} ${price}`;
  }
}

export async function analyzeProduct(
  input: AdProductInput,
  aiBundle?: AdsGeneratorAiBundle | null,
): Promise<ProductAnalysis> {
  const benefits = dedupe(input.keyBenefits.map((item) => sentenceCase(item)));
  const painPoints = dedupe((input.painPoints ?? []).map((item) => sentenceCase(item)));
  const description = input.productDescription.trim();
  const aiBenefits = dedupe((aiBundle?.analysis?.benefits ?? []).map((item) => sentenceCase(item)));
  const resolvedBenefits = aiBenefits.length > 0 ? aiBenefits : benefits;
  const recommendedObjective =
    aiBundle?.analysis?.recommendedObjective ?? inferObjective(input, description, painPoints);
  const sortedBenefits = [...resolvedBenefits].sort(
    (left, right) =>
      scoreBenefit(right, recommendedObjective) - scoreBenefit(left, recommendedObjective),
  );
  const primaryBenefit =
    aiBundle?.analysis?.primaryBenefit ??
    sortedBenefits[0] ??
    sentenceCase(
      description.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? "Beneficio principal por definir",
    );
  const supportingBenefits = aiBundle?.analysis?.supportingBenefits?.length
    ? dedupe(aiBundle.analysis.supportingBenefits.map((item) => sentenceCase(item))).slice(0, 3)
    : sortedBenefits.slice(1, 3);
  const primaryPainPoint = aiBundle?.analysis?.primaryPainPoint ?? painPoints[0] ?? null;
  const confidenceSignals = dedupe([
    typeof input.price === "number" ? `Precio visible ${formatPrice(input.price, input.currency)}` : "",
    input.brandName ? `Marca ${input.brandName}` : "",
    input.image?.url ? "Tiene recurso visual para el anuncio" : "",
    ...(aiBundle?.analysis?.confidenceSignals ?? []),
    /(garantia|resenas|testado|original|envio)/i.test(description)
      ? "Incluye senales de confianza en la descripcion"
      : "",
  ]);

  return {
    productName: input.productName,
    categoryName: aiBundle?.analysis?.categoryName ?? input.categoryName ?? "General",
    mainOffer: aiBundle?.analysis?.mainOffer ?? extractMainOffer(description, input.productName),
    benefits: resolvedBenefits,
    primaryBenefit,
    supportingBenefits,
    primaryPainPoint,
    recommendedObjective,
    priceLabel: formatPrice(input.price, input.currency),
    brandLabel: input.brandName?.trim() || null,
    tone: aiBundle?.analysis?.tone ?? input.tone ?? "persuasive",
    audience:
      aiBundle?.analysis?.audience ||
      input.audienceSummary?.trim() ||
      "Personas interesadas en una solucion concreta, facil de entender y de accionar.",
    confidenceSignals,
    imageAvailable: Boolean(input.image?.url),
    strategicSummary: aiBundle?.analysis?.strategicSummary,
    recommendedFormat: aiBundle?.analysis?.recommendedFormat,
    campaignStructure: aiBundle?.analysis?.campaignStructure,
    basicSegmentation: aiBundle?.analysis?.basicSegmentation,
    creativeIdea: aiBundle?.analysis?.creativeIdea,
    budgetRecommendation: aiBundle?.analysis?.budgetRecommendation,
    primaryMetric: aiBundle?.analysis?.primaryMetric,
    publicationChecklist: aiBundle?.analysis?.publicationChecklist,
  };
}
