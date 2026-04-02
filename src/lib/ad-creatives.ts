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
  creativeMode?: "real" | "creative" | "inspired";
  creativeCount?: number;
  showSocialProof?: boolean;
  showRatingStrip?: boolean;
  showProductCallouts?: boolean;
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
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/i);
    if (!match) {
      throw new Error("La imagen embebida no es valida");
    }

    const mimeType = match[1]?.trim() || "image/png";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] ?? "";
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    const extension = Object.entries(mimeByExt).find(([, value]) => value === mimeType)?.[0] ?? ".png";

    return {
      bytes,
      mimeType,
      fileName: `embedded-source${extension}`,
    };
  }

  if (imageUrl.startsWith("/")) {
    const publicRoot = path.join(process.cwd(), "public");
    const candidate = path.resolve(publicRoot, imageUrl.replace(/^\/+/, ""));

    if (!candidate.startsWith(publicRoot)) {
      throw new Error("La ruta de la imagen no es valida");
    }

    const bytes = await readFile(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error("La imagen base ya no existe. Sube la imagen otra vez para generar nuevos creativos.");
      }

      throw error;
    });
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

function buildCreativeImagePrompt(
  context: ProductCreativeContext,
  option: CreativeCopyOption,
) {
  const creativeMode = context.creativeMode ?? "real";
  const showSocialProof = context.showSocialProof ?? true;
  const showRatingStrip = context.showRatingStrip ?? true;
  const showProductCallouts = context.showProductCallouts ?? false;
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
    "Create a square 1:1 Meta Ads image ad using the uploaded product photo as the main visual anchor.",
    "PRIMARY GOAL",
    "Design this creative for performance marketing, not just aesthetics.",
    "The ad must feel built to win attention fast, communicate value instantly, and drive clicks or conversions on mobile feeds.",
    "Optimize for direct response, scroll stopping power, clarity, urgency, and purchase intent.",
    "GENERATION MODE",
    ...modeInstructions[creativeMode],
    "MARKETING OBJECTIVE",
    "Build the ad around one dominant conversion message.",
    "The viewer should understand in under 2 seconds:",
    "1. what the product is",
    "2. why it matters",
    "3. why they should act now",
    "DIRECT RESPONSE PRINCIPLES",
    "Lead with the strongest benefit, not with decoration.",
    "Make the value proposition obvious at first glance.",
    "Prioritize outcome, relief, transformation, convenience, speed, savings, or desirability depending on the product.",
    "The ad should create a feeling of 'I want this' or 'I need this now.'",
    "Use visual and textual hierarchy to guide the eye from hook to benefit to CTA.",
    "Add subtle urgency and buying momentum, but keep it believable and premium.",
    "Make the composition feel like a high-performing paid social ad made for Meta feeds.",
    "VISUAL HOOK",
    "Create an immediate visual hook that stops scrolling.",
    "Possible hook styles: dramatic product focus, bold contrast, benefit-first headline block, clear before-and-after implication, premium close-up detail, or strong badge and offer emphasis.",
    "The hook must be obvious within the first second on mobile.",
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
    `Exact product name: ${context.name}.`,
    "The generated ad must stay faithful to the exact product shown in the uploaded image.",
    "Do not transform the product into a different model, package, shape, colorway, material, accessory set, flavor, scent, or category.",
    "If showing details, zooms, or alternate angles, they must belong to the exact same product from the uploaded image.",
    context.categoryName ? `Category context: ${context.categoryName}.` : "",
    context.description ? `Product context: ${context.description}.` : "",
    context.brief ? `Extra campaign note: ${context.brief}.` : "",
    `Creative angle: ${option.angle}.`,
    "MESSAGE HIERARCHY",
    "Add clean, premium, highly readable Spanish typography with only these approved text elements:",
    `Headline: ${option.headline}`,
    `Support line: ${option.supportLine}`,
    `CTA badge: ${option.cta}`,
    "TEXT RULES",
    "The headline is the main hook and must be the first thing read.",
    "The headline must be short, bold, aggressive in clarity, and instantly legible on mobile.",
    "The support line should reinforce the main promise with one concrete benefit or reason to believe.",
    "The CTA badge must feel actionable and high-intent.",
    "Every text element must support conversion, not just look nice.",
    "Avoid vague lifestyle copy, weak slogans, or generic brand language.",
    "BENEFIT EMPHASIS",
    "The creative must visually reinforce the core selling benefit.",
    "If relevant, make the benefit feel concrete, immediate, and emotionally desirable.",
    "Examples of strong benefit framing: saves time, looks premium, solves a problem, increases comfort, improves appearance, feels exclusive, offers better value, or makes life easier.",
    showProductCallouts ? "PRODUCT CALLOUTS" : "",
    showProductCallouts
      ? "Add 2 or 3 circular callout bubbles around the main product showing important details, materials, textures, components, finishes, or alternate angles of the same product."
      : "Do not add product detail callouts, inset circles, zoom bubbles, exploded detail frames, or alternate-angle cutouts around the product.",
    showProductCallouts
      ? "Each callout must be circular, clean, premium, and visually connected to the main product with thin elegant connector lines or subtle anchoring."
      : "",
    showProductCallouts
      ? "The callouts must show only real parts or believable alternate views of the same product, not a different item."
      : "",
    showProductCallouts
      ? "Each callout must include a short Spanish label naming the exact highlighted feature, part, finish, or material."
      : "",
    showProductCallouts
      ? "Use labels such as 'Textura premium', 'Detalle del empaque', 'Acabado metalico', 'Costura reforzada', or similar product-specific feature names."
      : "",
    showProductCallouts
      ? "Every callout label must be clearly readable, short, and directly tied to what is shown inside that same circle."
      : "",
    showProductCallouts
      ? "Do not use generic labels like 'Calidad', 'Bueno', 'Top', or vague claims that do not match the actual detail shown."
      : "",
    showProductCallouts
      ? "Use the callouts to highlight what helps conversion most: texture, finish, packaging detail, controls, material quality, fit, key component, or a useful close-up."
      : "",
    showProductCallouts
      ? "Keep every callout fully inside the canvas with comfortable margins and make sure they support the main composition instead of cluttering it."
      : "",
    showSocialProof ? "SOCIAL PROOF" : "",
    showSocialProof ? "Also include 2 or 3 small social proof bubbles using only these approved snippets:" : "",
    ...(showSocialProof
      ? option.socialProof.map(
          (item, index) => `Social proof ${index + 1}: ${item.name} - ${item.message}`,
        )
      : []),
    showSocialProof
      ? "Do not add any text outside the primary text block and these approved social proof snippets."
      : "Do not add any text outside the approved headline, support line, CTA, and any enabled rating strip.",
    showSocialProof ? "Social proof must feel persuasive and product-specific, not generic praise." : "",
    "Text readability is the top priority.",
    "Place the text inside a clean safe area that does not compete with the product.",
    "CRITICAL FRAMING RULE: Every text element, bubble, CTA, avatar, star row and badge must be fully visible inside the canvas. Nothing may be cropped by any image edge.",
    "Keep all overlays inside an inner safe frame with generous margins from every edge, as if there were a 7% padding around the whole canvas.",
    "Do not let any speech bubble, CTA, review strip, avatar circle or label touch, cross, bleed out of, or get clipped by the image borders.",
    "Use a strong dark or light overlay panel, gradient, ribbon, or blurred backdrop behind the text so it reads clearly at a glance.",
    "The headline must be large, bold, short, and instantly legible on mobile.",
    "The support line must be smaller than the headline but still clear and high contrast.",
    "The CTA badge must be solid, prominent, and easy to read.",
    "Avoid thin fonts, decorative scripts, low-contrast text, text directly over busy backgrounds, or text touching the edges.",
    "Leave generous padding around all text.",
    "Prefer one clear text block at the top or bottom of the ad.",
    showProductCallouts
      ? "Distribute the product callout circles around the product silhouette so they feel intentional and balanced, never random."
      : "",
    showProductCallouts
      ? "Do not let the product callouts collide with the headline, CTA, review bubbles, or rating strip."
      : "",
    showProductCallouts
      ? "The main product and all callout circles must match each other in design, materials, colors, and physical details."
      : "",
    showSocialProof
      ? "Build the social proof as 2 or 3 separate floating speech bubbles, not as one list, one panel, or one stacked review box."
      : "Do not add floating review bubbles, testimonial chat elements, customer avatars, or review cards.",
    showSocialProof
      ? "Each bubble must contain only: one small circular avatar, one customer name, and one short review message."
      : "",
    showSocialProof
      ? "Do not place stars, rating rows, counters, badges, icons, or extra labels inside the review bubbles."
      : "",
    showSocialProof
      ? "The bubbles should be rounded, premium, softly translucent, glassmorphism-style, with generous padding and a subtle speech-bubble tail or chat-balloon feel."
      : "",
    showSocialProof
      ? "Keep each bubble visually independent, with space between them, and avoid aligning them as a rigid table or review feed."
      : "",
    showSocialProof
      ? "If there is not enough room for 3 bubbles without clipping, use only 2 bubbles and keep them fully visible."
      : "",
    showRatingStrip ? "RATING STRIP" : "",
    showRatingStrip
      ? "Create a separate small rating strip outside the bubbles with the 5-star row and a compact customers counter like '+500 clientes satisfechos' or '+500 clientes felices'."
      : "Do not add star ratings, customer counters, rating strips, score labels, or trust badges based on stars.",
    showRatingStrip ? "The stars belong only in that separate rating strip, never inside the bubbles." : "",
    showRatingStrip ? "The rating strip and CTA must also remain fully inside the canvas with comfortable edge margins." : "",
    showSocialProof ? "Make the review messages clearly product-specific, not generic praise." : "",
    "COMPOSITION RULES",
    "Create strong separation between product, text, CTA, and social proof.",
    "The eye flow should naturally move: hook to product and value, then proof, then CTA.",
    showProductCallouts
      ? "If product callouts are enabled, the eye flow may also pass through one or two detail circles before the CTA, but the main product must still remain dominant."
      : "",
    "Avoid clutter, weak focal points, empty decorative elements, or confusing layouts.",
    "Do not add large paragraphs, fake chat screenshots, dense interface chrome, duplicate counters, or repeated star rows.",
    "Do not let the product overlap or hide the text.",
    "NEGATIVE INSTRUCTIONS",
    "Do not create a generic beauty poster or branding-only visual.",
    "Do not make it look like a flyer, brochure, collage, or low-quality Canva template.",
    "Do not use weak or ambiguous messaging.",
    "Do not make the ad feel passive, soft, or purely decorative.",
    "Do not sacrifice clarity for style.",
    "FINAL CREATIVE STANDARD",
    "Design it like a polished, premium, high-conversion Meta ad built for clicks, leads, or sales.",
    "It must be scroll-stopping, benefit-led, easy to understand instantly, and visibly optimized for performance marketing.",
  ]
    .filter(Boolean)
    .join("\n");
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
      const imageUrl = await saveCreativeImage(context.productId, base64Image, index);

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
