import { z } from "zod";
import type { AdProductInput } from "../types/ad-input";

type OpenAIResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

const objectiveSchema = z.enum(["traffic", "sales", "leads", "engagement"]);
const toneSchema = z.enum(["direct", "persuasive", "premium", "friendly"]);

const copyVariantSchema = z.object({
  id: z.string().trim().min(1).optional(),
  primaryText: z.string().trim().min(1),
  headline: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

const adsGeneratorAiBundleSchema = z.object({
  summary: z.string().trim().min(1).optional(),
  analysis: z
    .object({
      categoryName: z.string().trim().min(1).optional(),
      mainOffer: z.string().trim().min(1).optional(),
      benefits: z.array(z.string().trim().min(1)).max(6).optional(),
      primaryBenefit: z.string().trim().min(1).optional(),
      supportingBenefits: z.array(z.string().trim().min(1)).max(3).optional(),
      primaryPainPoint: z.string().trim().min(1).nullable().optional(),
      recommendedObjective: objectiveSchema.optional(),
      audience: z.string().trim().min(1).optional(),
      confidenceSignals: z.array(z.string().trim().min(1)).max(5).optional(),
      tone: toneSchema.optional(),
      strategicSummary: z.string().trim().min(1).optional(),
      recommendedFormat: z.string().trim().min(1).optional(),
      campaignStructure: z.string().trim().min(1).optional(),
      basicSegmentation: z.array(z.string().trim().min(1)).max(6).optional(),
      creativeIdea: z.string().trim().min(1).optional(),
      budgetRecommendation: z.string().trim().min(1).optional(),
      primaryMetric: z.string().trim().min(1).optional(),
      publicationChecklist: z.array(z.string().trim().min(1)).max(8).optional(),
    })
    .optional(),
  strategy: z
    .object({
      angle: z.string().trim().min(1).optional(),
      audience: z.string().trim().min(1).optional(),
      hooks: z.array(z.string().trim().min(1)).max(4).optional(),
      callToAction: z.string().trim().min(1).optional(),
    })
    .optional(),
  copies: z.array(copyVariantSchema).min(1).max(3).optional(),
});

export type AdsGeneratorAiBundle = z.infer<typeof adsGeneratorAiBundleSchema>;

function extractOpenAIText(data: OpenAIResponsesApiResponse) {
  if (data.output_text?.trim()) {
    return data.output_text.trim();
  }

  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text?.trim() || "")
      .find(Boolean) || ""
  );
}

function stripCodeFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject(value: string) {
  const normalized = stripCodeFences(value);
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function compactList(items: Array<string | undefined | null>) {
  return items.map((item) => item?.trim() || "").filter(Boolean);
}

function buildPrompt(input: AdProductInput) {
  return [
    "Genera una estrategia y copies para Meta Ads Manager.",
    "Devuelve solo JSON valido, sin markdown y sin explicaciones fuera del JSON.",
    "Escribe en espanol neutro, comercial, concreto y creible.",
    "No inventes datos no dados por el usuario.",
    "Los copies deben sonar humanos y listos para publicar.",
    "Maximo 3 variantes de copy.",
    "",
    "Entrada:",
    JSON.stringify(
      {
        productName: input.productName,
        productDescription: input.productDescription,
        brandName: input.brandName ?? null,
        categoryName: input.categoryName ?? null,
        price: input.price ?? null,
        currency: input.currency ?? null,
        landingPageUrl: input.landingPageUrl ?? null,
        objective: input.objective ?? null,
        audienceSummary: input.audienceSummary ?? null,
        tone: input.tone ?? null,
        keyBenefits: compactList(input.keyBenefits),
        painPoints: compactList(input.painPoints ?? []),
        callToAction: input.callToAction ?? null,
        imageAvailable: Boolean(input.image?.url),
      },
      null,
      2,
    ),
    "",
    "Respuesta JSON esperada:",
    JSON.stringify(
      {
        summary: "string",
        analysis: {
          categoryName: "string",
          mainOffer: "string",
          benefits: ["string"],
          primaryBenefit: "string",
          supportingBenefits: ["string"],
          primaryPainPoint: "string | null",
          recommendedObjective: "traffic | sales | leads | engagement",
          audience: "string",
          confidenceSignals: ["string"],
          tone: "direct | persuasive | premium | friendly",
          strategicSummary: "string",
          recommendedFormat: "string",
          campaignStructure: "string",
          basicSegmentation: ["string"],
          creativeIdea: "string",
          budgetRecommendation: "string",
          primaryMetric: "string",
          publicationChecklist: ["string"],
        },
        strategy: {
          angle: "string",
          audience: "string",
          hooks: ["string"],
          callToAction: "string",
        },
        copies: [
          {
            id: "dolor-problema",
            primaryText: "string",
            headline: "string",
            description: "string",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

async function generateWithOpenAI(prompt: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      instructions:
        "Eres un estratega y copywriter senior de Meta Ads para pequenos negocios. Respondes siempre con JSON valido.",
      input: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_output_tokens: 1800,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as OpenAIResponsesApiResponse;
  return extractOpenAIText(data);
}

async function generateWithGemini(prompt: string, apiKey: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "Eres un estratega y copywriter senior de Meta Ads para pequenos negocios. Respondes siempre con JSON valido.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Gemini ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  return (
    data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() || "").find(Boolean) || ""
  );
}

function normalizeBundle(bundle: AdsGeneratorAiBundle): AdsGeneratorAiBundle {
  return {
    ...bundle,
    copies: bundle.copies?.slice(0, 3),
    strategy: bundle.strategy
      ? {
          ...bundle.strategy,
          hooks: bundle.strategy.hooks?.slice(0, 4),
        }
      : undefined,
  };
}

export async function generateAdsGeneratorAiBundle(
  input: AdProductInput,
): Promise<AdsGeneratorAiBundle | null> {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!openAiApiKey && !geminiApiKey) {
    return null;
  }

  const prompt = buildPrompt(input);
  const attempts: Array<() => Promise<string>> = [];

  if (openAiApiKey) {
    attempts.push(() => generateWithOpenAI(prompt, openAiApiKey));
  }

  if (geminiApiKey) {
    attempts.push(() => generateWithGemini(prompt, geminiApiKey));
  }

  for (const attempt of attempts) {
    try {
      const raw = await attempt();
      const parsed = parseJsonObject(raw);
      const validated = adsGeneratorAiBundleSchema.safeParse(parsed);

      if (validated.success) {
        return normalizeBundle(validated.data);
      }
    } catch {
      // Keep fallback heuristics available if AI is unavailable or malformed.
    }
  }

  return null;
}
