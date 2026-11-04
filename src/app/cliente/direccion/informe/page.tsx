import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalientesDelDiaCard } from "@/features/crm/components/CalientesDelDiaCard";
import { CrmInformeView } from "@/features/crm/components/CrmInformeView";
import { estadoDeEtapaPorLectura } from "@/features/crm/services/etapa-por-lectura";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { causaCorta } from "@/lib/etapa-automatica-crm";
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

  // Calientes del día: si falla, la página sale igual, sin la tarjeta.
  const [{ esInformePersonal, ...data }, calientes] = await Promise.all([
    getAuthorizedCrmData(),
    estadoDeEtapaPorLectura(access.workspaceId).catch((falla) => {
      console.info(`[direccion/informe] sin Calientes del día causa=${causaCorta(falla)}`);
      return null;
    }),
  ]);

  return (
    <section className="space-y-3 p-6">
      {calientes ? <CalientesDelDiaCard estado={calientes} /> : null}
      <CrmInformeView data={data} esPersonal={esInformePersonal} />
    </section>
  );
}
