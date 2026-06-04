import type { Metadata } from "next";
import { ClientTeamWorkspace } from "@/components/client-team-workspace";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatDate(value: Date | null) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
  }).format(value);
}

export default async function ClienteEquipoPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const employees = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: access.workspaceId,
      role: "AGENT",
      user: {
        role: "EMPLEADO",
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      moduleAccess: true,
      isActive: true,
      invitedAt: true,
      acceptedAt: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  return (
    <section className="app-page flex flex-col gap-5 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Equipo actualizado"
        errorTitle="No se pudo actualizar el equipo"
      />

      <ClientTeamWorkspace
        employees={employees.map((employee) => {
          const status = !employee.isActive ? "inactive" : employee.acceptedAt ? "active" : "pending";

          return {
            id: employee.id,
            name: employee.user.name ?? "Empleado",
            email: employee.user.email,
            status,
            statusLabel:
              status === "inactive" ? "Inactivo" : status === "active" ? "Activo" : "Pendiente",
            modules: sanitizeClientModuleAccess(employee.moduleAccess),
            invitedAtLabel: `Invitado: ${formatDate(employee.invitedAt)}`,
            acceptedAtLabel: employee.acceptedAt ? `Aceptado: ${formatDate(employee.acceptedAt)}` : "Sin aceptar",
          };
        })}
      />
    </section>
  );
}
