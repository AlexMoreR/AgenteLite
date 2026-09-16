import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { getMiDiaData } from "@/features/crm/services/getMiDiaData";
import { MiDiaView } from "@/features/crm/components/MiDiaView";
import { LlamadasDeMiDia } from "@/features/llamadas/components/LlamadasDeMiDia";
import { getLlamadasVendedoraData } from "@/features/llamadas/services/getLlamadasData";
import { canAccessClientModule } from "@/lib/client-workspace-access";
import { buildWaCallsDialerUrl } from "@/lib/wacalls";

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
  const visibleChannelIds = await getVisibleChannelIds({
    workspaceId: access.workspaceId,
    userId: access.userId,
    esJefe: access.isOwner || access.role === "ADMIN",
  });

  /*
    Un solo "Mi dia" (Alex, 15-sep-2026).

    Antes habia dos: este, con los chats a contactar y a responder, y el de Llamadas, con a quien
    llamar hoy y las llamadas sin clasificar. La asesora saltaba de uno a otro y se le pasaba lo que
    estaba en el que no miraba. Quien no tenga el modulo de Llamadas ve la pantalla como hasta ahora.
  */
  const veLlamadas = canAccessClientModule(access, "llamadas");
  const [data, vendedora] = await Promise.all([
    getMiDiaData({
      workspaceId: access.workspaceId,
      userId: access.userId,
      visibleChannelIds,
    }),
    veLlamadas ? getLlamadasVendedoraData(access.workspaceId, access.userId) : Promise.resolve(null),
  ]);
  const marcadorUrl = buildWaCallsDialerUrl("");

  return (
    <MiDiaView
      data={data}
      llamadasUrgentes={
        vendedora ? <LlamadasDeMiDia vendedora={vendedora} marcadorUrl={marcadorUrl} momento="urgente" /> : null
      }
      llamadasDespues={
        vendedora ? <LlamadasDeMiDia vendedora={vendedora} marcadorUrl={marcadorUrl} momento="despues" /> : null
      }
    />
  );
}
