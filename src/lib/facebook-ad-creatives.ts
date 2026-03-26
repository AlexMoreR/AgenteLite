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
};

type CreativeCopyOption = {
  angle: string;
  headline: string;
  supportLine: string;
  cta: string;
};

type LoadedImageSource = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

export type FacebookAdCreative = CreativeCopyOption & {
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
    }),
  ).min(3),
});

const mimeByExt: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

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

function buildFallbackCreativeOptions(context: ProductCreativeContext): CreativeCopyOption[] {
  const shortName = clampWords(context.name, 4, 28) || "Producto premium";
  const descriptionSnippet = firstDescriptionSnippet(context.description);
  const briefSnippet = clampWords(context.brief || "", 6, 40);
  const supportBase =
    descriptionSnippet ||
    clampWords(`${shortName} para elevar tu negocio`, 7, 40);

  return [
    {
      angle: "Beneficio principal",
      headline: shortName,
      supportLine: supportBase,
      cta: "Compra hoy",
    },
    {
      angle: "Impulso comercial",
      headline: "Hazlo destacar",
      supportLine:
        briefSnippet ||
        clampWords(`${shortName} listo para vender mas`, 7, 40),
      cta: "Pide ahora",
    },
    {
      angle: "Imagen profesional",
      headline: "Impulsa tu negocio",
      supportLine: clampWords(`${shortName} con presencia premium`, 6, 38),
      cta: "Cotiza ya",
    },
  ];
}

function sanitizeCreativeOption(option: CreativeCopyOption, fallback: CreativeCopyOption) {
  return {
    angle: clampWords(option.angle || fallback.angle, 4, 40) || fallback.angle,
    headline:
      clampWords(option.headline || fallback.headline, 5, 30) || fallback.headline,
    supportLine:
      clampWords(option.supportLine || fallback.supportLine, 8, 44) ||
      fallback.supportLine,
    cta: clampWords(option.cta || fallback.cta, 3, 18) || fallback.cta,
  };
}

async function generateCreativeCopyOptions(
  context: ProductCreativeContext,
  apiKey: string,
): Promise<CreativeCopyOption[]> {
  const fallback = buildFallbackCreativeOptions(context);
  const prompt = [
    `Producto: ${context.name}`,
    context.categoryName ? `Categoria: ${context.categoryName}` : "",
    context.description ? `Descripcion: ${context.description}` : "",
    context.brief ? `Instrucciones extra: ${context.brief}` : "",
    "",
    "Devuelve solo JSON valido con esta estructura exacta:",
    '{"options":[{"angle":"...","headline":"...","supportLine":"...","cta":"..."}]}',
    "",
    "Reglas:",
    "- Entrega exactamente 3 opciones.",
    "- Todo en espanol neutro.",
    "- Sin markdown, sin comentarios, sin emojis y sin hashtags.",
    "- headline: maximo 5 palabras.",
    "- supportLine: maximo 8 palabras.",
    "- cta: maximo 3 palabras.",
    "- Cada opcion debe tener un enfoque distinto: beneficio, decision rapida y confianza.",
    "- El texto debe sentirse listo para ir dentro de una imagen cuadrada de Facebook Ads.",
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
        "Eres un director creativo experto en anuncios de Facebook Ads. Devuelve solo JSON valido.",
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

  return fallback.map((fallbackOption, index) =>
    sanitizeCreativeOption(parsed.options[index] ?? fallbackOption, fallbackOption),
  );
}

function getMimeTypeFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return mimeByExt[ext] ?? "image/png";
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

function buildCreativeImagePrompt(
  context: ProductCreativeContext,
  option: CreativeCopyOption,
) {
  return [
    "Create a square 1:1 Facebook Ads creative using the uploaded product photo as the main subject.",
    "This must be an edit of the provided image, not a redesign from scratch.",
    "Preserve the same product identity, silhouette, materials, color and proportions.",
    "Only improve the photo slightly with cleaner lighting, subtle contrast improvement, better framing and a polished ad-ready composition.",
    "Do not replace the product. Do not invent a different item. Do not add extra products, people, hands, logos or watermarks.",
    "Keep the original product dominant and clearly recognizable.",
    context.categoryName ? `Category context: ${context.categoryName}.` : "",
    context.description ? `Product context: ${context.description}.` : "",
    context.brief ? `Extra campaign note: ${context.brief}.` : "",
    `Creative angle: ${option.angle}.`,
    "Add clean, premium, highly readable Spanish typography with only these three text elements:",
    `Headline: ${option.headline}`,
    `Support line: ${option.supportLine}`,
    `CTA badge: ${option.cta}`,
    "Do not add any other text.",
    "Text readability is the top priority.",
    "Place the text inside a clean safe area that does not compete with the product.",
    "Use a strong dark or light overlay panel, gradient, ribbon, or blurred backdrop behind the text so it reads clearly at a glance.",
    "The headline must be large, bold, short, and instantly legible on mobile.",
    "The support line must be smaller than the headline but still clear and high contrast.",
    "The CTA badge must be solid, prominent, and easy to read.",
    "Avoid thin fonts, decorative scripts, low-contrast text, text directly over busy backgrounds, or text touching the edges.",
    "Leave generous padding around all text.",
    "Prefer one clear text block at the top or bottom of the ad.",
    "Do not let the product overlap or hide the text.",
    "Design it like a polished, high-conversion paid social ad with excellent hierarchy and readability.",
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
      [
        Uint8Array.from(imageSource.bytes),
      ],
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
    data?: Array<{
      b64_json?: string;
    }>;
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

export async function generateFacebookAdCreativesForProduct(
  context: ProductCreativeContext,
  apiKey: string,
): Promise<FacebookAdCreative[]> {
  const imageSource = await loadImageSource(context.sourceImageUrl);
  let creativeOptions = buildFallbackCreativeOptions(context);

  try {
    creativeOptions = await generateCreativeCopyOptions(context, apiKey);
  } catch (error) {
    console.warn("[FACEBOOK_AD_CREATIVE_COPY_FALLBACK]", error);
  }

  const creatives: FacebookAdCreative[] = [];

  for (const [index, option] of creativeOptions.entries()) {
    const prompt = buildCreativeImagePrompt(context, option);
    const base64Image = await requestCreativeImageEdit(imageSource, prompt, apiKey);
    const imageUrl = await saveCreativeImage(context.productId, base64Image, index);

    creatives.push({
      id: randomUUID(),
      angle: option.angle,
      headline: option.headline,
      supportLine: option.supportLine,
      cta: option.cta,
      imageUrl,
    });
  }

  return creatives;
}
