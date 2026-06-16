import { prisma } from "@/lib/prisma";

export type DailyReportListItem = {
  id: string;
  shareToken: string;
  reportDate: string;
  sentiment: "SAD" | "NEUTRAL" | "HAPPY";
  inboundCount: number;
  newContacts: number;
  wonCount: number;
  lostCount: number;
  aiSummary: string | null;
};

export async function getDailyReports(workspaceId: string, limit = 30): Promise<DailyReportListItem[]> {
  const reports = await prisma.dailyReport.findMany({
    where: { workspaceId },
    orderBy: { reportDate: "desc" },
    take: limit,
    select: {
      id: true,
      shareToken: true,
      reportDate: true,
      sentiment: true,
      inboundCount: true,
      newContacts: true,
      wonCount: true,
      lostCount: true,
      aiSummary: true,
    },
  });

  return reports.map((r) => ({
    id: r.id,
    shareToken: r.shareToken,
    reportDate: r.reportDate.toISOString(),
    sentiment: r.sentiment,
    inboundCount: r.inboundCount,
    newContacts: r.newContacts,
    wonCount: r.wonCount,
    lostCount: r.lostCount,
    aiSummary: r.aiSummary,
  }));
}
