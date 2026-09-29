import type { Metadata } from "next";

import { AutomatizacionesWorkspace } from "@/features/automatizaciones/components/AutomatizacionesWorkspace";
import { cambiarBanderaDeDescarteAction } from "@/app/actions/descarte-actions";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { contarCandidatosDeDescarte, descarteAutomaticoEncendido } from "@/features/crm/services/descarte-automatico";
import { contarLeads, leerAutomatizaciones } from "@/features/automatizaciones/servicio";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  Modulo administrativo, aparte del CRM: mover leads en cantidad es una decision del negocio, no una
  vista de trabajo. No depende de tener el modulo CRM habilitado; alcanza con ser dueño o administrador.
*/
export default async function ClienteAutomatizacionesPage() {
  const access = await requireClientWorkspaceAccess();
  const esJefe = await puedeSupervisar(access);

  if (!esJefe) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Solo el dueño o un administrador del negocio puede usar las automatizaciones.
      </div>
    );
  }

  const [automatizaciones, miembros, canales] = await Promise.all([
    leerAutomatizaciones(access.workspaceId),
    prisma.workspaceMember.findMany({
      where: { workspaceId: access.workspaceId, isActive: true },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const conteos = await Promise.all(
    automatizaciones.map((automatizacion) => contarLeads(access.workspaceId, automatizacion)),
  );

  /*
    El descarte automatico se muestra CON SU NUMERO al lado.

    Prender esto cierra leads solos. Un interruptor que no dice cuantos va a mover la primera vez
    es una trampa: hoy son cientos, y el que lo prenda tiene que verlo antes de tocarlo.
  */
  const [descarteEncendido, candidatos] = await Promise.all([
    descarteAutomaticoEncendido(access.workspaceId),
    contarCandidatosDeDescarte(access.workspaceId),
  ]);

  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">Descartar solo los leads que no contestan</p>
          <p className="text-xs text-muted-foreground">
            Pasa a <strong>Descartado</strong> con motivo &laquo;Sin respuesta&raquo; los leads que llevan 30 días
            sin escribir después de que les insistimos 3 veces. No toca los <strong>Calientes</strong>. Queda una
            nota en cada tarjeta y se puede devolver a mano.
          </p>
          <p className="text-xs font-medium text-foreground">
            {descarteEncendido
              ? `${candidatos.length} leads cumplen la condición ahora mismo.`
              : `Si lo prendes ahora, moverá ${candidatos.length} leads.`}
          </p>
        </div>
        <FormActionSwitch
          action={cambiarBanderaDeDescarteAction}
          checked={descarteEncendido}
          ariaLabel="Descartar solo los leads que no contestan"
          hiddenFields={[{ name: "encendido", value: String(descarteEncendido) }]}
        />
      </div>

    <AutomatizacionesWorkspace
      automatizaciones={automatizaciones}
      conteos={conteos}
      miembros={miembros
        .map((miembro) => ({
          id: miembro.userId,
          nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))}
      canales={canales.map((canal) => ({ id: canal.id, nombre: canal.name }))}
    />
    </div>
  );
}
