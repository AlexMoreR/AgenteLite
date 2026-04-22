type ConversationTurn = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
};

type GenerateAgentReplyInput = {
  model?: string | null;
  systemPrompt?: string | null;
  fallbackMessage?: string | null;
  history: ConversationTurn[];
  latestUserMessage: string;
  rawSystemPrompt?: boolean;
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

function buildInstructions(input: GenerateAgentReplyInput) {
  if (input.rawSystemPrompt) {
    return input.systemPrompt?.trim() || "";
  }
  return [
    input.systemPrompt?.trim() || "Eres un asistente comercial por WhatsApp.",
    "Responde en texto plano, breve, natural y util para WhatsApp.",
    "Usa el contexto del negocio y el historial de la conversacion cuando ayude.",
    "No inventes informacion que no tengas.",
    "Si falta contexto, haz una sola pregunta clara para avanzar.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildMessages(input: GenerateAgentReplyInput) {
  const messages = input.history
    .filter((item) => item.content?.trim())
    .slice(-12)
    .map((item) => ({
      role: item.direction === "OUTBOUND" ? "assistant" : "user",
      content: item.content!.trim(),
    }));

  const latestTrimmed = input.latestUserMessage.trim();
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== latestTrimmed) {
    messages.push({
      role: "user",
      content: latestTrimmed,
    });
  }

  return messages;
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

async function generateWithOpenAI(input: GenerateAgentReplyInput, apiKey: string) {
  const model = input.model?.trim() || "gpt-4.1-mini";
  const instructions = buildInstructions(input);
  const messages = buildMessages(input);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      temperature: input.rawSystemPrompt ? 0.2 : 0.7,
      input: messages,
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

async function generateWithGemini(input: GenerateAgentReplyInput, apiKey: string) {
  const model = input.model?.trim() || "gemini-2.5-flash";
  const instructions = buildInstructions(input);
  const messages = buildMessages(input);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: instructions }],
        },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
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

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() || "").find(Boolean) || "";
}

export async function generateAgentReply(input: GenerateAgentReplyInput) {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const fallback =
    input.fallbackMessage?.trim() ||
    "Gracias por escribirnos. En un momento te ayudo con tu solicitud.";

  if (!openAiApiKey && !geminiApiKey) {
    console.warn("[AGENT_AI] no_provider_key");
    return fallback;
  }

  const attempts: Array<{ provider: "openai" | "gemini"; run: () => Promise<string> }> = [];

  if (openAiApiKey) {
    attempts.push({
      provider: "openai",
      run: () => generateWithOpenAI(input, openAiApiKey),
    });
  }

  if (geminiApiKey) {
    attempts.push({
      provider: "gemini",
      run: () => generateWithGemini(input, geminiApiKey),
    });
  }

  for (const attempt of attempts) {
    try {
      const text = await attempt.run();
      if (text) {
        return text;
      }
    } catch (error) {
      console.error(`[AGENT_AI] provider_failed:${attempt.provider}`, error);
    }
  }

  return fallback;
}
