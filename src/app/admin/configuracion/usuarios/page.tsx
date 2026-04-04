import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { auth } from "@/auth";
import { CreateUserModal } from "@/components/admin/create-user-modal";
import { UsersDataTable } from "@/components/admin/users-data-table";
import { Card } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { getOfficialApiConfigByWorkspaceIds } from "@/lib/official-api-config";
import { isWorkspacePlanExpired } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminConfiguracionUsuariosPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_users");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          workspace: {
            select: {
              id: true,
              name: true,
              planTier: true,
              planExpiresAt: true,
            },
          },
        },
      },
    },
  });

  const workspaceIds = users
    .map((user) => user.workspaceMemberships[0]?.workspace.id)
    .filter((value): value is string => Boolean(value));
  const officialApiConfigMap = await getOfficialApiConfigByWorkspaceIds(workspaceIds);

  const usersForTable = users.map((user) => {
    const primaryWorkspace = user.workspaceMemberships[0]?.workspace;
    const officialApiConfig = primaryWorkspace
      ? officialApiConfigMap.get(primaryWorkspace.id) ?? null
      : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      workspaceMemberships: user.workspaceMemberships.map((membership) => ({
        ...membership,
        workspace: {
          ...membership.workspace,
          officialApiConfig,
        },
      })),
      isPlanExpired: isWorkspacePlanExpired(primaryWorkspace?.planExpiresAt),
    };
  });

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Usuario actualizado"
        errorTitle="Error de usuarios"
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
            <Users className="h-4 w-4 text-slate-500" />
            <span>Usuarios</span>
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Administra acceso, suscripcion y estado operativo de cada cuenta.
          </p>
        </div>
        <CreateUserModal />
      </div>

      <Card className="space-y-4">
        <UsersDataTable users={usersForTable} />
      </Card>
    </section>
  );
}
