import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  facebookAdsOutputSchema,
  formatFacebookAdsInputForPrompt,
  getImageSizeForAspectRatio,
  type FacebookAdsAspectRatio,
  type FacebookAdsFormInput,
  type FacebookAdsOutput,
} from "@/lib/marketing";

const MARKETING_TEXT_MODEL = "gpt-4.1-mini";
const MARKETING_IMAGE_MODEL = "gpt-image-1";
const MARKETING_IMAGE_QUALITY = "high";
const MARKETING_IMAGE_FORMAT = "png";

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
        "No uses emojis a menos que el tono realmente lo sugiera.",
        "Manten headlines cortos y descriptions compactas.",
        "El imagePrompt debe describir una pieza publicitaria real, no una simple foto de catalogo.",
        "El imagePrompt debe indicar composicion comercial, profundidad, iluminacion, escenario, enfoque visual y espacio util para anuncio.",
        "El imagePrompt debe conservar el producto como protagonista absoluto y evitar deformarlo.",
        "El imagePrompt debe estar escrito en espanol claro y ser muy especifico.",
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
              primaryTexts: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3,
              },
              headlines: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3,
              },
              descriptions: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3,
              },
              suggestedCallToAction: { type: "string" },
              imagePrompt: { type: "string" },
            },
            required: [
              "primaryTexts",
              "headlines",
              "descriptions",
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

function buildMarketingAdImagePrompt(args: {
  basePrompt: string;
  input: FacebookAdsFormInput;
}) {
  const formatGuidance =
    args.input.aspectRatio === "9:16"
      ? "Composicion vertical tipo story, con jerarquia clara y mucho impacto visual."
      : args.input.aspectRatio === "16:9"
        ? "Composicion horizontal tipo anuncio de Facebook, con aire visual para titular y CTA."
        : "Composicion cuadrada equilibrada tipo post publicitario de Instagram.";

  return [
    "Crea una pieza publicitaria premium para Facebook Ads usando la imagen del producto como referencia principal.",
    "El producto debe mantenerse fiel al original en forma, estructura, proporciones, color y materiales.",
    "No conviertas la pieza en una foto de catalogo aislada sobre fondo blanco.",
    "Transforma la imagen en un anuncio visualmente vendedor, con direccion de arte comercial y sensacion aspiracional.",
    "Ubica el producto en una escena creible y elegante relacionada con su uso real.",
    "Usa iluminacion cinematografica o publicitaria, sombras limpias, profundidad y un fondo trabajado.",
    "Haz que el producto sea el protagonista absoluto del anuncio.",
    "Evita texto excesivo dentro de la imagen; si aparece, debe sentirse propio de un anuncio premium.",
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
  referenceImage?: File | null;
}): Promise<{ base64: string; mimeType: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Falta configurar OPENAI_API_KEY");
  }

  const size = getImageSizeForAspectRatio(args.aspectRatio);
  const finalPrompt = buildMarketingAdImagePrompt({
    basePrompt: args.prompt,
    input: args.input,
  });
  const response = args.referenceImage
    ? await (async () => {
        const payload = new FormData();
        payload.append("model", MARKETING_IMAGE_MODEL);
        payload.append("prompt", finalPrompt);
        payload.append("size", size);
        payload.append("quality", MARKETING_IMAGE_QUALITY);
        payload.append("output_format", MARKETING_IMAGE_FORMAT);
        payload.append("image", args.referenceImage as Blob);

        return fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: payload,
          cache: "no-store",
        });
      })()
    : await fetch("https://api.openai.com/v1/images/generations", {
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
