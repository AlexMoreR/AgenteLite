import type { AdProductInput } from "../types/ad-input";

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

export async function analyzeProduct(input: AdProductInput): Promise<ProductAnalysis> {
  const benefits = dedupe(input.keyBenefits.map((item) => sentenceCase(item)));
  const painPoints = dedupe((input.painPoints ?? []).map((item) => sentenceCase(item)));
  const description = input.productDescription.trim();
  const recommendedObjective = inferObjective(input, description, painPoints);
  const sortedBenefits = [...benefits].sort(
    (left, right) =>
      scoreBenefit(right, recommendedObjective) - scoreBenefit(left, recommendedObjective),
  );
  const primaryBenefit =
    sortedBenefits[0] ??
    sentenceCase(description.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? "Beneficio principal por definir");
  const supportingBenefits = sortedBenefits.slice(1, 3);
  const primaryPainPoint = painPoints[0] ?? null;
  const confidenceSignals = dedupe([
    typeof input.price === "number" ? `Precio visible ${formatPrice(input.price, input.currency)}` : "",
    input.brandName ? `Marca ${input.brandName}` : "",
    input.image?.url ? "Tiene recurso visual para el anuncio" : "",
    /(garantia|resenas|testado|original|envio)/i.test(description)
      ? "Incluye señales de confianza en la descripcion"
      : "",
  ]);

  return {
    productName: input.productName,
    categoryName: input.categoryName ?? "General",
    mainOffer: extractMainOffer(description, input.productName),
    benefits,
    primaryBenefit,
    supportingBenefits,
    primaryPainPoint,
    recommendedObjective,
    priceLabel: formatPrice(input.price, input.currency),
    brandLabel: input.brandName?.trim() || null,
    tone: input.tone ?? "persuasive",
    audience:
      input.audienceSummary?.trim() ||
      "Personas interesadas en una solucion concreta, facil de entender y de accionar.",
    confidenceSignals,
    imageAvailable: Boolean(input.image?.url),
  };
}
