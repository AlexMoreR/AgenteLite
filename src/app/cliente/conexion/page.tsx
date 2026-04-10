import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ConnectionsWorkspace, getConnectionsOverview } from "@/features/conexion";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteConexionPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente?error=Debes+crear+tu+negocio+primero");
  }

  const [overview, moduleAccess] = await Promise.all([
    getConnectionsOverview(membership.workspace.id),
    getAdminModuleAccess(session.user.id, session.user.role),
  ]);
  const canSeeOfficialApiModule = session.user.role === "ADMIN" || moduleAccess.client_official_api;

  return (
    <ConnectionsWorkspace
      agentCount={overview.agentCount}
      channelCount={overview.channelCount}
      officialApiEnabled={overview.officialApiEnabled}
      canSeeOfficialApiModule={canSeeOfficialApiModule}
    />
  );
}
