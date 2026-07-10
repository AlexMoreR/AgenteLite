import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { DailyReportPanel, getDailyReports } from "@/features/reportes";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function NegocioReportePage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/onboarding");
  }

  const [dailyReports, reportConfig] = await Promise.all([
    getDailyReports(membership.workspace.id),
    prisma.workspace.findUnique({
      where: { id: membership.workspace.id },
      select: { dailyReportEnabled: true, dailyReportRecipients: true },
    }),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <DailyReportPanel
        enabled={reportConfig?.dailyReportEnabled ?? false}
        recipients={reportConfig?.dailyReportRecipients ?? []}
        reports={dailyReports}
      />
    </div>
  );
}
