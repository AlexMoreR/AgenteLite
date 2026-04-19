import { prisma } from "@/lib/prisma";
import { SERVICE_ACCOUNT_EMAIL } from "@/lib/google-sheets";
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

  const [transactions, googleSheet, currency] = await Promise.all([
    prisma.financeTransaction.findMany({
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
    }),
    prisma.financeGoogleSheet.findUnique({
      where: { workspaceId },
      select: { id: true, sheetUrl: true, sheetId: true, lastSyncAt: true },
    }),
    getSystemCurrency(),
  ]);

  return {
    transactions: transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      date: t.date.toISOString(),
      createdAt: t.createdAt.toISOString(),
    })),
    googleSheet: googleSheet
      ? { ...googleSheet, lastSyncAt: googleSheet.lastSyncAt?.toISOString() ?? null }
      : null,
    workspaceId,
    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    currency,
  };
}
