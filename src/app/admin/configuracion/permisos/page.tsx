import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ModuleAccessWorkspace } from "@/components/admin/module-access-workspace";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import {
  adminModuleDefinitions,
  getAdminModuleAccess,
} from "@/lib/admin-module-access";
import { Role } from "@prisma/client";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminConfiguracionPermisosPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    redirect("/unauthorized");
  }

  const canAccess = await getAdminModuleAccess(session.user.id, session.user.role);
  if (!canAccess.config_permissions) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const roles: Role[] = ["ADMIN", "EMPLEADO", "CLIENTE"];

  const rolesWithModules = await Promise.all(
    roles.map(async (role) => {
      const access = await getAdminModuleAccess(undefined, role);

      return {
        role,
        modules: adminModuleDefinitions
          .filter((moduleItem) => access[moduleItem.key])
          .map((moduleItem) => moduleItem.key),
      };
    }),
  );

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Permisos actualizados"
        errorTitle="Error de permisos"
      />

      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
          Control de modulos
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Oculta y restringe modulos administrativos por usuario.
        </p>
      </div>

      <ModuleAccessWorkspace
        modules={adminModuleDefinitions.map((module) => ({
          key: module.key,
          label: module.label,
          description: module.description,
          group: module.group,
        }))}
        roles={rolesWithModules}
      />
    </section>
  );
}
