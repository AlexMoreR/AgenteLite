type ConversationTurn = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
  mediaUrl?: string | null;
};

type ConversationMessagePart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string };

type BuiltConversationMessage = {
  role: "assistant" | "user";
  parts: ConversationMessagePart[];
};

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAIToolSpec = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAIChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type AgentToolHandler = (args: Record<string, unknown>) => Promise<string | Record<string, unknown> | null> | string | Record<string, unknown> | null;

type GenerateAgentReplyInput = {
  model?: string | null;
  systemPrompt?: string | null;
  fallbackMessage?: string | null;
  history: ConversationTurn[];
  latestUserMessage?: string | null;
  rawSystemPrompt?: boolean;
  temperature?: number;
  tools?: OpenAIToolSpec[];
  toolHandlers?: Record<string, AgentToolHandler>;
  maxToolIterations?: number;
};

type ImageAnalysisInput = {
  imageUrl: string;
  model?: string | null;
  provider?: "openai" | "gemini";
};

type AudioTranscriptionInput = {
  audioUrl: string;
  model?: string | null;
};

function buildInstructions(input: GenerateAgentReplyInput) {
  if (input.rawSystemPrompt) {
    return input.systemPrompt?.trim() || "";
  }

  return [
    input.systemPrompt?.trim() || "Eres un asistente comercial por WhatsApp.",
    "Si el cliente envia una imagen, analízala y responde sobre lo que observas antes de pedir más datos.",
    "Usa el contexto del negocio y el historial de la conversacion cuando ayude.",
    "No inventes informacion que no tengas.",
    "Si falta contexto, haz una sola pregunta clara para avanzar.",
    "Nunca firmes los mensajes con tu nombre ni agregues despedidas como 'Asistente X', 'Att.', 'Saludos,' ni variantes al final.",
    "REGLA CRITICA DE FORMATO: Nunca envies un mensaje sin negrita. Pon en *asterisco simple* al menos el nombre del producto o servicio mencionado Y la llamada a la accion. Sin negrita tu respuesta esta incompleta. Ejemplo: 'Tenemos *camillas* ideales para spa. Â¿Te *enviamos precios*?' â€” nunca ** doble asterisco.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isRenderableImageUrl(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("data:") || normalized.startsWith("http://") || normalized.startsWith("https://");
}

function readDataUrlParts(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1]?.trim() || "image/png",
    data: match[3]?.replace(/\s+/g, "") || "",
  };
}

function toModelImageDataUrl(base64: string, mimeType: string) {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const safeMimeType =
    normalizedMimeType === "image/jpg" ||
    normalizedMimeType === "image/jpe" ||
    normalizedMimeType === "image/pjpeg" ||
    normalizedMimeType === "image/jfif"
      ? "image/jpeg"
      : ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(normalizedMimeType)
        ? normalizedMimeType
        : "image/jpeg";
  return `data:${safeMimeType};base64,${base64}`;
}

async function resolveImageDataUrl(imageUrl: string) {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:")) {
    const parts = readDataUrlParts(trimmed);
    if (!parts) {
      return null;
    }

    return toModelImageDataUrl(parts.data, parts.mimeType);
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const response = await fetch(trimmed, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return toModelImageDataUrl(bytes.toString("base64"), contentType);
  } catch {
    return null;
  }
}

async function buildMessages(input: GenerateAgentReplyInput): Promise<BuiltConversationMessage[]> {
  const history = input.history.slice(-12);
  const messages: BuiltConversationMessage[] = [];

  for (const [index, item] of history.entries()) {
    const parts: ConversationMessagePart[] = [];
    const content = item.content?.trim() || "";

    if (content) {
      parts.push({ kind: "text", text: content });
    }

    const mediaUrl = item.mediaUrl?.trim() || "";
    const hasVisualMedia = item.type === "IMAGE" || item.type === "STICKER";
    let resolvedVisualMedia = false;

    const isLatestInboundMedia = index === history.length - 1 && item.direction === "INBOUND";

    if (hasVisualMedia && isLatestInboundMedia && isRenderableImageUrl(mediaUrl)) {
      const resolvedImageUrl = await resolveImageDataUrl(mediaUrl);
      if (resolvedImageUrl) {
        parts.push({ kind: "image", url: resolvedImageUrl });
        resolvedVisualMedia = true;
      }
    }

    if (hasVisualMedia && !resolvedVisualMedia) {
      parts.push({
        kind: "text",
        text: item.direction === "OUTBOUND" ? "Imagen enviada al cliente." : "Imagen recibida del cliente.",
      });
    }

    if (parts.length === 0) {
      continue;
    }

    messages.push({
      role: item.direction === "OUTBOUND" ? "assistant" : "user",
      parts,
    });
  }

  const latestTrimmed = (input.latestUserMessage ?? "").trim();
  const lastMessage = messages[messages.length - 1];
  const lastUserText =
    lastMessage?.role === "user"
      ? lastMessage.parts.find((part): part is Extract<ConversationMessagePart, { kind: "text" }> => part.kind === "text")?.text ?? null
      : null;

  if (latestTrimmed && (!lastMessage || lastMessage.role !== "user" || lastUserText !== latestTrimmed)) {
    messages.push({
      role: "user",
      parts: [{ kind: "text", text: latestTrimmed }],
    });
  }

  return messages;
}

function toOpenAIContent(parts: ConversationMessagePart[]) {
  const text = parts
    .filter((part): part is Extract<ConversationMessagePart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  const imageParts = parts.filter((part): part is Extract<ConversationMessagePart, { kind: "image" }> => part.kind === "image");
  if (imageParts.length === 0) {
    return text;
  }

  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const part of imageParts) {
    content.push({ type: "image_url", image_url: { url: part.url } });
  }

  return content;
}

function toGeminiParts(parts: ConversationMessagePart[]) {
  const geminiParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  for (const part of parts) {
    if (part.kind === "text") {
      geminiParts.push({ text: part.text });
      continue;
    }

    const dataUrlParts = readDataUrlParts(part.url);
    if (dataUrlParts) {
      geminiParts.push({
        inlineData: {
          mimeType: dataUrlParts.mimeType,
          data: dataUrlParts.data,
        },
      });
    }
  }

  return geminiParts;
}

async function analyzeWithOpenAI(imageUrl: string, apiKey: string, model?: string | null) {
  const resolvedImageUrl = await resolveImageDataUrl(imageUrl);
  if (!resolvedImageUrl) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model?.trim() || "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "Eres un analista visual para WhatsApp. Responde de forma breve y directa, e incluye los atributos visibles del objeto o producto.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "¿Qué hay en esta imagen? Describe también los atributos visibles.",
            },
            {
              type: "image_url",
              image_url: { url: resolvedImageUrl },
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function analyzeWithGemini(imageUrl: string, apiKey: string, model?: string | null) {
  const resolvedImageUrl = await resolveImageDataUrl(imageUrl);
  if (!resolvedImageUrl) {
    return null;
  }

  const imageParts = toGeminiParts([{ kind: "image", url: resolvedImageUrl }]);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model?.trim() || "gemini-2.5-flash"}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "Eres un analista visual para WhatsApp. Responde de forma breve y directa, e incluye los atributos visibles del objeto o producto.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: "¿Qué hay en esta imagen? Describe también los atributos visibles." },
              ...imageParts,
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 120,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
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

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() || "").find(Boolean) || null;
}

function audioExtensionFromMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  return "audio";
}

async function resolveAudioBufferAndMimeType(audioUrl: string) {
  const trimmed = audioUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:")) {
    const parts = readDataUrlParts(trimmed);
    if (!parts) {
      return null;
    }

    const mimeType = parts.mimeType.startsWith("audio/") ? parts.mimeType : "audio/ogg";
    return {
      bytes: Buffer.from(parts.data, "base64"),
      mimeType,
    };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const response = await fetch(trimmed, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "audio/ogg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      mimeType: mimeType.startsWith("audio/") ? mimeType : "audio/ogg",
    };
  } catch {
    return null;
  }
}

async function transcribeWithOpenAI(audioUrl: string, apiKey: string) {
  const resolved = await resolveAudioBufferAndMimeType(audioUrl);
  if (!resolved) {
    return null;
  }

  const formData = new FormData();
  formData.append("model", "whisper-1");
  formData.append("file", new Blob([resolved.bytes], { type: resolved.mimeType }), `audio.${audioExtensionFromMimeType(resolved.mimeType)}`);
  formData.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim() || null;
}

export async function transcribeAudioForAgent(input: AudioTranscriptionInput) {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiApiKey) {
    try {
      const text = await transcribeWithOpenAI(input.audioUrl, openAiApiKey);
      if (text) {
        return text;
      }
    } catch (error) {
      console.error("[AGENT_AI] audio_transcription_failed:openai", error);
    }
  }

  return null;
}

export async function analyzeImageForAgent(input: ImageAnalysisInput) {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  const order: Array<"openai" | "gemini"> =
    input.provider === "gemini"
      ? ["gemini", "openai"]
      : ["openai", "gemini"];

  for (const provider of order) {
    try {
      if (provider === "openai" && openAiApiKey) {
        const text = await analyzeWithOpenAI(input.imageUrl, openAiApiKey, input.model);
        if (text) {
          return text;
        }
      }

      if (provider === "gemini" && geminiApiKey) {
        const text = await analyzeWithGemini(input.imageUrl, geminiApiKey, input.model);
        if (text) {
          return text;
        }
      }
    } catch (error) {
      console.error(`[AGENT_AI] image_analysis_failed:${provider}`, error);
    }
  }

  return null;
}

async function buildOpenAIChatMessages(input: GenerateAgentReplyInput) {
  const messages = await buildMessages(input);
  return messages.map((message) => ({
    role: message.role,
    content: toOpenAIContent(message.parts),
  }));
}

async function buildGeminiMessages(input: GenerateAgentReplyInput) {
  const messages = await buildMessages(input);
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(message.parts),
  }));
}

async function generateWithOpenAI(input: GenerateAgentReplyInput, apiKey: string) {
  const model = input.model?.trim() || "gpt-4o-mini";
  const instructions = buildInstructions(input);
  const messages = await buildOpenAIChatMessages(input);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: instructions }, ...messages],
      temperature: input.temperature ?? (input.rawSystemPrompt ? 0.2 : 0.7),
      max_tokens: 512,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function generateWithOpenAIAndTools(input: GenerateAgentReplyInput, apiKey: string) {
  const model = input.model?.trim() || "gpt-4o-mini";
  const instructions = buildInstructions(input);
  const messages: OpenAIChatMessage[] = [{ role: "system", content: instructions }, ...(await buildOpenAIChatMessages(input))];
  const tools = input.tools ?? [];
  const maxIterations = Math.max(1, input.maxToolIterations ?? 4);

  let remainingIterations = maxIterations;
  while (remainingIterations-- > 0) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        max_tokens: 512,
        temperature: input.temperature ?? (input.rawSystemPrompt ? 0.2 : 0.7),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI ${response.status}: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message: {
          role: "assistant";
          content: string | null;
          tool_calls?: OpenAIToolCall[];
        };
      }>;
    };

    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) {
      break;
    }

    messages.push({
      role: message.role,
      content: message.content?.trim() || "",
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    });

    const toolCalls = message.tool_calls ?? [];
    if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
      return message.content?.trim() || "";
    }

    for (const toolCall of toolCalls) {
      const handler = input.toolHandlers?.[toolCall.function.name];
      let toolResult: string | Record<string, unknown> | null;

      if (!handler) {
        toolResult = {
          ok: false,
          error: `No hay un manejador disponible para la herramienta ${toolCall.function.name}.`,
        };
      } else {
        let parsedArgs: Record<string, unknown> = {};
        try {
          const rawArgs = JSON.parse(toolCall.function.arguments || "{}") as unknown;
          parsedArgs = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
        } catch {
          parsedArgs = {};
        }

        try {
          toolResult = await handler(parsedArgs);
        } catch (error) {
          toolResult = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? {}),
      });
    }
  }

  return "";
}

async function generateWithGemini(input: GenerateAgentReplyInput, apiKey: string) {
  const model = input.model?.trim() || "gemini-2.5-flash";
  const instructions = buildInstructions(input);
  const messages = await buildGeminiMessages(input);

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
        contents: messages,
        generationConfig: {
          temperature: input.temperature ?? 0.7,
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
      run: () =>
        input.tools?.length
          ? generateWithOpenAIAndTools(input, openAiApiKey)
          : generateWithOpenAI(input, openAiApiKey),
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
