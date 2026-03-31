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
    /ofrecemos/gi,
    /mobiliario profesional/gi,
    /resumen estrategico/gi,
    /angulo de venta/gi,
    /segmentacion basica/gi,
    /propuesta de valor/gi,
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

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenLine(value: string, maxWords = 10) {
  return limitWords(stripTrailingPunctuation(value), maxWords);
}

function lineHasCompleteSense(value: string) {
  const normalized = normalizeForCompare(value);
  const words = normalized.split(" ").filter(Boolean);
  return words.length >= 3;
}

function soundsInstitutional(value: string) {
  return /(propuesta|institucional|corporativo|estrategi|centrad|ofrecemos|transmite|resumen|manager|segmentacion)/i.test(
    value,
  );
}

function overlapsWithContext(value: string, sourceContext: string) {
  const lineWords = normalizeForCompare(value).split(" ").filter(Boolean);
  const sourceWords = normalizeForCompare(sourceContext).split(" ").filter(Boolean);

  if (lineWords.length < 6 || sourceWords.length < 6) {
    return false;
  }

  const sourceText = ` ${sourceWords.join(" ")} `;
  const matches = lineWords.filter((word) => sourceText.includes(` ${word} `)).length;
  return matches / lineWords.length >= 0.75;
}

function cleanCopyLines(lines: string[], sourceContext: string) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeCopyLine(rawLine);
    const compareKey = normalizeForCompare(line);

    if (!line) {
      continue;
    }

    if (!lineHasCompleteSense(line)) {
      continue;
    }

    if (seen.has(compareKey)) {
      continue;
    }

    if (soundsInstitutional(line)) {
      continue;
    }

    if (overlapsWithContext(line, sourceContext)) {
      continue;
    }

    seen.add(compareKey);
    cleaned.push(line);
  }

  return cleaned;
}

function resolveLine(primary: string, fallback: string, sourceContext: string) {
  return cleanCopyLines([primary], sourceContext)[0] ?? cleanCopyLines([fallback], sourceContext)[0] ?? fallback;
}

function buildOrderedCopy(
  parts: {
    hook: string;
    problem: string;
    solution: string;
    benefit: string;
    cta: string;
  },
  fallbackParts: {
    hook: string;
    problem: string;
    solution: string;
    benefit: string;
    cta: string;
  },
  sourceContext: string,
) {
  const ordered = [
    resolveLine(parts.hook, fallbackParts.hook, sourceContext),
    resolveLine(parts.problem, fallbackParts.problem, sourceContext),
    resolveLine(parts.solution, fallbackParts.solution, sourceContext),
    resolveLine(parts.benefit, fallbackParts.benefit, sourceContext),
  ];

  const cta = resolveLine(parts.cta, fallbackParts.cta, sourceContext);
  return [...ordered.filter(Boolean).slice(0, 4), cta].join("\n");
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
  return "Una buena imagen ayuda a que te tomen mas en serio.";
}

function practicalHook() {
  return "✅ Si quieres algo claro y listo para vender, mira esto.";
}

function practicalProblemLine() {
  return "Cuando todo se ve enredado, vender cuesta mas.";
}

function solutionLine(productName: string, brandLabel: string | null) {
  const productLabel = humanizeProductName(productName);
  return brandLabel
    ? `${productLabel} de ${brandLabel} hace que tu oferta se vea mas profesional.`
    : `${productLabel} hace que tu oferta se vea mas profesional.`;
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
    return `💡 Se entiende rapido y ayuda a ${shortenLine(main, 6)} con ${shortenLine(support, 5)}.`;
  }

  return `💡 Se entiende rapido y ayuda a ${shortenLine(main, 8)}.`;
}

function ctaLine(cta: string) {
  return `👉 ${stripTrailingPunctuation(cta)}.`;
}

function buildHeadline(base: string, fallback: string) {
  const normalized = sentenceCase(limitWords(stripTrailingPunctuation(base), 10));
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (normalized && wordCount >= 4) {
    return normalized;
  }

  return sentenceCase(limitWords(stripTrailingPunctuation(fallback), 10));
}

function buildDescription(value: string, fallback: string) {
  const normalized = sentenceCase(limitWords(value, 7));
  return normalized || fallback;
}

export async function createAdCopies(
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
  const sourceContext = [analysis.mainOffer, ...analysis.benefits].join(" ");

  return [
    {
      id: "dolor-problema",
      primaryText: buildOrderedCopy(
        {
          hook: hookFromPain(painPoint),
          problem: emotionFromPain(painPoint),
          solution: solutionLine(productLabel, analysis.brandLabel),
          benefit: benefitLine(analysis.primaryBenefit, supportBenefit),
          cta: ctaLine(cta),
        },
        {
          hook: "👀 Si algo no se ve bien, la gente lo nota.",
          problem: "Eso baja la confianza y puede frenar la compra.",
          solution: "Con esto tu negocio se ve mas serio desde el inicio.",
          benefit: "💡 Te ayuda a vender con mejor imagen.",
          cta: ctaLine(cta),
        },
        sourceContext,
      ),
      headline: buildHeadline(
        painPoint ? `Deja atras ${painPoint} y vende mejor` : "Haz que tu negocio se vea mejor",
        "Haz que tu negocio se vea mejor",
      ),
      description: buildDescription(`${primaryBenefit} y ${supportLine}`, "Mas confianza al vender"),
    },
    {
      id: "resultado-aspiracion",
      primaryText: buildOrderedCopy(
        {
          hook: aspirationHook(productLabel),
          problem: aspirationLine(),
          solution: solutionLine(productLabel, analysis.brandLabel),
          benefit: benefitLine(analysis.primaryBenefit, supportBenefit),
          cta: ctaLine(cta),
        },
        {
          hook: "✨ Si quieres verte mas pro, mira esto.",
          problem: "Una buena imagen ayuda a que te tomen mas en serio.",
          solution: "Con esto tu oferta se ve mas profesional.",
          benefit: "💡 Te ayuda a mostrar mejor tu servicio.",
          cta: ctaLine(cta),
        },
        sourceContext,
      ),
      headline: buildHeadline(
        "Haz que tu servicio se vea mejor",
        "Haz que tu servicio se vea mejor",
      ),
      description: buildDescription(`${primaryBenefit} para vender mejor`, "Se ve mejor y vende mejor"),
    },
    {
      id: "directo-practico",
      primaryText: buildOrderedCopy(
        {
          hook: practicalHook(),
          problem: practicalProblemLine(),
          solution: solutionLine(productLabel, analysis.brandLabel),
          benefit: practicalBenefitLine(analysis.primaryBenefit, secondSupportBenefit),
          cta: ctaLine(cta),
        },
        {
          hook: "✅ Si quieres algo claro, mira esto.",
          problem: "Cuando todo se ve enredado, vender cuesta mas.",
          solution: "Con esto muestras mejor tu oferta desde el primer vistazo.",
          benefit: "💡 Te ayuda a vender sin enredos.",
          cta: ctaLine(cta),
        },
        sourceContext,
      ),
      headline: buildHeadline(
        "Tu oferta se ve clara y lista",
        "Tu oferta se ve clara y lista",
      ),
      description: buildDescription(`${practicalBenefit} sin enredos`, "Claro y facil de vender"),
    },
  ];
}

export const generateCopies = createAdCopies;
