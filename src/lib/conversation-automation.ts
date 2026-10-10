import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getConversationAutomationPaused(input: {
  conversationId: string;
  workspaceId?: string;
}) {
  try {
    const workspaceFilter = input.workspaceId
      ? Prisma.sql` AND "workspaceId" = ${input.workspaceId}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{ automationPaused: boolean | null }>>`
      SELECT "automationPaused"
      FROM "Conversation"
      WHERE "id" = ${input.conversationId}
      ${workspaceFilter}
      LIMIT 1
    `;

    return Boolean(rows[0]?.automationPaused);
  } catch {
    return false;
  }
}

export async function setConversationAutomationPaused(input: {
  conversationId: string;
  paused: boolean;
}) {
  try {
    await prisma.$executeRaw`
      UPDATE "Conversation"
      SET
        "automationPaused" = ${input.paused},
        "automationPausedAt" = ${input.paused ? new Date() : null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.conversationId}
    `;
    if (input.paused) {
      // Sin esperar: pausar está en el camino del webhook y no puede demorarse por esto.
      void cancelarAutomaticosAlPausar(input.conversationId);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Anti-bloqueo, un solo dueño (apagado por defecto): al pausar el chat -la asesora lo toma- se
 * cancelan los seguimientos AUTOMÁTICOS pendientes del contacto. Los que agendó ella no se tocan.
 * Import dinámico: el motor de seguimientos arrastra media app y esto lo usa casi todo. Nunca lanza.
 */
async function cancelarAutomaticosAlPausar(conversationId: string) {
  try {
    const charla = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { workspaceId: true, contactId: true },
    });
    if (!charla) return;
    const { cancelarAutomaticosPendientesDelContacto } = await import("@/features/seguimientos/services/follows");
    await cancelarAutomaticosPendientesDelContacto({
      workspaceId: charla.workspaceId,
      contactId: charla.contactId,
      motivo: "chat_pausado",
    });
  } catch (error) {
    console.warn("[conversation-automation] no se pudieron cancelar los automaticos al pausar", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
