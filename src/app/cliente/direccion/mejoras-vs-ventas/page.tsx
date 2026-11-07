import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MejorasVsVentas } from "@/features/mejoras-vs-ventas/components/mejoras-vs-ventas";
import { leerMejorasVsVentas } from "@/features/mejoras-vs-ventas/servicios/leer-mejoras-vs-ventas";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** MEJORAS VS VENTAS (solo jefes): leads, cotizaciones y ventas de 30 días con los cambios terminados. Solo lee. */
export default async function MejorasVsVentasPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }
  const datos = await leerMejorasVsVentas(access.workspaceId);
  return <MejorasVsVentas datos={datos} />;
}
