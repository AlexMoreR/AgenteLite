/**
 * Avisa al altavoz de realtime que algo cambio en un workspace (ver realtime-server.js).
 *
 * Es best-effort a proposito: si el altavoz esta caido o tarda, NO se rompe ni se demora el
 * webhook de Meta (que debe responder rapido o Meta reintenta). En el peor caso el chat se
 * actualiza por el poll de respaldo, como hasta ahora.
 */
const NOTIFY_TIMEOUT_MS = 1500;

export async function notifyRealtimeUpdate(input: {
  workspaceId: string;
  conversationId?: string | null;
  type?: string;
}): Promise<void> {
  const url = process.env.REALTIME_NOTIFY_URL?.trim();
  if (!url || !input.workspaceId) {
    return;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-token": process.env.REALTIME_INTERNAL_TOKEN?.trim() || "",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId ?? null,
        type: input.type || "official-api-update",
      }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Silencioso: el realtime es una mejora, no un requisito para procesar el mensaje.
  }
}
