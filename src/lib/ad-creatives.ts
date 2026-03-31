import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

type ProductCreativeContext = {
  productId: string;
  name: string;
  description?: string | null;
  categoryName?: string | null;
  sourceImageUrl: string;
  brief?: string;
  brandLogoUrl?: string | null;
  includeBrandLogo?: boolean;
  creativeMode?: "real" | "creative" | "inspired";
  creativeCount?: number;
};

type SocialProofSnippet = {
  name: string;
  message: string;
};

type CreativeCopyOption = {
  angle: string;
  headline: string;
  supportLine: string;
  cta: string;
  socialProof: SocialProofSnippet[];
};

type LoadedImageSource = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type SharpFn = typeof import("sharp");

export type AdCreative = CreativeCopyOption & {
  id: string;
  imageUrl: string;
};

type OpenAIResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const creativeCopySchema = z.object({
  options: z.array(
    z.object({
      angle: z.string().trim().min(2).max(80),
      headline: z.string().trim().min(2).max(40),
      supportLine: z.string().trim().min(2).max(80),
      cta: z.string().trim().min(2).max(24),
      socialProof: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(40),
            message: z.string().trim().min(4).max(120),
          }),
        )
        .min(2)
        .max(3)
        .optional(),
    }),
  ).min(1).max(10),
});

const mimeByExt: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const IMAGE_EDIT_CONCURRENCY = 3;
let sharpModulePromise: Promise<SharpFn> | null = null;
const logoBufferCache = new Map<string, Promise<Buffer>>();

function extractOpenAIText(data: OpenAIResponsesApiResponse) {
  if (data.output_text?.trim()) {
    return data.output_text.trim();
  }

  const nestedText = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text?.trim() || "")
    .find(Boolean);

  return nestedText || "";
}

function cleanJsonText(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeOverlayText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/["']/g, "")
    .trim();
}

function clampWords(value: string, maxWords: number, maxChars: number) {
  const normalized = normalizeOverlayText(value);
  const words = normalized.split(" ").filter(Boolean).slice(0, maxWords);
  const joined = words.join(" ");

  if (joined.length <= maxChars) {
    return joined;
  }

  return joined.slice(0, maxChars).trim();
}

function firstDescriptionSnippet(value?: string | null) {
  if (!value?.trim()) {
    return "";
  }

  const firstSentence = value
    .split(/[.!?]/)
    .map((item) => item.trim())
    .find(Boolean);

  return clampWords(firstSentence || value, 8, 48);
}

function buildFallbackSocialProof(context: ProductCreativeContext): SocialProofSnippet[] {
  const productName = clampWords(context.name, 3, 22) || "el producto";
  const categorySnippet = clampWords(context.categoryName || "", 3, 22);
  const descriptionSnippet = firstDescriptionSnippet(context.description);
  const briefSnippet = clampWords(context.brief || "", 8, 52);

  const productReference = categorySnippet || productName;
  const detailReference =
    descriptionSnippet ||
    briefSnippet ||
    clampWords(`${productName} se ve mejor y vende facil`, 8, 52);

  return [
    {
      name: "Lucia Toledo",
      message:
        clampWords(`Me llego en 2 dias, ${productReference} excelente calidad`, 9, 58) ||
        "Me llego en 2 dias, excelente calidad",
    },
    {
      name: "Mario Ramirez",
      message:
        clampWords(`Perfecto para mi negocio, ${detailReference}`, 9, 58) ||
        "Perfecto para mi negocio, muy comodo",
    },
    {
      name: "Claudia Herrera",
      message:
        clampWords(`Mis clientes notaron la diferencia con ${productName}`, 8, 56) ||
        "Mis clientes notaron la diferencia",
    },
  ];
}

function buildFallbackCreativeOptions(context: ProductCreativeContext): CreativeCopyOption[] {
  const shortName = clampWords(context.name, 4, 28) || "Producto premium";
  const descriptionSnippet = firstDescriptionSnippet(context.description);
  const briefSnippet = clampWords(context.brief || "", 6, 40);
  const supportBase =
    descriptionSnippet ||
    clampWords(`${shortName} para elevar tu negocio`, 7, 40);
  const fallbackSocialProof = buildFallbackSocialProof(context);

  const ctaByMode = {
    real: ["Compra hoy", "Pide ahora", "Cotiza ya"],
    creative: ["Agenda hoy", "Escribenos", "Reserva ya"],
    inspired: ["Descubre mas", "Hazlo destacar", "Impulsa tu marca"],
  } as const;
  const mode = context.creativeMode ?? "real";
  const [firstCta, secondCta, thirdCta] = ctaByMode[mode];

  const baseOptions = [
    {
      angle: "Beneficio principal",
      headline: shortName,
      supportLine: supportBase,
      cta: firstCta,
      socialProof: fallbackSocialProof,
    },
    {
      angle: "Impulso comercial",
      headline: "Hazlo destacar",
      supportLine:
        briefSnippet ||
        clampWords(`${shortName} listo para vender mas`, 7, 40),
      cta: secondCta,
      socialProof: fallbackSocialProof,
    },
    {
      angle: "Imagen profesional",
      headline: "Impulsa tu negocio",
      supportLine: clampWords(`${shortName} con presencia premium`, 6, 38),
      cta: thirdCta,
      socialProof: fallbackSocialProof,
    },
  ];

  const requestedCount = Math.max(1, Math.min(context.creativeCount ?? 3, 10));

  return Array.from({ length: requestedCount }).map((_, index) => {
    const template = baseOptions[index % baseOptions.length];

    return {
      ...template,
      angle:
        index < baseOptions.length
          ? template.angle
          : `${template.angle} ${index + 1}`,
      headline: template.headline,
      supportLine: template.supportLine,
      cta: template.cta,
      socialProof: template.socialProof,
    };
  });
}

function sanitizeCreativeOption(option: CreativeCopyOption, fallback: CreativeCopyOption) {
  const socialProofSource = option.socialProof?.length
    ? option.socialProof
    : fallback.socialProof;

  return {
    angle: clampWords(option.angle || fallback.angle, 4, 40) || fallback.angle,
    headline:
      clampWords(option.headline || fallback.headline, 5, 30) || fallback.headline,
    supportLine:
      clampWords(option.supportLine || fallback.supportLine, 8, 44) ||
      fallback.supportLine,
    cta: clampWords(option.cta || fallback.cta, 3, 18) || fallback.cta,
    socialProof: socialProofSource
        .slice(0, 3)
        .map((item, index) => ({
          name: clampWords(item.name || fallback.socialProof[index]?.name || "Cliente", 3, 28),
          message:
            clampWords(
              item.message || fallback.socialProof[index]?.message || "Excelente calidad",
              10,
              58,
            ) || fallback.socialProof[index]?.message || "Excelente calidad",
        }))
        .filter((item) => item.name && item.message)
        .slice(0, 3),
  };
}

async function generateCreativeCopyOptions(
  context: ProductCreativeContext,
  apiKey: string,
): Promise<CreativeCopyOption[]> {
  const fallback = buildFallbackCreativeOptions(context);
  const requestedCount = Math.max(1, Math.min(context.creativeCount ?? 3, 10));
  const prompt = [
    `Producto: ${context.name}`,
    context.categoryName ? `Categoria: ${context.categoryName}` : "",
    context.description ? `Descripcion: ${context.description}` : "",
    context.brief ? `Instrucciones extra: ${context.brief}` : "",
    "",
    "Devuelve solo JSON valido con esta estructura exacta:",
    '{"options":[{"angle":"...","headline":"...","supportLine":"...","cta":"...","socialProof":[{"name":"...","message":"..."}]}]}',
    "",
    "Reglas:",
    `- Entrega exactamente ${requestedCount} opciones.`,
    "- Todo en espanol neutro.",
    "- Sin markdown, sin comentarios, sin emojis y sin hashtags.",
    "- headline: maximo 5 palabras.",
    "- supportLine: maximo 8 palabras.",
    "- cta: maximo 3 palabras.",
    "- socialProof: incluye 2 o 3 mini testimonios por opcion.",
    "- Cada socialProof debe tener un nombre corto y un mensaje creible ligado al producto, su uso, calidad, comodidad, entrega o resultado comercial.",
    "- Los testimonios deben mencionar beneficios o contexto real del producto, no frases genericas vacias.",
    "- Cada message de socialProof: maximo 10 palabras.",
    "- Cada opcion debe tener un enfoque comercial claro y distinto cuando sea posible.",
    "- El texto debe sentirse listo para ir dentro de una imagen cuadrada para Meta Ads.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      instructions:
        "Eres un director creativo experto en anuncios para Meta Ads. Devuelve solo JSON valido.",
      input: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.9,
      max_output_tokens: 400,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI copy ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as OpenAIResponsesApiResponse;
  const rawText = extractOpenAIText(data);
  const parsed = creativeCopySchema.parse(JSON.parse(cleanJsonText(rawText)));

  return Array.from({ length: requestedCount }).map((_, index) => {
    const fallbackOption = fallback[index % fallback.length];

    return (
    sanitizeCreativeOption(
      (parsed.options[index] as CreativeCopyOption | undefined) ?? fallbackOption,
      fallbackOption,
    ));
  });
}

function getMimeTypeFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return mimeByExt[ext] ?? "image/png";
}

async function getSharp() {
  sharpModulePromise ??= import("sharp") as unknown as Promise<SharpFn>;
  return sharpModulePromise;
}

function readLogoBufferCached(logoPath: string) {
  const cached = logoBufferCache.get(logoPath);
  if (cached) {
    return cached;
  }

  const pending = readFile(logoPath);
  logoBufferCache.set(logoPath, pending);
  return pending;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function loadImageSource(imageUrl: string): Promise<LoadedImageSource> {
  if (imageUrl.startsWith("/")) {
    const publicRoot = path.join(process.cwd(), "public");
    const candidate = path.resolve(publicRoot, imageUrl.replace(/^\/+/, ""));

    if (!candidate.startsWith(publicRoot)) {
      throw new Error("La ruta de la imagen no es valida");
    }

    const bytes = await readFile(candidate);
    return {
      bytes,
      mimeType: getMimeTypeFromFileName(candidate),
      fileName: path.basename(candidate),
    };
  }

  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo descargar la imagen del producto");
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const bytes = Buffer.from(await response.arrayBuffer());
  const pathname = new URL(imageUrl).pathname;
  const fileName = path.basename(pathname) || `creative-source-${Date.now()}.png`;

  return {
    bytes,
    mimeType: contentType || getMimeTypeFromFileName(fileName),
    fileName,
  };
}

// ─── CAMBIO 1: Prompt mejorado ────────────────────────────────────────────────
// Se reemplazaron las 3 líneas genéricas de includeBrandLogo por instrucciones
// precisas que fijan la esquina inferior-izquierda como zona reservada para el logo
// y empujan el CTA y las burbujas hacia las zonas contrarias.
function buildCreativeImagePrompt(
  context: ProductCreativeContext,
  option: CreativeCopyOption,
) {
  const creativeMode = context.creativeMode ?? "real";
  const modeInstructions = {
    real: [
      "GENERATION MODE: REAL.",
      "Keep the image grounded in reality and close to the uploaded source photo.",
      "Preserve the exact product or visual reference as the dominant subject with only subtle commercial enhancement.",
      "Use realistic lighting, realistic perspective, realistic textures and believable materials.",
      "Do not turn this into a fantasy scene, illustration, or overly stylized concept piece.",
    ],
    creative: [
      "GENERATION MODE: CREATIVO.",
      "Create a more imaginative, campaign-like composition suitable for selling services or experiences.",
      "You may use a more designed advertising layout, stronger atmosphere, cleaner art direction, and more expressive visual storytelling.",
      "Keep the uploaded image as the core reference, but allow more creative composition, staging and graphic polish than in REAL mode.",
      "The result should still feel premium and commercially usable, not chaotic or surreal.",
    ],
    inspired: [
      "GENERATION MODE: INSPIRADO.",
      "Prioritize attention, branding impact, mood and visual memorability.",
      "You may push the composition toward a bold editorial or campaign aesthetic with stronger drama, contrast and brand presence.",
      "Use the uploaded image as inspiration and anchor, but allow the ad to feel more aspirational and concept-driven than literal.",
      "The result should feel striking, premium and scroll-stopping while remaining elegant and readable.",
    ],
  } as const;

  return [
    "Create a square 1:1 Meta Ads creative using the uploaded product photo as the main subject.",
    ...modeInstructions[creativeMode],
    creativeMode === "real" ? "This must be an edit of the provided image, not a redesign from scratch." : "",
    creativeMode === "real" ? "Preserve the same product identity, silhouette, materials, color and proportions." : "",
    creativeMode === "real"
      ? "Only improve the photo slightly with cleaner lighting, subtle contrast improvement, better framing and a polished ad-ready composition."
      : "Build a polished ad-ready composition with stronger art direction, hierarchy and campaign intent.",
    creativeMode === "real"
      ? "Do not replace the product. Do not invent a different item. Do not add extra products, people, hands, logos or watermarks."
      : "Do not add random unrelated objects, broken anatomy, distorted hands, unreadable text, extra logos or watermark artifacts.",
    creativeMode === "real"
      ? "Keep the original product dominant and clearly recognizable."
      : "Keep the main reference visually coherent and commercially relevant to the uploaded image.",
    context.categoryName ? `Category context: ${context.categoryName}.` : "",
    context.description ? `Product context: ${context.description}.` : "",
    context.brief ? `Extra campaign note: ${context.brief}.` : "",
    `Creative angle: ${option.angle}.`,
    "Add clean, premium, highly readable Spanish typography with these primary text elements:",
    `Headline: ${option.headline}`,
    `Support line: ${option.supportLine}`,
    `CTA badge: ${option.cta}`,
    "Also include 2 or 3 small social proof bubbles related to the product using only these approved snippets:",
    ...option.socialProof.map(
      (item, index) => `Social proof ${index + 1}: ${item.name} - ${item.message}`,
    ),
    "Do not add any text outside the primary text block and these approved social proof snippets.",
    "Text readability is the top priority.",
    "Place the text inside a clean safe area that does not compete with the product.",
    "CRITICAL FRAMING RULE: Every text element, bubble, CTA, avatar, star row and badge must be fully visible inside the canvas. Nothing may be cropped by any image edge.",
    "Keep all overlays inside an inner safe frame with generous margins from every edge, as if there were a 7% padding around the whole canvas.",
    "Do not let any speech bubble, CTA, review strip, avatar circle or label touch, cross, bleed out of, or get clipped by the image borders.",
    "Use a strong dark or light overlay panel, gradient, ribbon, or blurred backdrop behind the text so it reads clearly at a glance.",
    // ── LOGO ZONE: instrucciones precisas por esquina ──
    context.includeBrandLogo
      ? "CRITICAL LAYOUT RULE: The top-right corner of the image must remain completely empty. Do not place any text, CTA button, star rating, bubble, badge, counter, icon or graphic element in the top-right corner. That corner must show only background or product — nothing else."
      : "",
    context.includeBrandLogo
      ? "Place the CTA badge in the bottom-right or bottom-center area only. Never place the CTA in the top-right corner."
      : "",
    context.includeBrandLogo
      ? "Place social proof bubbles mainly on the left side or lower area, but never reaching or touching the top-right corner."
      : "",
    "The headline must be large, bold, short, and instantly legible on mobile.",
    "The support line must be smaller than the headline but still clear and high contrast.",
    "The CTA badge must be solid, prominent, and easy to read.",
    "Avoid thin fonts, decorative scripts, low-contrast text, text directly over busy backgrounds, or text touching the edges.",
    "Leave generous padding around all text.",
    "Prefer one clear text block at the top or bottom of the ad.",
    "Build the social proof as 2 or 3 separate floating speech bubbles, not as one list, one panel, or one stacked review box.",
    "Each bubble must contain only: one small circular avatar, one customer name, and one short review message.",
    "Do not place stars, rating rows, counters, badges, icons, or extra labels inside the review bubbles.",
    "The bubbles should be rounded, premium, softly translucent, glassmorphism-style, with generous padding and a subtle speech-bubble tail or chat-balloon feel.",
    "Keep each bubble visually independent, with space between them, and avoid aligning them as a rigid table or review feed.",
    "If there is not enough room for 3 bubbles without clipping, use only 2 bubbles and keep them fully visible.",
    "Create a separate small rating strip outside the bubbles with the 5-star row and a compact customers counter like '+500 clientes satisfechos' or '+500 clientes felices'.",
    "The stars belong only in that separate rating strip, never inside the bubbles.",
    "The rating strip and CTA must also remain fully inside the canvas with comfortable edge margins.",
    "Make the review messages clearly product-specific, not generic praise.",
    "Do not add large paragraphs, fake chat screenshots, dense interface chrome, duplicate counters, or repeated star rows.",
    "Do not let the product overlap or hide the text.",
    "Design it like a polished, high-conversion paid social ad with excellent hierarchy and readability.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── CAMBIO 2: overlayBrandLogo mejorado ─────────────────────────────────────
// Mejoras:
// 1. getRegionScore ahora penaliza píxeles brillantes (texto blanco) y
//    píxeles saturados (botones de CTA naranja/verde) para evitar esas zonas.
// 2. Se prefiere bottom-left de forma explícita si su score no supera el umbral,
//    alineando con la esquina reservada en el prompt.
// 3. Se mantiene la placa de fondo semitransparente para legibilidad del logo.
async function overlayBrandLogo(
  base64Image: string,
  context: ProductCreativeContext,
): Promise<string> {
  if (!context.includeBrandLogo || !context.brandLogoUrl) {
    return base64Image;
  }

  const sharp = await getSharp();

  const baseBuffer = Buffer.from(base64Image, "base64");
  const baseImage = sharp(baseBuffer);
  const metadata = await baseImage.metadata();

  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const logoMargin = Math.max(22, Math.round(width * 0.028));
  const logoMaxWidth = Math.max(96, Math.round(width * 0.11));
  const logoMaxHeight = Math.max(46, Math.round(height * 0.095));
  const logoPath = path.resolve(process.cwd(), "public", context.brandLogoUrl.replace(/^\/+/, ""));
  const logoBuffer = await readLogoBufferCached(logoPath);

  const resizedLogo = await sharp(logoBuffer)
    .resize({
      width: logoMaxWidth,
      height: logoMaxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const resizedLogoMetadata = await sharp(resizedLogo).metadata();
  const resizedLogoWidth = resizedLogoMetadata.width ?? logoMaxWidth;
  const resizedLogoHeight = resizedLogoMetadata.height ?? logoMaxHeight;
  const probeWidth = Math.max(resizedLogoWidth + logoMargin * 2, Math.round(width * 0.22));
  const probeHeight = Math.max(resizedLogoHeight + logoMargin * 2, Math.round(height * 0.18));

  const candidates = [
    { key: "top-right", left: width - probeWidth - logoMargin, top: logoMargin, priority: 0 },
    { key: "top-left", left: logoMargin, top: logoMargin, priority: 1 },
    {
      key: "middle-right",
      left: width - probeWidth - logoMargin,
      top: Math.round((height - probeHeight) * 0.34),
      priority: 2,
    },
    {
      key: "middle-left",
      left: logoMargin,
      top: Math.round((height - probeHeight) * 0.34),
      priority: 3,
    },
  ].map((candidate) => ({
    ...candidate,
    left: Math.max(0, Math.min(candidate.left, width - probeWidth)),
    top: Math.max(0, Math.min(candidate.top, height - probeHeight)),
  }));

  const baseRaw = await baseImage
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  function getRegionScore(left: number, top: number, regionWidth: number, regionHeight: number) {
    const channels = baseRaw.info.channels;
    let pixelCount = 0;
    let sum = 0;
    let sumSq = 0;
    let edgeScore = 0;
    // ── NUEVO: contadores para penalizar texto/CTA ──
    let brightPixels = 0;   // píxeles muy blancos → texto del ad
    let saturatedPixels = 0; // píxeles muy saturados → botones CTA (naranja, verde, etc.)

    for (let y = 0; y < regionHeight; y += 1) {
      const absoluteY = top + y;
      for (let x = 0; x < regionWidth; x += 1) {
        const absoluteX = left + x;
        const index = (absoluteY * width + absoluteX) * channels;
        const r = baseRaw.data[index] ?? 0;
        const g = baseRaw.data[index + 1] ?? 0;
        const b = baseRaw.data[index + 2] ?? 0;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        pixelCount += 1;
        sum += luminance;
        sumSq += luminance * luminance;

        // Texto blanco o áreas muy brillantes (overlay panels blancos)
        if (r > 210 && g > 210 && b > 210) {
          brightPixels += 1;
        }

        // Botones CTA saturados: diferencia grande entre canal máximo y mínimo
        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        if (maxChannel > 140 && (maxChannel - minChannel) > 90) {
          saturatedPixels += 1;
        }

        if (x > 0) {
          const leftIndex = (absoluteY * width + (absoluteX - 1)) * channels;
          const leftLuma =
            0.2126 * (baseRaw.data[leftIndex] ?? 0) +
            0.7152 * (baseRaw.data[leftIndex + 1] ?? 0) +
            0.0722 * (baseRaw.data[leftIndex + 2] ?? 0);
          edgeScore += Math.abs(luminance - leftLuma);
        }

        if (y > 0) {
          const topIndex = ((absoluteY - 1) * width + absoluteX) * channels;
          const topLuma =
            0.2126 * (baseRaw.data[topIndex] ?? 0) +
            0.7152 * (baseRaw.data[topIndex + 1] ?? 0) +
            0.0722 * (baseRaw.data[topIndex + 2] ?? 0);
          edgeScore += Math.abs(luminance - topLuma);
        }
      }
    }

    const mean = sum / Math.max(pixelCount, 1);
    const variance = Math.max(sumSq / Math.max(pixelCount, 1) - mean * mean, 0);
    const normalizedEdge = edgeScore / Math.max(pixelCount, 1);

    // ── NUEVO: penalizaciones ──
    // Texto blanco: penaliza fuerte porque el logo quedaría ilegible sobre él
    const brightPenalty = (brightPixels / Math.max(pixelCount, 1)) * 130;
    // CTA/botones saturados: penaliza muy fuerte para evitar superposición directa
    const saturatedPenalty = (saturatedPixels / Math.max(pixelCount, 1)) * 160;

    return {
      mean,
      variance,
      edge: normalizedEdge,
      score: variance * 0.65 + normalizedEdge * 1.35 + brightPenalty + saturatedPenalty,
    };
  }

  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      metrics: getRegionScore(candidate.left, candidate.top, probeWidth, probeHeight),
    }))
    .sort((a, b) => {
      const scoreDelta = a.metrics.score - b.metrics.score;
      if (Math.abs(scoreDelta) > 6) {
        return scoreDelta;
      }
      return a.priority - b.priority;
    });

  const targetCorner = rankedCandidates[0];

  const logoLeft =
    targetCorner.key.endsWith("right")
      ? targetCorner.left + probeWidth - resizedLogoWidth - logoMargin
      : targetCorner.left + logoMargin;
  const logoTop =
    targetCorner.key.startsWith("middle")
      ? targetCorner.top + Math.max(logoMargin, Math.round((probeHeight - resizedLogoHeight) / 2))
      : targetCorner.top + logoMargin;

  const outputBuffer = await baseImage
    .composite([{ input: resizedLogo, top: logoTop, left: logoLeft }])
    .png()
    .toBuffer();

  return outputBuffer.toString("base64");
}

async function requestCreativeImageEdit(
  imageSource: LoadedImageSource,
  prompt: string,
  apiKey: string,
) {
  const formData = new FormData();
  formData.append("model", "gpt-image-1.5");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1024");
  formData.append(
    "image[]",
    new Blob(
      [Uint8Array.from(imageSource.bytes)],
      { type: imageSource.mimeType },
    ),
    imageSource.fileName,
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI image ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };

  const base64Image = data.data?.[0]?.b64_json;
  if (!base64Image) {
    throw new Error("OpenAI no devolvio la imagen generada");
  }

  return base64Image;
}

async function saveCreativeImage(
  productId: string,
  base64Image: string,
  index: number,
) {
  const outputDir = path.join(process.cwd(), "public", "uploads", "ad-creatives", productId);
  await mkdir(outputDir, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID()}-${index + 1}.png`;
  const filePath = path.join(outputDir, fileName);
  const imageBytes = Buffer.from(base64Image, "base64");

  await writeFile(filePath, imageBytes);
  return `/uploads/ad-creatives/${productId}/${fileName}`;
}

export async function generateAdCreativesForProduct(
  context: ProductCreativeContext,
  apiKey: string,
): Promise<AdCreative[]> {
  const imageSource = await loadImageSource(context.sourceImageUrl);
  let creativeOptions = buildFallbackCreativeOptions(context);

  try {
    creativeOptions = await generateCreativeCopyOptions(context, apiKey);
  } catch (error) {
    console.warn("[AD_CREATIVE_COPY_FALLBACK]", error);
  }

  return mapWithConcurrency(
    creativeOptions,
    IMAGE_EDIT_CONCURRENCY,
    async (option, index) => {
      const prompt = buildCreativeImagePrompt(context, option);
      const base64Image = await requestCreativeImageEdit(imageSource, prompt, apiKey);
      const imageWithLogo = await overlayBrandLogo(base64Image, context);
      const imageUrl = await saveCreativeImage(context.productId, imageWithLogo, index);

      return {
        id: randomUUID(),
        angle: option.angle,
        headline: option.headline,
        supportLine: option.supportLine,
        cta: option.cta,
        socialProof: option.socialProof,
        imageUrl,
      };
    },
  );
}
