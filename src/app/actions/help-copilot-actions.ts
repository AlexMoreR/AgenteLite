"use server";

import { auth } from "@/auth";
import { generateAgentReply } from "@/lib/agent-ai";
import { HELP_ASSISTANT_SYSTEM_PROMPT_HEADER } from "@/lib/help-assistant/instructions";
import { HELP_KNOWLEDGE_BASE } from "@/lib/help-assistant/knowledge";

type HelpCopilotTurn = { role: "user" | "assistant"; content: string };

const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_LENGTH = 2000;

const FALLBACK_REPLY =
  "Ahora mismo no puedo responderte. Intenta de nuevo en un momento y, si sigue fallando, avísale al administrador del negocio.";

// Copiloto de ayuda de AgenteLite: responde dudas del equipo sobre cómo usar la app,
// apoyándose en la base de conocimiento (no en el código). Reutiliza generateAgentReply,
// que ya resuelve el proveedor (OpenAI/Gemini) y la API key desde el entorno.
export async function runHelpCopilotAction(input: {
  message: string;
  history: HelpCopilotTurn[];
}): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }

  const message = (input?.message ?? "").trim();
  if (!message) {
    return { ok: false, error: "Escribe tu pregunta." };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "La pregunta es demasiado larga." };
  }

  const history = Array.isArray(input?.history) ? input.history : [];
  const trimmedHistory = history
    .filter(
      (turn): turn is HelpCopilotTurn =>
        Boolean(turn) &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY_TURNS);

  const systemPrompt = `${HELP_ASSISTANT_SYSTEM_PROMPT_HEADER}\n\n${HELP_KNOWLEDGE_BASE}`;

  try {
    const reply = await generateAgentReply({
      systemPrompt,
      rawSystemPrompt: true,
      temperature: 0.3,
      fallbackMessage: FALLBACK_REPLY,
      history: trimmedHistory.map((turn) => ({
        direction: turn.role === "assistant" ? "OUTBOUND" : "INBOUND",
        content: turn.content,
      })),
      latestUserMessage: message,
    });

    return { ok: true, reply: reply?.trim() || FALLBACK_REPLY };
  } catch (error) {
    console.error("[HELP_COPILOT] failed", error);
    return { ok: false, error: "No se pudo responder. Inténtalo de nuevo." };
  }
}
