import { prisma } from "@/lib/prisma";

// Tipos de evento de actividad que se registran en la línea de tiempo del chat
// como mensajes de tipo SYSTEM (badges centrados con popover de fecha).
export type ConversationActivityKind =
  | "assigned"
  | "unassigned"
  | "resolved"
  | "reopened"
  | "tag_added"
  | "tag_removed"
  | "stage_changed";

/**
 * Registra un evento de actividad como mensaje SYSTEM en la conversación.
 * NO actualiza lastMessageAt (para que la conversación no salte en la lista) y se
 * marca con rawPayload.source = "activity" para distinguirlo y excluirlo de previews/contadores.
 */
export async function recordConversationActivity(input: {
  workspaceId: string;
  conversationId: string;
  channelId?: string | null;
  contactId?: string | null;
  kind: ConversationActivityKind;
  text: string;
}) {
  const text = input.text.trim();
  if (!text || !input.conversationId) {
    return;
  }

  try {
    await prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: input.channelId ?? null,
        contactId: input.contactId ?? null,
        direction: "OUTBOUND",
        type: "SYSTEM",
        status: "SENT",
        content: text,
        rawPayload: { source: "activity", kind: input.kind } as never,
      },
    });
  } catch {
    // El registro de actividad nunca debe romper la acción principal.
  }
}

// Detecta si un payload corresponde a una actividad (no a una llamada u otro SYSTEM).
export function isActivityRawPayload(rawPayload: unknown): boolean {
  return Boolean(
    rawPayload &&
      typeof rawPayload === "object" &&
      !Array.isArray(rawPayload) &&
      (rawPayload as { source?: unknown }).source === "activity",
  );
}
