import { prisma } from "@/lib/prisma";

// Cuantos mensajes del historial se envian al modelo para resumir.
const MAX_HISTORY_MESSAGES = 80;
// Largo maximo del resumen guardado (coincide con lo que muestra el CRM en Detalle).
const MAX_SUMMARY_LENGTH = 300;

type SummaryTurn = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  type: string;
};

const SUMMARY_SYSTEM_PROMPT = [
  "Eres un analista comercial. Resume la conversacion de WhatsApp entre un cliente y el negocio.",
  "Objetivo: dejar claro QUE NECESITA o QUE BUSCA el cliente para dar seguimiento.",
  "Escribe UNA sola frase, en espanol, empezando con 'El cliente'.",
  "Incluye productos/servicios concretos mencionados y el estado (interesado, pidio precio, compro, no interesado, etc.).",
  "No saludes, no uses vinetas, no inventes datos. Maximo 300 caracteres.",
].join(" ");

function buildTranscript(messages: SummaryTurn[]) {
  return messages
    .filter((message) => message.type !== "SYSTEM" && message.content?.trim())
    .map((message) => `${message.direction === "INBOUND" ? "Cliente" : "Negocio"}: ${message.content!.trim()}`)
    .join("\n");
}

function truncateSummary(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

async function summarizeWithOpenAI(transcript: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 160,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `Conversacion:\n${transcript}\n\nResumen:` },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text().catch(() => response.statusText)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function summarizeWithGemini(transcript: string, apiKey: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Conversacion:\n${transcript}\n\nResumen:` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 160 },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${await response.text().catch(() => response.statusText)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() || "").find(Boolean) || "";
}

async function generateSummary(transcript: string) {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  const attempts: Array<{ provider: string; run: () => Promise<string> }> = [];
  if (openAiApiKey) {
    attempts.push({ provider: "openai", run: () => summarizeWithOpenAI(transcript, openAiApiKey) });
  }
  if (geminiApiKey) {
    attempts.push({ provider: "gemini", run: () => summarizeWithGemini(transcript, geminiApiKey) });
  }

  for (const attempt of attempts) {
    try {
      const text = await attempt.run();
      if (text) {
        return text;
      }
    } catch (error) {
      console.error(`[CONTACT_SUMMARY] provider_failed:${attempt.provider}`, error);
    }
  }

  return null;
}

/**
 * Resume todo el historial del cliente con IA y lo guarda en Contact.aiSummary.
 * Se llama desde el webhook despues de que el agente responde (best-effort).
 */
export async function summarizeContactHistory(input: {
  workspaceId: string;
  contactId: string;
}): Promise<string | null> {
  const messages = await prisma.message.findMany({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      isStatusBroadcast: false,
      type: { not: "SYSTEM" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_HISTORY_MESSAGES,
    select: { content: true, direction: true, type: true },
  });

  if (messages.length === 0) {
    return null;
  }

  // Vienen en orden descendente; se invierten a orden cronologico para el transcript.
  const transcript = buildTranscript([...messages].reverse());
  if (!transcript.trim()) {
    return null;
  }

  const summary = await generateSummary(transcript);
  if (!summary) {
    return null;
  }

  const finalSummary = truncateSummary(summary);

  await prisma.contact.update({
    where: { id: input.contactId },
    data: { aiSummary: finalSummary, aiSummaryAt: new Date() },
  });

  return finalSummary;
}
