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
    return true;
  } catch {
    return false;
  }
}
