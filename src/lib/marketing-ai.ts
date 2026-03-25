import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  facebookAdsOutputSchema,
  formatFacebookAdsInputForPrompt,
  type FacebookAdsFormInput,
  type FacebookAdsOutput,
} from "@/lib/marketing";

const MARKETING_TEXT_MODEL = "gpt-4.1-mini";
const MARKETING_IMAGE_MODEL = "gpt-image-1";
const MARKETING_IMAGE_SIZE = "1024x1024";
const MARKETING_IMAGE_QUALITY = "medium";
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
        "El imagePrompt debe estar optimizado para un generador de imagenes publicitarias y debe estar escrito en espanol claro.",
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

export async function generateMarketingImage(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Falta configurar OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MARKETING_IMAGE_MODEL,
      prompt,
      size: MARKETING_IMAGE_SIZE,
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
