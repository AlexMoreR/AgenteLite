import type { Metadata } from "next";

import { AutomatizacionesWorkspace } from "@/features/automatizaciones/components/AutomatizacionesWorkspace";
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
    EL DESCARTE AUTOMATICO NO SE MUESTRA. El codigo sigue, apagado.

    Corrio UNA vez el 29-09-2026 y movio 50 leads. Alex miro la lista y decidio que Ingrid los
    descarta a mano, asi que saco el interruptor de la pantalla. No se borro nada: el servicio, su
    bandera y su enganche al cron siguen en el repositorio, y la bandera esta en "off".

    Sin interruptor, la unica forma de prenderlo es cambiar el AppSetting a mano, que es
    exactamente la traba que se quiere: algo que cierra leads solos no deberia estar a un clic de
    distancia mientras nadie lo pidio.

    Si vuelve a hacer falta, el interruptor era un FormActionSwitch con
    `cambiarBanderaDeDescarteAction`, y la pantalla mostraba cuantos leads moveria antes de
    prenderlo -eso conviene traerlo de vuelta junto con el boton-.

    Queda un hueco conocido para ese dia: la nota que deja en la tarjeta NO dice de que etapa venia
    el lead, asi que devolverlo a su etapa original es adivinar. Ver descarte-automatico.ts.
  */
  return (
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
  );
}
