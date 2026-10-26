import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AREA_MARKETING } from "@/features/agentes-de-area/dominio/reglas";
import { PanelAgenteDeArea } from "@/features/agentes-de-area/components/PanelAgenteDeArea";
import { agenteActivo } from "@/features/agentes-de-area/servicios/config";
import { leerResumenesRecientes } from "@/features/agentes-de-area/servicios/resumenes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** El Agente de Marketing: lo ven el dueño, los administradores y la supervisora, igual que el Supervisor. */
export default async function AgenteDeMarketingPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }
  const workspaceId = access.workspaceId;
  const puedeCambiar = access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  const [activo, recientes] = await Promise.all([
    agenteActivo(workspaceId, AREA_MARKETING),
    leerResumenesRecientes(workspaceId, AREA_MARKETING, 14).catch(() => []),
  ]);
  const hoy = recientes[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <PanelAgenteDeArea
        titulo="Agente de Marketing"
        area="marketing"
        activo={activo}
        puedeCambiar={puedeCambiar}
        dia={hoy}
        envios={[]}
        sinNumero={[]}
        historial={recientes.map((r) => ({
          fecha: r.fecha,
          esPrueba: r.esPrueba,
          salioTarde: r.salioTarde,
          enviados: 0,
          bloqueados: 0,
        }))}
      />
    </div>
  );
}
