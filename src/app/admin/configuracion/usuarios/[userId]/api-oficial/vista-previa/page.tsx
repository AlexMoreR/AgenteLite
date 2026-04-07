import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  OfficialApiLockedState,
  OfficialApiPanelShell,
  OfficialApiWorkspace,
  getOfficialApiOverview,
} from "@/features/official-api";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{
    userId: string;
  }>;
};

export default async function AdminUserOfficialApiPreviewPage({ params }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_users");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          workspace: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!user || user.role !== "CLIENTE") {
    redirect("/admin/configuracion/usuarios?error=Cliente+no+encontrado");
  }

  const workspaceId = user.workspaceMemberships[0]?.workspace.id;
  if (!workspaceId) {
    redirect("/admin/configuracion/usuarios?error=Cliente+sin+workspace");
  }

  const overview = await getOfficialApiOverview(workspaceId);
  const basePath = `/admin/configuracion/usuarios/${userId}/api-oficial/vista-previa`;

  return (
    <section className="space-y-5">
      <OfficialApiPanelShell basePath={basePath}>
        {overview.setupStatus === "connected" ? (
          <OfficialApiWorkspace overview={overview} />
        ) : (
          <OfficialApiLockedState workspaceName={overview.workspaceName} />
        )}
      </OfficialApiPanelShell>
    </section>
  );
}
