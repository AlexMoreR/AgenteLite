import type { Metadata } from "next";
import { ClientTeamWorkspace, type EstadoDeLinea } from "@/components/client-team-workspace";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { leerColaboradores, leerMonitores, leerPausadosDeReparto } from "@/lib/channel-collaborators";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { leerSupervisoras } from "@/lib/permisos-del-equipo";
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

  // Muestra empleados (AGENT/EMPLEADO) Y administradores (ADMIN) del negocio. El dueno
  // (OWNER) no se lista aqui: es el titular de la cuenta, no un miembro gestionable.
  const [employees, canales, supervisoras] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: {
        workspaceId: access.workspaceId,
        role: { in: ["AGENT", "ADMIN"] },
        user: {
          role: { in: ["EMPLEADO", "ADMIN"] },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        role: true,
        moduleAccess: true,
        isActive: true,
        invitedAt: true,
        acceptedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, metadata: true },
    }),
    leerSupervisoras(access.workspaceId),
  ]);

  /*
    Que hace cada persona en cada linea, leido de la misma metadata que usa Conexion: son la misma
    configuracion vista desde la persona en vez de desde la linea.
  */
  const lineasDe = (userId: string) =>
    canales.map((canal) => {
      const colaboradores = leerColaboradores(canal.metadata);
      const estado: EstadoDeLinea = !colaboradores.includes(userId)
        ? "no"
        : leerMonitores(canal.metadata).includes(userId)
          ? "monitorea"
          : leerPausadosDeReparto(canal.metadata).includes(userId)
            ? "pausa"
            : "recibe";
      return { channelId: canal.id, nombre: canal.name, estado, abierta: colaboradores.length === 0 };
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
            userId: employee.user.id,
            name: employee.user.name ?? "Empleado",
            email: employee.user.email,
            role: employee.role === "ADMIN" ? ("admin" as const) : ("employee" as const),
            esSupervisora: employee.role !== "ADMIN" && supervisoras.includes(employee.user.id),
            status,
            statusLabel:
              status === "inactive" ? "Inactivo" : status === "active" ? "Activo" : "Pendiente",
            modules: sanitizeClientModuleAccess(employee.moduleAccess),
            lineas: lineasDe(employee.user.id),
            invitedAtLabel: `Invitado: ${formatDate(employee.invitedAt)}`,
            acceptedAtLabel: employee.acceptedAt ? `Aceptado: ${formatDate(employee.acceptedAt)}` : "Sin aceptar",
          };
        })}
      />
    </section>
  );
}
