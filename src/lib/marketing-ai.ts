import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  facebookAdsOutputSchema,
  facebookAdsTemplateOptions,
  formatFacebookAdsInputForPrompt,
  getImageSizeForAspectRatio,
  type FacebookAdsAspectRatio,
  type FacebookAdsFormInput,
  type FacebookAdsOutput,
} from "@/lib/marketing";

const MARKETING_TEXT_MODEL = "gpt-4.1-mini";
const MARKETING_IMAGE_MODEL = "gpt-image-1.5";
const MARKETING_IMAGE_QUALITY = "high";
const MARKETING_IMAGE_FORMAT = "png";

type RgbColor = {
  r: number;
  g: number;
  b: number;
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

type OpenAIImageGenerationResponse = {
  data?: Array<{
    b64_json?: string;
  }>;
};

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

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

export function getMarketingAiDefaults() {
  return {
    provider: "OPENAI" as const,
    model: MARKETING_TEXT_MODEL,
    imageModel: MARKETING_IMAGE_MODEL,
  };
}

export async function generateFacebookAdsCopy(args: {
  workspaceName: string;
  input: FacebookAdsFormInput;
}): Promise<FacebookAdsOutput> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Falta configurar OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MARKETING_TEXT_MODEL,
      instructions: [
        "Eres un director creativo senior especializado en Facebook Ads para negocios hispanohablantes.",
        "Responde exclusivamente con JSON valido usando el esquema solicitado.",
        "Escribe copy persuasivo, claro y listo para campanas reales.",
        "Debes elegir la mejor propuesta unica para vender el producto indicado por el cliente.",
        "No entregues multiples variantes ni alternativas.",
        "No uses emojis a menos que el tono realmente lo sugiera.",
        "Manten un headline corto, especifico y poco generico.",
        "Evita frases vacias como 'aprovecha esta oferta' o 'lo mejor para ti' salvo que el contexto las justifique con detalle.",
        "El texto principal debe conectar problema, beneficio, diferenciador y CTA sin sonar repetitivo.",
        "Si la oferta o el diferenciador son concretos, usalos de forma visible en el copy.",
        "El headline debe tener maximo 7 palabras.",
        "La descripcion debe tener maximo 16 palabras.",
        "El CTA sugerido debe tener entre 2 y 4 palabras.",
        "El imagePrompt debe describir una pieza publicitaria real, no una simple foto de catalogo.",
        "El imagePrompt debe indicar composicion comercial, profundidad, iluminacion, escenario, enfoque visual y espacio util para anuncio.",
        "El imagePrompt debe conservar el producto como protagonista absoluto y evitar deformarlo.",
        "El imagePrompt debe estar escrito en espanol claro y ser muy especifico.",
        "El imagePrompt debe respetar la plantilla de marketing, el estilo visual, el ADN visual y la regla de incluir o no texto.",
      ].join("\n"),
      input: formatFacebookAdsInputForPrompt(args.workspaceName, args.input),
      text: {
        format: {
          type: "json_schema",
          name: "facebook_ads_creative_bundle",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              primaryText: { type: "string" },
              headline: { type: "string" },
              description: { type: "string" },
              suggestedCallToAction: { type: "string" },
              imagePrompt: { type: "string" },
            },
            required: [
              "primaryText",
              "headline",
              "description",
              "suggestedCallToAction",
              "imagePrompt",
            ],
          },
        },
      },
      store: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI copy ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as OpenAIResponsesApiResponse;
  const rawText = extractOpenAIText(data);
  if (!rawText) {
    throw new Error("OpenAI no devolvio copy util");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error("OpenAI devolvio un formato de copy invalido");
  }

  const parsed = facebookAdsOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("OpenAI devolvio una estructura de copy incompleta");
  }

  return parsed.data;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorToCss(color: RgbColor) {
  return `rgb(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)})`;
}

function mixColor(base: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    r: clampColorChannel(base.r + (target.r - base.r) * amount),
    g: clampColorChannel(base.g + (target.g - base.g) * amount),
    b: clampColorChannel(base.b + (target.b - base.b) * amount),
  };
}

function withAlpha(color: RgbColor, alpha: number) {
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${alpha})`;
}

async function extractMarketingPalette(sourceBuffer: Buffer) {
  const stats = await sharp(sourceBuffer).resize(48, 48, { fit: "inside" }).stats();
  const [red, green, blue] = stats.channels;
  const average = {
    r: red?.mean ?? 110,
    g: green?.mean ?? 94,
    b: blue?.mean ?? 88,
  };

  const darkBase = mixColor(average, { r: 17, g: 21, b: 28 }, 0.72);
  const richBase = mixColor(average, { r: 78, g: 42, b: 31 }, 0.42);

  return {
    backgroundStart: darkBase,
    backgroundEnd: mixColor(darkBase, { r: 8, g: 10, b: 15 }, 0.38),
    panel: withAlpha(mixColor(darkBase, { r: 255, g: 255, b: 255 }, 0.06), 0.88),
    panelStroke: withAlpha(mixColor(average, { r: 255, g: 255, b: 255 }, 0.35), 0.22),
    accent: mixColor(richBase, { r: 255, g: 210, b: 164 }, 0.56),
    accentSoft: withAlpha(mixColor(richBase, { r: 255, g: 230, b: 205 }, 0.68), 0.22),
    textStrong: { r: 250, g: 240, b: 228 },
    textMuted: { r: 235, g: 223, b: 208 },
    heroGlow: withAlpha(mixColor(average, { r: 255, g: 224, b: 194 }, 0.55), 0.26),
  };
}

function wrapSvgText(text: string, maxCharsPerLine: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 4);
}

function clampCopyLength(text: string, maxLength: number) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
}

function getCanvasForAspectRatio(aspectRatio: FacebookAdsAspectRatio) {
  if (aspectRatio === "9:16") {
    return { width: 1080, height: 1920 };
  }

  if (aspectRatio === "16:9") {
    return { width: 1600, height: 900 };
  }

  return { width: 1080, height: 1080 };
}

function getReferenceLayout(aspectRatio: FacebookAdsAspectRatio) {
  if (aspectRatio === "16:9") {
    return {
      imageRect: { x: 460, y: 60, width: 1080, height: 780 },
      contentX: 84,
      contentWidth: 330,
      headlineY: 132,
      headlineLineHeight: 84,
      headlineMaxChars: 14,
      descriptionY: 472,
      descriptionLineHeight: 50,
      descriptionMaxChars: 22,
      ctaWidth: 270,
      ctaHeight: 74,
      ctaX: 1200,
      ctaY: 748,
      badgeX: 84,
      badgeY: 62,
    };
  }

  if (aspectRatio === "9:16") {
    return {
      imageRect: { x: 68, y: 590, width: 944, height: 1190 },
      contentX: 74,
      contentWidth: 760,
      headlineY: 178,
      headlineLineHeight: 96,
      headlineMaxChars: 16,
      descriptionY: 430,
      descriptionLineHeight: 54,
      descriptionMaxChars: 26,
      ctaWidth: 330,
      ctaHeight: 88,
      ctaX: 676,
      ctaY: 1692,
      badgeX: 74,
      badgeY: 88,
    };
  }

  return {
    imageRect: { x: 64, y: 356, width: 952, height: 660 },
    contentX: 72,
    contentWidth: 760,
    headlineY: 154,
    headlineLineHeight: 84,
    headlineMaxChars: 18,
    descriptionY: 264,
    descriptionLineHeight: 48,
    descriptionMaxChars: 26,
    ctaWidth: 310,
    ctaHeight: 80,
    ctaX: 706,
    ctaY: 914,
    badgeX: 72,
    badgeY: 74,
  };
}

function getTemplateKicker(input: FacebookAdsFormInput) {
  const offer = clampCopyLength(input.offerDetails, 36);
  const differentiator = clampCopyLength(input.differentiator, 36);

  if (input.marketingTemplate === "offer") {
    return offer || "Oferta activa";
  }

  if (input.marketingTemplate === "benefits") {
    return differentiator || "Beneficio principal";
  }

  if (input.marketingTemplate === "cta") {
    return clampCopyLength(input.callToAction, 28) || "Accion inmediata";
  }

  return differentiator || input.productName;
}

async function composeMarketingImageFromBuffer(args: {
  input: FacebookAdsFormInput;
  output: FacebookAdsOutput;
  aspectRatio: FacebookAdsAspectRatio;
  sourceBuffer: Buffer;
}): Promise<{ base64: string; mimeType: string }> {
  const canvas = getCanvasForAspectRatio(args.aspectRatio);
  const layout = getReferenceLayout(args.aspectRatio);
  const palette = await extractMarketingPalette(args.sourceBuffer);
  const headline = clampCopyLength(args.output.headline, 54);
  const description = clampCopyLength(args.output.description, 82);
  const ctaLabel = clampCopyLength(args.output.suggestedCallToAction || args.input.callToAction, 24);
  const kicker = clampCopyLength(getTemplateKicker(args.input), 34).toUpperCase();
  const headlineLines = wrapSvgText(headline, layout.headlineMaxChars);
  const descriptionLines = wrapSvgText(description, layout.descriptionMaxChars);
  const ctaText = escapeSvgText(ctaLabel);
  const shouldRenderText = args.input.includeText;
  const contentPanelWidth =
    args.aspectRatio === "16:9" ? 368 : args.aspectRatio === "9:16" ? 820 : 860;
  const contentPanelHeight =
    args.aspectRatio === "16:9" ? 690 : args.aspectRatio === "9:16" ? 430 : 250;
  const contentPanelX = layout.contentX - 28;
  const contentPanelY = args.aspectRatio === "16:9" ? 74 : args.aspectRatio === "9:16" ? 98 : 102;
  const heroCardInset = args.aspectRatio === "9:16" ? 52 : 44;
  const heroInnerWidth = layout.imageRect.width - heroCardInset * 2;
  const heroInnerHeight = layout.imageRect.height - heroCardInset * 2;

  const headlineSvg = shouldRenderText
    ? headlineLines
        .map(
          (line, index) =>
            `<text x="${layout.contentX}" y="${layout.headlineY + index * layout.headlineLineHeight}" fill="${colorToCss(palette.textStrong)}" font-size="68" font-weight="800" font-family="Poppins, Arial, sans-serif" filter="url(#headlineShadow)">${escapeSvgText(line)}</text>`,
        )
        .join("")
    : "";

  const descriptionSvg = shouldRenderText
    ? descriptionLines
        .map(
          (line, index) =>
            `<text x="${layout.contentX}" y="${layout.descriptionY + index * layout.descriptionLineHeight}" fill="${colorToCss(palette.textMuted)}" font-size="32" font-weight="700" font-family="Poppins, Arial, sans-serif" filter="url(#copyShadow)">${escapeSvgText(line)}</text>`,
        )
        .join("")
    : "";

  const badgeText = escapeSvgText(kicker);
  const badgeSvg = shouldRenderText
    ? `
      <rect x="${layout.badgeX}" y="${layout.badgeY}" rx="18" ry="18" width="${Math.min(layout.contentWidth, 330)}" height="48" fill="${palette.accentSoft}" stroke="${withAlpha(palette.textStrong, 0.14)}" />
      <text x="${layout.badgeX + 24}" y="${layout.badgeY + 31}" fill="${colorToCss(palette.textStrong)}" font-size="20" font-weight="800" font-family="Poppins, Arial, sans-serif" letter-spacing="1.4">${badgeText}</text>
    `
    : "";

  const ctaSvg = shouldRenderText
    ? `
      <rect x="${layout.ctaX}" y="${layout.ctaY}" rx="20" ry="20" width="${layout.ctaWidth}" height="${layout.ctaHeight}" fill="rgba(17,17,17,0.88)" />
      <rect x="${layout.ctaX}" y="${layout.ctaY}" rx="20" ry="20" width="${layout.ctaWidth}" height="${layout.ctaHeight}" fill="${colorToCss(palette.accent)}" />
      <text x="${layout.ctaX + layout.ctaWidth / 2}" y="${layout.ctaY + layout.ctaHeight / 2 + 11}" text-anchor="middle" fill="rgb(28, 21, 18)" font-size="28" font-weight="800" font-family="Poppins, Arial, sans-serif">${ctaText}</text>
    `
    : "";

  const overlaySvg = `
    <svg width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="marketingShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colorToCss(palette.backgroundStart)}" />
          <stop offset="100%" stop-color="${colorToCss(palette.backgroundEnd)}" />
        </linearGradient>
        <radialGradient id="pageGlow" cx="78%" cy="30%" r="55%">
          <stop offset="0%" stop-color="${palette.heroGlow}" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id="heroGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${withAlpha(palette.accent, 0.22)}" />
          <stop offset="100%" stop-color="rgba(244, 213, 170, 0)" />
        </linearGradient>
        <linearGradient id="heroVignette" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.26)" />
        </linearGradient>
        <filter id="headlineShadow">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="rgba(0,0,0,0.38)" />
        </filter>
        <filter id="copyShadow">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="rgba(0,0,0,0.28)" />
        </filter>
      </defs>
      <rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="url(#marketingShade)" />
      <rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="url(#pageGlow)" />
      <rect x="${contentPanelX}" y="${contentPanelY}" width="${contentPanelWidth}" height="${contentPanelHeight}" rx="34" ry="34" fill="${palette.panel}" stroke="${palette.panelStroke}" />
      <rect x="${layout.imageRect.x}" y="${layout.imageRect.y}" width="${layout.imageRect.width}" height="${layout.imageRect.height}" rx="30" ry="30" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" />
      <rect x="${layout.imageRect.x + 1}" y="${layout.imageRect.y + 1}" width="${layout.imageRect.width - 2}" height="${layout.imageRect.height - 2}" rx="29" ry="29" fill="url(#heroGlow)" />
      <rect x="${layout.imageRect.x + heroCardInset}" y="${layout.imageRect.y + heroCardInset}" width="${heroInnerWidth}" height="${heroInnerHeight}" rx="26" ry="26" fill="url(#heroVignette)" />
      ${badgeSvg}
      ${headlineSvg}
      ${descriptionSvg}
      ${ctaSvg}
    </svg>
  `;

  const background = await sharp(args.sourceBuffer)
    .resize(canvas.width, canvas.height, { fit: "cover", position: "centre" })
    .blur(18)
    .modulate({ brightness: 0.48, saturation: 0.92 })
    .toBuffer();

  const heroBackdrop = await sharp(args.sourceBuffer)
    .resize(layout.imageRect.width, layout.imageRect.height, {
      fit: "cover",
      position: "attention",
    })
    .blur(8)
    .modulate({ brightness: 0.68, saturation: 0.92 })
    .png()
    .toBuffer();

  const heroFocus = await sharp(args.sourceBuffer)
    .resize(heroInnerWidth, heroInnerHeight, {
      fit: "cover",
      position: "attention",
    })
    .modulate({ brightness: 1.08, saturation: 1.08 })
    .normalise()
    .sharpen({ sigma: 1.35 })
    .composite([
      {
        input: Buffer.from(`
          <svg width="${heroInnerWidth}" height="${heroInnerHeight}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="heroDepth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(255,255,255,0.06)" />
                <stop offset="100%" stop-color="rgba(0,0,0,0.24)" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="${heroInnerWidth}" height="${heroInnerHeight}" fill="url(#heroDepth)" />
          </svg>
        `),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const heroShadow = await sharp({
    create: {
      width: layout.imageRect.width,
      height: layout.imageRect.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="${layout.imageRect.width}" height="${layout.imageRect.height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="18" y="24" width="${layout.imageRect.width - 36}" height="${layout.imageRect.height - 36}" rx="30" ry="30" fill="rgba(0,0,0,0.32)" />
          </svg>
        `),
        top: 0,
        left: 0,
      },
    ])
    .blur(20)
    .png()
    .toBuffer();

  const heroFrame = await sharp(heroBackdrop)
    .resize(layout.imageRect.width, layout.imageRect.height, {
      fit: "cover",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .composite([
      {
        input: heroFocus,
        top: heroCardInset,
        left: heroCardInset,
      },
      {
        input: Buffer.from(`
          <svg width="${layout.imageRect.width}" height="${layout.imageRect.height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="1.5" width="${layout.imageRect.width - 3}" height="${layout.imageRect.height - 3}" rx="28" ry="28" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="3" />
            <rect x="${heroCardInset}" y="${heroCardInset}" width="${heroInnerWidth}" height="${heroInnerHeight}" rx="26" ry="26" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
          </svg>
        `),
        top: 0,
        left: 0,
      },
    ])
    .toBuffer();

  const outputBuffer = await sharp(background)
    .composite([
      { input: heroShadow, top: layout.imageRect.y + 14, left: layout.imageRect.x },
      { input: heroFrame, top: layout.imageRect.y, left: layout.imageRect.x },
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  return {
    base64: outputBuffer.toString("base64"),
    mimeType: "image/png",
  };
}

async function enhanceMarketingReferenceImage(args: {
  sourceBuffer: Buffer;
  aspectRatio: FacebookAdsAspectRatio;
}): Promise<Buffer> {
  const canvas = getCanvasForAspectRatio(args.aspectRatio);
  const base = sharp(args.sourceBuffer).rotate();
  const metadata = await base.metadata();
  const sourceWidth = metadata.width ?? canvas.width;
  const sourceHeight = metadata.height ?? canvas.height;
  const focusTop =
    sourceWidth > sourceHeight ? Math.max(0, Math.floor(sourceHeight * 0.12)) : Math.max(0, Math.floor(sourceHeight * 0.06));
  const focusHeight = Math.max(1, sourceHeight - focusTop);

  return base
    .extract({
      left: 0,
      top: focusTop,
      width: sourceWidth,
      height: focusHeight,
    })
    .resize(canvas.width, canvas.height, {
      fit: "cover",
      position: "attention",
    })
    .normalise()
    .modulate({ brightness: 1.04, saturation: 1.08 })
    .sharpen({ sigma: 1.15, m1: 0.8, m2: 2.2 })
    .linear(1.03, -4)
    .png()
    .toBuffer();
}

function buildMarketingAdImagePrompt(args: {
  basePrompt: string;
  input: FacebookAdsFormInput;
}) {
  const templateInstruction =
    facebookAdsTemplateOptions.find((option) => option.value === args.input.marketingTemplate)?.description ??
    "Composicion publicitaria profesional y equilibrada.";
  const formatGuidance =
    args.input.aspectRatio === "9:16"
      ? "Composicion vertical tipo story, con jerarquia clara y mucho impacto visual."
      : args.input.aspectRatio === "16:9"
        ? "Composicion horizontal tipo anuncio de Facebook, con aire visual para titular y CTA."
        : "Composicion cuadrada equilibrada tipo post publicitario de Instagram.";
  const textRule = args.input.includeText
    ? "Incluye textos breves dentro de la imagen, en espanol, con estilo publicitario premium y jerarquia clara."
    : "No incluyas texto, letras, numeros ni logotipos dentro de la imagen; dejala limpia para edicion posterior.";

  return [
    "Crea una pieza publicitaria premium para Facebook Ads usando la imagen del producto como referencia principal.",
    "El producto debe mantenerse fiel al original en forma, estructura, proporciones, color y materiales.",
    "No conviertas la pieza en una foto de catalogo aislada sobre fondo blanco.",
    "Transforma la imagen en un anuncio visualmente vendedor, con direccion de arte comercial y sensacion aspiracional.",
    "Ubica el producto en una escena creible y elegante relacionada con su uso real.",
    "Usa iluminacion cinematografica o publicitaria, sombras limpias, profundidad y un fondo trabajado.",
    "Haz que el producto sea el protagonista absoluto del anuncio.",
    `Plantilla de marketing: ${args.input.marketingTemplate}. ${templateInstruction}`,
    `Estilo visual principal: ${args.input.visualStyle}.`,
    `ADN visual o contexto global: ${args.input.globalVisualContext}.`,
    textRule,
    formatGuidance,
    `Producto: ${args.input.productName}.`,
    `Descripcion: ${args.input.productDescription}.`,
    `Publico: ${args.input.targetAudience}.`,
    `Objetivo: ${args.input.campaignObjective}.`,
    `Tono: ${args.input.tone}.`,
    `Oferta: ${args.input.offerDetails}.`,
    `Diferenciador: ${args.input.differentiator}.`,
    `CTA: ${args.input.callToAction}.`,
    `Direccion visual deseada: ${args.input.visualDirection}.`,
    `Concepto creativo base: ${args.basePrompt}`,
  ].join(" ");
}

export async function generateMarketingImage(args: {
  prompt: string;
  aspectRatio: FacebookAdsAspectRatio;
  input: FacebookAdsFormInput;
  output: FacebookAdsOutput;
  referenceImage?: File | null;
}): Promise<{ base64: string; mimeType: string }> {
  if (args.referenceImage) {
    const sourceBuffer = Buffer.from(await args.referenceImage.arrayBuffer());
    const enhancedBuffer = await enhanceMarketingReferenceImage({
      sourceBuffer,
      aspectRatio: args.aspectRatio,
    });

    return composeMarketingImageFromBuffer({
      input: args.input,
      output: args.output,
      aspectRatio: args.aspectRatio,
      sourceBuffer: enhancedBuffer,
    });
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Falta configurar OPENAI_API_KEY");
  }

  const size = getImageSizeForAspectRatio(args.aspectRatio);
  const finalPrompt = buildMarketingAdImagePrompt({
    basePrompt: args.prompt,
    input: args.input,
  });
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MARKETING_IMAGE_MODEL,
      prompt: finalPrompt,
      size,
      quality: MARKETING_IMAGE_QUALITY,
      output_format: MARKETING_IMAGE_FORMAT,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI image ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as OpenAIImageGenerationResponse;
  const base64 = data.data?.[0]?.b64_json?.trim() || "";
  if (!base64) {
    throw new Error("OpenAI no devolvio la imagen generada");
  }

  return {
    base64,
    mimeType: "image/png",
  };
}

export async function saveGeneratedMarketingImage(args: {
  base64: string;
  workspaceSlug: string;
}): Promise<string> {
  const uploadDir = path.join(process.cwd(), "public", "uploads", "marketing-ia", args.workspaceSlug);
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID()}.png`;
  const filePath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(args.base64, "base64");

  await writeFile(filePath, buffer);

  return `/uploads/marketing-ia/${args.workspaceSlug}/${fileName}`;
}

export async function saveMarketingReferenceImage(args: {
  file: File;
  workspaceSlug: string;
}): Promise<string> {
  if (!args.file.type.startsWith("image/")) {
    throw new Error("Solo se permiten imagenes de producto");
  }

  if (args.file.size <= 0) {
    throw new Error("La imagen del producto esta vacia");
  }

  if (args.file.size > 5 * 1024 * 1024) {
    throw new Error("La imagen del producto debe pesar maximo 5MB");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "marketing-ia", args.workspaceSlug, "sources");
  await mkdir(uploadDir, { recursive: true });

  const ext = path.extname(args.file.name)?.toLowerCase() || ".png";
  const safeExt = ext.length <= 8 ? ext : ".png";
  const fileName = `${Date.now()}-${randomUUID()}${safeExt}`;
  const filePath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(await args.file.arrayBuffer());

  await writeFile(filePath, buffer);

  return `/uploads/marketing-ia/${args.workspaceSlug}/sources/${fileName}`;
}
