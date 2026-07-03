import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ConnectionsTabsShell,
  ConnectionsWorkspace,
  getWhatsAppBusinessConnections,
} from "@/features/conexion";
import { DailyReportPanel, getDailyReports } from "@/features/reportes";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteConexionPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership) {
    redirect("/cliente?error=Debes+crear+tu+negocio+primero");
  }

  const [connections, moduleAccess, dailyReports, reportConfig, providerSettings, params] = await Promise.all([
    getWhatsAppBusinessConnections(membership.workspace.id),
    getAdminModuleAccess(access.userId, access.role),
    getDailyReports(membership.workspace.id),
    prisma.workspace.findUnique({
      where: { id: membership.workspace.id },
      select: { dailyReportEnabled: true, dailyReportRecipients: true },
    }),
    getOfficialApiProviderSettings(),
    searchParams,
  ]);
  const canSeeOfficialApiModule = access.role === "ADMIN" || moduleAccess.client_official_api;
  const officialApiEmbeddedSignupReady = Boolean(
    providerSettings.appId.trim() && providerSettings.configId.trim(),
  );
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const targetAgentId = typeof params.agentId === "string" ? params.agentId : "";
  const targetAgent = targetAgentId
    ? await prisma.agent.findFirst({
        where: {
          id: targetAgentId,
          workspaceId: membership.workspace.id,
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
      })
    : null;

  return (
    <ConnectionsTabsShell
      conexiones={
        <ConnectionsWorkspace
          officialApiEmbeddedSignupReady={officialApiEmbeddedSignupReady}
          officialApiProviderAppId={providerSettings.appId}
          officialApiProviderConfigId={providerSettings.configId}
          canSeeOfficialApiModule={canSeeOfficialApiModule}
          okMessage={okMessage}
          errorMessage={errorMessage}
          targetAgent={targetAgent}
          items={connections.items}
        />
      }
      reporte={
        <DailyReportPanel
          enabled={reportConfig?.dailyReportEnabled ?? false}
          recipients={reportConfig?.dailyReportRecipients ?? []}
          reports={dailyReports}
        />
      }
    />
  );
}
