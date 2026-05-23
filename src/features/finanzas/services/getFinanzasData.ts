import { prisma } from "@/lib/prisma";
import { SERVICE_ACCOUNT_EMAIL, fetchFinanceSheetRows, parseFinanceSheetRows } from "@/lib/google-sheets";
import { getSystemCurrency } from "@/lib/system-settings";
import type { FinanzasData } from "../types";

export async function getFinanzasData(userId: string): Promise<FinanzasData | null> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { id: true } } },
  });

  if (!membership) return null;

  const workspaceId = membership.workspace.id;

  const [googleSheet, currency, agentConfig, chatMessages] = await Promise.all([
    prisma.financeGoogleSheet.findUnique({
      where: { workspaceId },
      select: { id: true, sheetUrl: true, sheetId: true, lastSyncAt: true },
    }),
    getSystemCurrency(),
    prisma.financeAgentConfig.findUnique({
      where: { workspaceId },
      select: { systemPrompt: true },
    }),
    prisma.financeChatMessage.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, role: true, content: true, createdAt: true },
    }),
  ]);

  let transactions = await prisma.financeTransaction.findMany({
    where: { workspaceId },
    orderBy: { date: "asc" },
    take: 300,
    select: {
      id: true,
      type: true,
      amount: true,
      description: true,
      category: true,
      date: true,
      source: true,
      createdAt: true,
    },
  });

  if (googleSheet) {
    const rows = await fetchFinanceSheetRows(googleSheet.sheetId);
    if (rows) {
      const sheetTransactions = parseFinanceSheetRows(rows);
      transactions = sheetTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        description: t.description,
        category: t.category,
        date: t.date,
        source: "google_sheet",
        createdAt: t.date,
      }));
    }
  }

  return {
    transactions: transactions
      .map((t) => ({
        ...t,
        amount: Number(t.amount),
        date: new Date(t.date).toISOString(),
        createdAt: new Date(t.createdAt).toISOString(),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    googleSheet: googleSheet
      ? { ...googleSheet, lastSyncAt: googleSheet.lastSyncAt?.toISOString() ?? null }
      : null,
    chatMessages: chatMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    workspaceId,
    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    currency,
    agentPrompt: agentConfig?.systemPrompt ?? null,
  };
}
