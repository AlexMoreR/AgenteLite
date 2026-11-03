import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CrmInformeView } from "@/features/crm/components/CrmInformeView";
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

  const { esInformePersonal, ...data } = await getAuthorizedCrmData();

  return (
    <section className="space-y-3 p-6">
      <CrmInformeView data={data} esPersonal={esInformePersonal} />
    </section>
  );
}
