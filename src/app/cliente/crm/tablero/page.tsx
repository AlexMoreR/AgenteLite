import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TableroDelEquipo } from "@/features/llamadas/components/TableroDelEquipo";
import { getLlamadasOwnerData } from "@/features/llamadas/services/getLlamadasData";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Cómo viene el equipo: leads, movimiento, llamadas, ventas y pérdidas.
 *
 * Estaba dentro de Llamadas, que ahora es la lista de llamadas recientes (Alex, 15-sep-2026). Es
 * una vista de CRM: mira el negocio, no una llamada. Solo para quien supervisa; a una asesora se la
 * devuelve a Mi día, que es su pantalla.
 */
export default async function ClienteCrmTableroPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }

  const data = await getLlamadasOwnerData(access.workspaceId);

  return (
    <section className="space-y-3 p-4 md:p-6">
      <TableroDelEquipo data={data} />
    </section>
  );
}
