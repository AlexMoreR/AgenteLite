import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AREA_VENTAS } from "@/features/agentes-de-area/dominio/reglas";
import { PanelAgenteDeArea } from "@/features/agentes-de-area/components/PanelAgenteDeArea";
import { agenteActivo } from "@/features/agentes-de-area/servicios/config";
import { asesorasSinNumero } from "@/features/agentes-de-area/servicios/envios";
import { contarEnvios, leerEnviosDelDia, leerResumenesRecientes } from "@/features/agentes-de-area/servicios/resumenes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** El Agente de Ventas: lo ven el dueño, los administradores y la supervisora, igual que el Supervisor. */
export default async function AgenteDeVentasPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }
  const workspaceId = access.workspaceId;
  const puedeCambiar = access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  const [activo, recientes, sinNumero] = await Promise.all([
    agenteActivo(workspaceId, AREA_VENTAS),
    leerResumenesRecientes(workspaceId, AREA_VENTAS, 14).catch(() => []),
    asesorasSinNumero(workspaceId).catch(() => []),
  ]);
  const hoy = recientes[0] ?? null;
  const [envios, cuentas] = await Promise.all([
    hoy ? leerEnviosDelDia(workspaceId, AREA_VENTAS, hoy.fecha).catch(() => []) : Promise.resolve([]),
    contarEnvios(workspaceId, AREA_VENTAS, recientes.map((r) => r.fecha)).catch(() => new Map()),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <PanelAgenteDeArea
        titulo="Agente de Ventas"
        activo={activo}
        puedeCambiar={puedeCambiar}
        dia={hoy}
        envios={envios}
        sinNumero={sinNumero}
        historial={recientes.map((r) => ({
          fecha: r.fecha,
          esPrueba: r.esPrueba,
          salioTarde: r.salioTarde,
          enviados: cuentas.get(r.fecha)?.enviados ?? 0,
          bloqueados: cuentas.get(r.fecha)?.bloqueados ?? 0,
        }))}
      />
    </div>
  );
}
