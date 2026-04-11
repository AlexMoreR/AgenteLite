import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ConnectionsWorkspace, getConnectionsOverview, getWhatsAppBusinessConnections } from "@/features/conexion";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
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
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente?error=Debes+crear+tu+negocio+primero");
  }

  const [overview, connections, moduleAccess, params] = await Promise.all([
    getConnectionsOverview(membership.workspace.id),
    getWhatsAppBusinessConnections(membership.workspace.id),
    getAdminModuleAccess(session.user.id, session.user.role),
    searchParams,
  ]);
  const canSeeOfficialApiModule = session.user.role === "ADMIN" || moduleAccess.client_official_api;
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
    <ConnectionsWorkspace
      officialApiEnabled={overview.officialApiEnabled}
      canSeeOfficialApiModule={canSeeOfficialApiModule}
      okMessage={okMessage}
      errorMessage={errorMessage}
      targetAgent={targetAgent}
      items={connections.items}
    />
  );
}
