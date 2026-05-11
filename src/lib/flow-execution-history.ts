import { prisma } from "@/lib/prisma";

function normalizeFlowKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function getConversationExecutedFlowSlugs(input: {
  workspaceId: string;
  conversationId: string;
}) {
  const rows = await prisma.contactMatch.findMany({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      matchType: "FLOW",
    },
    select: {
      targetSlug: true,
    },
  });

  return new Set(rows.map((row) => row.targetSlug.trim()).filter(Boolean));
}

export function buildFlowExecutionContextNote(input: {
  flowTitle: string;
  modeLabel?: string;
}) {
  const flowTitle = input.flowTitle.trim();
  if (!flowTitle) {
    return null;
  }

  const modeLabel = input.modeLabel?.trim() || "flujo";
  return `El ${modeLabel} "${flowTitle}" ya fue enviado antes en esta conversacion. Usa ese dato como contexto y no lo repitas.`;
}

export function getFlowSlug(value: string) {
  return normalizeFlowKey(value);
}
