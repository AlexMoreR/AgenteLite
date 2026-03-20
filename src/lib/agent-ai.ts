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
};

type OpenAIResponsesApiResponse = {
  output_text?: string;
};

export async function generateAgentReply(input: GenerateAgentReplyInput) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const fallback =
    input.fallbackMessage?.trim() ||
    "Gracias por escribirnos. En un momento te ayudo con tu solicitud.";

  if (!apiKey) {
    return fallback;
  }

  const model = input.model?.trim() || "gpt-4.1-mini";
  const instructions = [
    input.systemPrompt?.trim() || "Eres un asistente comercial por WhatsApp.",
    "Responde en texto plano, breve, natural y util para WhatsApp.",
    "No inventes informacion que no tengas.",
    "Si falta contexto, haz una sola pregunta clara para avanzar.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages = input.history
    .filter((item) => item.content?.trim())
    .slice(-8)
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

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input: messages,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as OpenAIResponsesApiResponse;
    return data.output_text?.trim() || fallback;
  } catch {
    return fallback;
  }
}
