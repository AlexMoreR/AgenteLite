import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getMiDiaData } from "@/features/crm/services/getMiDiaData";
import { MiDiaView } from "@/features/crm/components/MiDiaView";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmMiDiaPage() {
  // Mi dia es ahora la pantalla de ENTRADA de todos, asi que quien no tenga el modulo CRM no
  // puede quedar en un "no autorizado" sin salida: se lo devuelve a /cliente, que ya sabe a
  // donde mandarlo segun sus permisos.
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  // Su dia: la lista trae SUS leads y los que no tienen dueno, no los de otra persona.
  const data = await getMiDiaData({ workspaceId: access.workspaceId, userId: access.userId });

  return <MiDiaView data={data} />;
}
