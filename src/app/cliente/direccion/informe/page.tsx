import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalientesDelDiaCard, type CalientesDelDiaDatos } from "@/features/crm/components/CalientesDelDiaCard";
import { CrmInformeView } from "@/features/crm/components/CrmInformeView";
import { META_SIN_ETAPA, estadoDeEtapaPorLectura } from "@/features/crm/services/etapa-por-lectura";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { getAuthorizedCrmData } from "@/app/cliente/crm/_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/** Los números de la etapa automática para la tarjeta. Si fallan, la página sale igual, sin la tarjeta. */
async function calientesDelDia(workspaceId: string): Promise<CalientesDelDiaDatos | null> {
  try {
    const estado = await estadoDeEtapaPorLectura(workspaceId);
    if (estado.calientes_hoy === null && estado.porcentaje_sin_etapa_semana === null) return null;
    return {
      calientesHoy: estado.calientes_hoy,
      calientesPorDia: estado.calientes_por_dia,
      porcentajeSinEtapa: estado.porcentaje_sin_etapa_semana,
      sinEtapa: estado.sin_etapa_semana,
      meta: META_SIN_ETAPA,
    };
  } catch {
    return null;
  }
}

export default async function ClienteCrmInformePage() {
  // Solo dueño o administrador (Alex, 26-10-2026): las demás cuentas vuelven a Mi día.
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) redirect("/cliente/crm/mi-dia");

  const [{ esInformePersonal, ...data }, calientes] = await Promise.all([
    getAuthorizedCrmData(),
    calientesDelDia(access.workspaceId),
  ]);

  return (
    <section className="space-y-3 p-6">
      {calientes ? <CalientesDelDiaCard datos={calientes} /> : null}
      <CrmInformeView data={data} esPersonal={esInformePersonal} />
    </section>
  );
}
