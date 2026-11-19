import type { Metadata } from "next";
import Link from "next/link";

import { leerAsignacion } from "@/app/actions/asignacion-actions";
import { AsignacionForm } from "@/components/asignacion-form";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/*
  ASIGNACIÓN (T-772, parte 3): cuándo se le asigna un chat a una asesora, quién está en el reparto de
  cada línea de ventas y los minutos de la regla de demora. Solo el dueño y los administradores, con
  el mismo candado que Reparto por anuncio: los demás van a /unauthorized.
*/
export default async function AsignacionPage() {
  await requireClientWorkspaceAccess("client_team", { ownerOnly: true, redirectTo: "/unauthorized" });
  const datos = await leerAsignacion();

  return (
    <section className="app-page flex flex-col gap-5 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <div className="flex flex-col gap-1">
        <Link href="/cliente/equipo" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          ← Volver a Equipo
        </Link>
        <h1 className="text-lg font-semibold">Asignación</h1>
        <p className="text-sm text-muted-foreground">
          Elige cuándo se le asigna un chat a una asesora, quién está en el reparto de cada línea y los minutos de la
          regla de demora.
        </p>
      </div>

      <AsignacionForm datos={datos} />
    </section>
  );
}
