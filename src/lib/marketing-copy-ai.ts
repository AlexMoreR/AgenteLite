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

export type MarketingImprovementField = "whatSells" | "idealCustomer" | "painPoints";

type ImproveMarketingFieldInput = {
  field: MarketingImprovementField;
  businessName?: string;
  value: string;
  whatSells?: string;
  idealCustomer?: string;
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

function normalizeOutput(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/^"|"$/g, "");
}

function buildPrompt(input: ImproveMarketingFieldInput) {
  const fieldLabels: Record<MarketingImprovementField, string> = {
    whatSells: "Que vendes o que servicio ofreces",
    idealCustomer: "A que tipo de cliente le vendes",
    painPoints: "Que problema le ayudas a resolver",
  };

  const fieldInstructions: Record<MarketingImprovementField, string[]> = {
    whatSells: [
      "Reescribe el texto para explicar que vende el negocio de forma mas clara y comercial.",
      "Debe sonar concreto, profesional y facil de entender.",
      "Puedes mencionar a quien va dirigido solo si es evidente en el texto.",
      "Maximo 35 palabras.",
    ],
    idealCustomer: [
      "Reescribe el texto para describir con claridad el tipo de cliente ideal.",
      "Usa el contexto de lo que vende el negocio para que la respuesta sea coherente.",
      "Describe clientes reales y especificos, no categorias vacias ni demasiado amplias.",
      "Maximo 28 palabras.",
    ],
    painPoints: [
      "Reescribe el texto para explicar el problema principal que el negocio ayuda a resolver.",
      "Usa el contexto de lo que vende el negocio y del cliente ideal para que la respuesta conecte bien.",
      "Enfocate en dolores, necesidades o frustraciones del cliente antes de comprar.",
      "Maximo 32 palabras.",
    ],
  };

  return [
    input.businessName?.trim() ? `Negocio: ${input.businessName.trim()}` : "",
    input.whatSells?.trim() ? `Contexto - oferta: ${input.whatSells.trim()}` : "",
    input.idealCustomer?.trim() ? `Contexto - cliente ideal: ${input.idealCustomer.trim()}` : "",
    `Campo a mejorar: ${fieldLabels[input.field]}`,
    `Texto original: ${input.value.trim()}`,
    "",
    ...fieldInstructions[input.field],
    "Devuelve solo una frase final en espanol neutro.",
    "No uses markdown, comillas, listas ni etiquetas.",
    "Mantente fiel a lo que el usuario escribio y al contexto disponible.",
    "No inventes productos, promesas, precios ni datos que no esten implicitos.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function improveWithOpenAI(input: ImproveMarketingFieldInput, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      instructions:
        "Eres un redactor de marketing para pequenos negocios. Escribes frases claras, concretas, creibles y utiles para formularios comerciales.",
      input: [
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      temperature: 0.5,
      max_output_tokens: 140,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as OpenAIResponsesApiResponse;
  return normalizeOutput(extractOpenAIText(data));
}

async function improveWithGemini(input: ImproveMarketingFieldInput, apiKey: string) {
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
              text: "Eres un redactor de marketing para pequenos negocios. Escribes frases claras, concretas, creibles y utiles para formularios comerciales.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.5,
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

  return normalizeOutput(
    data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() || "").find(Boolean) || "",
  );
}

export async function improveMarketingFieldWithAI(input: ImproveMarketingFieldInput) {
  const value = input.value.trim();
  if (!value) {
    return "";
  }

  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!openAiApiKey && !geminiApiKey) {
    throw new Error("NO_AI_PROVIDER");
  }

  if (openAiApiKey) {
    const text = await improveWithOpenAI(input, openAiApiKey);
    if (text) {
      return text;
    }
  }

  if (geminiApiKey) {
    const text = await improveWithGemini(input, geminiApiKey);
    if (text) {
      return text;
    }
  }

  throw new Error("EMPTY_AI_RESPONSE");
}
