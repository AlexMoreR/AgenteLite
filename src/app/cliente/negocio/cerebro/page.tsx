import type { Metadata } from "next";

import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { CerebroPantalla } from "@/features/cerebro/components/CerebroPantalla";
import { ConexionCerebro } from "@/features/cerebro/components/ConexionCerebro";
import { correoDeCuentaDeServicio, googleConfigurado, modoDelCerebro, tieneAccesoAlDrive } from "@/features/cerebro/services/conexion";
import { arbolDelCerebro } from "@/features/cerebro/services/consultas";
import { permisosDelCerebro } from "@/features/cerebro/services/permisos";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  Cerebro: la base de conocimiento del negocio (lo que ya está decidido), conectada a una carpeta de
  Google Drive que es el ORIGINAL. Esta pantalla muestra una copia sincronizada: si hay diferencia, gana
  el Drive. La ven el dueño y las personas que él autorice.
*/
export default async function ClienteCerebroPage({ searchParams }: { searchParams: Promise<{ error?: string; conectado?: string }> }) {
  const access = await requireClientWorkspaceAccess();
  const permisos = await permisosDelCerebro(access);
  const { error, conectado } = await searchParams;

  if (!permisos.ver) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <NegocioEquipoTabs />
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          El cerebro lo ve el dueño y quien él autorice.
        </div>
      </div>
    );
  }

  const conexion = await prisma.cerebroConexion.findUnique({
    where: { workspaceId: access.workspaceId },
    select: { cuentaGoogle: true, tokenCifrado: true, carpetaId: true, carpetaNombre: true, ultimaSincronizacion: true, ultimoError: true },
  });
  const [arbol, cambios, miembros] = await Promise.all([
    conexion?.carpetaId ? arbolDelCerebro(access.workspaceId) : Promise.resolve([]),
    prisma.cerebroCambio.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { creadoEn: "desc" },
      take: 10,
      select: { id: true, quienNombre: true, origen: true, nombreDocumento: true, accion: true, creadoEn: true },
    }),
    permisos.administrar
      ? prisma.workspaceMember.findMany({
          where: { workspaceId: access.workspaceId, isActive: true, userId: { not: access.userId } },
          select: { userId: true, user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <NegocioEquipoTabs />

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {conectado ? <p className="rounded-lg border bg-muted px-3 py-2 text-sm">Google quedó conectado. Ahora elige la carpeta del cerebro.</p> : null}

      <ConexionCerebro
        puedeAdministrar={permisos.administrar}
        googleListo={googleConfigurado()}
        cuentaDeServicio={modoDelCerebro() === "cuenta-servicio" ? correoDeCuentaDeServicio() : null}
        cuenta={conexion?.cuentaGoogle ?? null}
        tienePermiso={tieneAccesoAlDrive(conexion)}
        carpeta={conexion?.carpetaNombre ?? null}
        ultimoError={conexion?.ultimoError ?? null}
        miembros={miembros.map((miembro) => ({ userId: miembro.userId, nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre" }))}
        autorizados={permisos.autorizados}
      />

      {conexion?.carpetaId ? (
        <CerebroPantalla
          arbol={JSON.parse(JSON.stringify(arbol))}
          ultimaSincronizacion={conexion.ultimaSincronizacion?.toISOString() ?? null}
          cambios={cambios.map((cambio) => ({ ...cambio, creadoEn: cambio.creadoEn.toISOString() }))}
        />
      ) : null}
    </div>
  );
}
