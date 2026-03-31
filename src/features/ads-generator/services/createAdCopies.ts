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

  return humanizeAudienceOrPain(lowerFirst(value.replace(/\.$/, "")));
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

function humanizeAudienceOrPain(value: string) {
  const normalized = stripTrailingPunctuation(value).trim();
  if (!normalized) {
    return "";
  }

  if (/emprendedor(?:a|as|es)?\s+que\s+inicia\s+sal[oó]n/i.test(normalized)) {
    return "estas empezando tu salon";
  }

  if (/emprendedor(?:a|as|es)?\s+que\s+inicia/i.test(normalized)) {
    return "estas empezando tu negocio";
  }

  if (/sal[oó]n/i.test(normalized) && /inicia|empezando|montando/i.test(normalized)) {
    return "estas empezando tu salon";
  }

  if (/negocio\s+de\s+belleza/i.test(normalized) && /montando|empezando|inicia/i.test(normalized)) {
    return "estas montando tu negocio de belleza";
  }

  if (/emprendedor(?:a|as|es)?/i.test(normalized) && /belleza|spa|sal[oó]n/i.test(normalized)) {
    return "estas montando tu negocio de belleza";
  }

  if (/cliente(?:s)?\s+que/i.test(normalized)) {
    return normalized.replace(/cliente(?:s)?\s+que\s+/i, "quieres llegar a personas que ");
  }

  if (/personas\s+que/i.test(normalized)) {
    return normalized.replace(/personas\s+que\s+/i, "quieres llegar a personas que ");
  }

  if (/^[a-záéíóúñ\s]+$/.test(normalized) && normalized.split(/\s+/).length <= 5) {
    return `tu negocio todavia se siente ${normalized}`;
  }

  return normalized;
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

function categoryLabel(categoryName: string) {
  const normalized = stripTrailingPunctuation(categoryName).trim().toLowerCase();
  return normalized || "negocio";
}

function titleContextLabel(categoryName: string) {
  const normalized = categoryLabel(categoryName);

  if (/spa/.test(normalized)) {
    return "spa";
  }

  if (/salon|sal[oó]n|belleza/.test(normalized)) {
    return "salon";
  }

  if (/tienda/.test(normalized)) {
    return "tienda";
  }

  return "negocio";
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

function isWeakTitle(value: string, sourceContext: string) {
  const normalized = normalizeCopyLine(value);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length < 4 || words.length > 10) {
    return true;
  }

  if (soundsInstitutional(normalized)) {
    return true;
  }

  if (overlapsWithContext(normalized, sourceContext)) {
    return true;
  }

  return false;
}

function isWeakDescription(value: string, sourceContext: string) {
  const normalized = normalizeCopyLine(value);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length < 3 || words.length > 8) {
    return true;
  }

  if (soundsInstitutional(normalized)) {
    return true;
  }

  if (overlapsWithContext(normalized, sourceContext)) {
    return true;
  }

  return false;
}

function buildHeadline(
  candidates: string[],
  fallbacks: string[],
  sourceContext: string,
) {
  const next = [...candidates, ...fallbacks]
    .map((value) => sentenceCase(limitWords(stripTrailingPunctuation(value), 10)))
    .find((value) => value && !isWeakTitle(value, sourceContext));

  return next ?? "Haz que tu negocio se vea profesional";
}

function buildDescription(
  candidates: string[],
  fallbacks: string[],
  sourceContext: string,
) {
  const next = [...candidates, ...fallbacks]
    .map((value) => sentenceCase(limitWords(stripTrailingPunctuation(value), 8)))
    .find((value) => value && !isWeakDescription(value, sourceContext));

  return next ?? "Mejor imagen y mas confianza";
}

function createHeadlineForVariant(
  variant: "pain" | "aspiration" | "practical",
  businessLabel: string,
  sourceContext: string,
) {
  const context = titleContextLabel(businessLabel);

  if (variant === "pain") {
    return buildHeadline(
      [
        `Haz que tu ${context} se vea profesional`,
        `Mejora la imagen de tu ${context}`,
        `Dale mejor imagen a tu ${context}`,
      ],
      [
        "Haz que tu negocio se vea profesional",
        "Mejora la imagen de tu negocio",
        "Equipa tu negocio desde el inicio",
      ],
      sourceContext,
    );
  }

  if (variant === "aspiration") {
    return buildHeadline(
      [
        `Haz que tu ${context} se vea mejor`,
        `Mejora la imagen de tu ${context}`,
        `Tu ${context} puede verse profesional`,
        "Haz que tu negocio se vea profesional",
      ],
      [
        "Haz que tu negocio se vea profesional",
        "Mejora la imagen de tu spa",
        "Equipa tu negocio desde el inicio",
      ],
      sourceContext,
    );
  }

  return buildHeadline(
    [
      `Equipa tu ${context} desde el inicio`,
      "Tu negocio se ve claro y profesional",
      `Mejora la imagen de tu ${context}`,
    ],
    [
      "Equipa tu negocio desde el inicio",
      "Haz que tu negocio se vea profesional",
      "Mejora la imagen de tu negocio",
    ],
    sourceContext,
  );
}

function createDescriptionForVariant(
  variant: "pain" | "aspiration" | "practical",
  businessLabel: string,
  sourceContext: string,
) {
  const context = titleContextLabel(businessLabel);

  if (variant === "pain") {
    return buildDescription(
      [
        "Mejor imagen y mas confianza",
        `Mas confianza para tu ${context}`,
        "Presentacion profesional y mas confianza",
      ],
      [
        "Mejor imagen y mas confianza",
        "Atrae mas clientes con mejor imagen",
        "Comodidad y presentacion profesional",
      ],
      sourceContext,
    );
  }

  if (variant === "aspiration") {
    return buildDescription(
      [
        "Mas confianza y mejor presentacion",
        `Tu ${context} se ve profesional`,
        "Atrae mas clientes con mejor imagen",
      ],
      [
        "Mejor imagen y mas confianza",
        "Equipa tu spa como un experto",
        "Comodidad y presentacion profesional",
      ],
      sourceContext,
    );
  }

  return buildDescription(
    [
      "Comodidad y experiencia profesional",
      "Claro, profesional y facil de vender",
      `Tu ${context} se ve mejor`,
    ],
    [
      "Mejor imagen y mas confianza",
      "Comodidad y presentacion profesional",
      "Claro y facil de vender",
    ],
    sourceContext,
  );
}

export async function createAdCopies(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
): Promise<AdCopyVariant[]> {
  const supportBenefit = analysis.supportingBenefits[0] ?? analysis.primaryBenefit;
  const secondSupportBenefit = analysis.supportingBenefits[1] ?? supportBenefit;
  const painPoint = cleanPainPoint(analysis.primaryPainPoint);
  const cta = strategy.callToAction;
  const productLabel = humanizeProductName(analysis.productName);
  const businessLabel = categoryLabel(analysis.categoryName);
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
      headline: createHeadlineForVariant(
        "pain",
        businessLabel,
        sourceContext,
      ),
      description: createDescriptionForVariant(
        "pain",
        businessLabel,
        sourceContext,
      ),
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
      headline: createHeadlineForVariant(
        "aspiration",
        businessLabel,
        sourceContext,
      ),
      description: createDescriptionForVariant(
        "aspiration",
        businessLabel,
        sourceContext,
      ),
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
      headline: createHeadlineForVariant(
        "practical",
        businessLabel,
        sourceContext,
      ),
      description: createDescriptionForVariant(
        "practical",
        businessLabel,
        sourceContext,
      ),
    },
  ];
}

export const generateCopies = createAdCopies;
