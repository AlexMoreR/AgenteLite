import type { AdCopyVariant } from "../types/ad-output";
import type { ProductAnalysis } from "./analyzeProduct";
import type { AdStrategy } from "../types/ad-output";

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function lowerFirst(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function limitWords(value: string, maxWords: number) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function cleanPainPoint(value: string | null) {
  if (!value?.trim()) {
    return "";
  }

  return lowerFirst(value.replace(/\.$/, ""));
}

function cleanBenefit(value: string) {
  return lowerFirst(value.replace(/\.$/, ""));
}

function stripTrailingPunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}

function humanizeProductName(productName: string) {
  return productName.trim() || "este producto";
}

function bannedCopyPatterns() {
  return [
    /entra a jugar/gi,
    /comodidad y practicidad total/gi,
    /propuesta centrada en/gi,
    /transmite/gi,
    /solucion ideal/gi,
    /hace mas facil/gi,
    /si todavia sigues lidiando con/gi,
    /asi se ve una oferta cuando de verdad se siente/gi,
  ];
}

function normalizeCopyLine(value: string) {
  let next = value.trim().replace(/\s+/g, " ");

  for (const pattern of bannedCopyPatterns()) {
    next = next.replace(pattern, "");
  }

  return next
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shortenLine(value: string, maxWords = 10) {
  return limitWords(stripTrailingPunctuation(value), maxWords);
}

function validateNaturalCopy(lines: string[]) {
  return lines
    .map(normalizeCopyLine)
    .filter(Boolean)
    .join("\n");
}

function hookFromPain(painPoint: string) {
  if (!painPoint) {
    return "👀 Si quieres que tu negocio se vea mejor, mira esto.";
  }

  return `👀 Si ${shortenLine(painPoint, 7)}, la gente lo nota.`;
}

function emotionFromPain(painPoint: string) {
  if (!painPoint) {
    return "Cuando no convence de entrada, vender cuesta mas.";
  }

  return "Eso baja la confianza y hace que sigan de largo.";
}

function aspirationHook(productName: string) {
  return `✨ Si quieres que ${shortenLine(productName.toLowerCase(), 5)} se vea mejor, mira esto.`;
}

function aspirationLine() {
  return "La primera impresion cuenta mas de lo que parece.";
}

function practicalHook() {
  return "✅ Si buscas algo claro y listo para vender, mira esto.";
}

function solutionLine(productName: string, brandLabel: string | null) {
  const productLabel = humanizeProductName(productName);
  return brandLabel
    ? `${productLabel} de ${brandLabel} te ayuda a verte mas profesional.`
    : `${productLabel} te ayuda a verte mas profesional.`;
}

function benefitLine(primaryBenefit: string, supportingBenefit?: string) {
  const main = cleanBenefit(primaryBenefit);
  const support = supportingBenefit ? cleanBenefit(supportingBenefit) : "";

  if (support) {
    return `💡 Te ayuda a ${shortenLine(main, 6)} y tambien a ${shortenLine(support, 6)}.`;
  }

  return `💡 Te ayuda a ${shortenLine(main, 8)}.`;
}

function practicalBenefitLine(primaryBenefit: string, supportingBenefit?: string) {
  const main = cleanBenefit(primaryBenefit);
  const support = supportingBenefit ? cleanBenefit(supportingBenefit) : "";

  if (support) {
    return `💡 Se ve bien, se entiende rapido y ayuda a ${shortenLine(main, 6)} con ${shortenLine(support, 5)}.`;
  }

  return `💡 Se entiende rapido y ayuda a ${shortenLine(main, 8)}.`;
}

function ctaLine(cta: string) {
  return `👉 ${stripTrailingPunctuation(cta)}.`;
}

function buildHeadline(base: string, fallback: string) {
  const normalized = limitWords(base, 6);
  return normalized.length <= 40 && normalized ? normalized : fallback;
}

function buildDescription(value: string, fallback: string) {
  const normalized = sentenceCase(limitWords(value, 7));
  return normalized || fallback;
}

export async function generateCopies(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
): Promise<AdCopyVariant[]> {
  const supportBenefit = analysis.supportingBenefits[0] ?? analysis.primaryBenefit;
  const secondSupportBenefit = analysis.supportingBenefits[1] ?? supportBenefit;
  const painPoint = cleanPainPoint(analysis.primaryPainPoint);
  const primaryBenefit = cleanBenefit(analysis.primaryBenefit);
  const supportLine = cleanBenefit(supportBenefit);
  const practicalBenefit = cleanBenefit(secondSupportBenefit);
  const cta = strategy.callToAction;
  const productLabel = humanizeProductName(analysis.productName);

  return [
    {
      id: "dolor-problema",
      primaryText: validateNaturalCopy([
        hookFromPain(painPoint),
        emotionFromPain(painPoint),
        solutionLine(productLabel, analysis.brandLabel),
        benefitLine(analysis.primaryBenefit, supportBenefit),
        ctaLine(cta),
      ]),
      headline: buildHeadline(
        painPoint ? `Que no te frene ${painPoint}` : `Haz que se vea mejor`,
        "Haz que se vea mejor",
      ),
      description: buildDescription(`${primaryBenefit} y ${supportLine}`, "Mas confianza al vender"),
    },
    {
      id: "resultado-aspiracion",
      primaryText: validateNaturalCopy([
        aspirationHook(productLabel),
        aspirationLine(),
        solutionLine(productLabel, analysis.brandLabel),
        benefitLine(analysis.primaryBenefit, supportBenefit),
        ctaLine(cta),
      ]),
      headline: buildHeadline(
        `Haz que se vea mejor`,
        "Haz que se vea mejor",
      ),
      description: buildDescription(`${primaryBenefit} para vender mejor`, "Se ve mejor y vende mejor"),
    },
    {
      id: "directo-practico",
      primaryText: validateNaturalCopy([
        practicalHook(),
        `No necesitas darle tantas vueltas para que ${shortenLine(productLabel.toLowerCase(), 5)} se vea bien.`,
        solutionLine(productLabel, analysis.brandLabel),
        practicalBenefitLine(analysis.primaryBenefit, secondSupportBenefit),
        ctaLine(cta),
      ]),
      headline: buildHeadline(
        `Listo para vender`,
        "Listo para tu negocio",
      ),
      description: buildDescription(`${practicalBenefit} sin enredos`, "Claro y facil de vender"),
    },
  ];
}
