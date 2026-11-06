import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { guardarLiderDeVentasAction } from "@/app/actions/equipo-actions";
import { ClientTeamWorkspace, type EstadoDeLinea } from "@/components/client-team-workspace";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { leerColaboradores, leerMonitores, leerPausadosDeReparto } from "@/lib/channel-collaborators";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { horarioSiempre, leerHorariosDeReparto } from "@/lib/horario-de-reparto";
import { leerLiderDeVentasElegido, leerSupervisoras } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import { leerConfigDeAvisos, numeroDeAvisosDe } from "@/features/agente-v3/servicios/avisos";

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
  const [employees, canales, supervisoras, horarios, configDeAvisos, liderElegido] = await Promise.all([
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
    leerHorariosDeReparto(access.workspaceId),
    leerConfigDeAvisos(access.workspaceId).catch(() => null),
    leerLiderDeVentasElegido(access.workspaceId),
  ]);

  // Para elegir al lider de ventas solo sirven las personas activas del equipo.
  const activos = employees.filter((employee) => employee.isActive);
  // Si el elegido ya no esta activo, el select muestra "Sin elegir": es lo que pasa de verdad.
  const liderEnLista = activos.some((employee) => employee.user.id === liderElegido) ? liderElegido : null;

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

      {/* Reparto por anuncio: campaña o anuncio de Meta → asesora (dueño, 3-nov-2026). */}
      <div className="flex justify-end">
        <Link href="/cliente/equipo/reparto-por-anuncio" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Megaphone />
          Reparto por anuncio
        </Link>
      </div>

      {/* Lider de ventas: le llega el aviso "Listo para pagar" si nadie escribe a tiempo. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Líder de ventas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Le llega el aviso 🔥 Listo para pagar cuando nadie escribe en 5 minutos, en horario de trabajo. Necesita su
            número de avisos para recibirlo por WhatsApp; si no lo tiene, le llega solo la notificación del CRM.
          </p>
          <form action={guardarLiderDeVentasAction} className="flex flex-wrap items-center gap-2">
            <NativeSelect name="lider" defaultValue={liderEnLista ?? ""} aria-label="Líder de ventas">
              <NativeSelectOption value="">Sin elegir (primera supervisora)</NativeSelectOption>
              {activos.map((employee) => (
                <NativeSelectOption key={employee.user.id} value={employee.user.id}>
                  {employee.user.name ?? employee.user.email}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm">
              Guardar
            </Button>
          </form>
        </CardContent>
      </Card>

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
            horario: horarios[employee.user.id] ?? horarioSiempre(),
            whatsappDeAvisos: numeroDeAvisosDe(configDeAvisos, employee.user.id),
            invitedAtLabel: `Invitado: ${formatDate(employee.invitedAt)}`,
            acceptedAtLabel: employee.acceptedAt ? `Aceptado: ${formatDate(employee.acceptedAt)}` : "Sin aceptar",
          };
        })}
      />
    </section>
  );
}
