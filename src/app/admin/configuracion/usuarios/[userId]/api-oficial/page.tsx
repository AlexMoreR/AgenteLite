import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OfficialApiConfigWizard } from "@/components/admin/official-api-config-wizard";
import { Button } from "@/components/ui/button";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { getPublicBaseUrl } from "@/lib/app-url";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{
    userId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUserOfficialApiPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_users");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const { userId } = await params;
  const query = await searchParams;
  const okMessage = typeof query.ok === "string" ? query.ok : "";
  const errorMessage = typeof query.error === "string" ? query.error : "";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          workspace: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!user || user.role !== "CLIENTE") {
    redirect("/admin/configuracion/usuarios?error=Cliente+no+encontrado");
  }

  const workspace = user.workspaceMemberships[0]?.workspace;
  const officialApiConfig = workspace ? await getOfficialApiConfigByWorkspaceId(workspace.id) : null;
  const publicBaseUrl = getPublicBaseUrl();

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="API oficial actualizada"
        errorTitle="Error de configuracion"
      />
      {workspace ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href={`/admin/configuracion/usuarios/${user.id}/api-oficial/vista-previa`}>
              Vista previa
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl">
            <Link href={`/admin/configuracion/usuarios/${user.id}/api-oficial/vista-previa/chats`}>
              Vista previa chats
            </Link>
          </Button>
        </div>
      ) : null}
      <OfficialApiConfigWizard
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
        }}
        workspace={
          workspace
            ? {
                ...workspace,
                officialApiConfig,
              }
            : null
        }
        presentation="page"
        backHref="/admin/configuracion/usuarios"
        publicBaseUrl={publicBaseUrl}
      />
    </section>
  );
}
