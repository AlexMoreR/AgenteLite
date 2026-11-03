import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalientesDelDiaCard } from "@/features/crm/components/CalientesDelDiaCard";
import { CrmInformeView } from "@/features/crm/components/CrmInformeView";
import { estadoDeEtapaPorLectura } from "@/features/crm/services/etapa-por-lectura";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { getAuthorizedCrmData } from "@/app/cliente/crm/_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteCrmInformePage() {
  // Solo dueño o administrador (Alex, 26-10-2026): las demás cuentas vuelven a Mi día.
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) redirect("/cliente/crm/mi-dia");

  // Los números de Calientes del día: si fallan, la página sale igual, sin la tarjeta.
  const [{ esInformePersonal, ...data }, lectura] = await Promise.all([
    getAuthorizedCrmData(),
    estadoDeEtapaPorLectura(access.workspaceId).catch(() => null),
  ]);
  const conNumeros = lectura && (lectura.calientes_hoy !== null || lectura.porcentaje_sin_etapa_semana !== null);

  return (
    <section className="space-y-3 p-6">
      {conNumeros ? (
        <CalientesDelDiaCard
          calientesHoy={lectura.calientes_hoy}
          calientesPorDia={lectura.calientes_por_dia}
          porcentajeSinEtapa={lectura.porcentaje_sin_etapa_semana}
          sinEtapa={lectura.sin_etapa_semana}
        />
      ) : null}
      <CrmInformeView data={data} esPersonal={esInformePersonal} />
    </section>
  );
}
