import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CrmRegistroTable } from "@/features/crm/components/CrmRegistroTable";
import { CrmStatsCards, CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
import { SelectorDeAsesora } from "@/features/crm/components/SelectorDeAsesora";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { puedeVerRegistro } from "@/lib/permisos-del-crm";
import { getAuthorizedCrmData } from "../_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteCrmRegistroPage({ searchParams }: PageProps) {
  // Solo dueño, administrador o la monitora de un canal (26-10-2026): las demás vuelven a Mi día.
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  const monitorea = (await canalesQueMonitorea({ workspaceId: access.workspaceId, userId: access.userId })).length > 0;
  if (!puedeVerRegistro(access, monitorea)) redirect("/cliente/crm/mi-dia");

  const params = await searchParams;
  const pedido = typeof params.userId === "string" ? params.userId.trim() : "";
  const data = await getAuthorizedCrmData(pedido);

  return (
    <section className="space-y-3 p-6">
      <CrmStatsCards data={data} />

      {/*
        El selector va DENTRO de la fila de filtros y no en un renglon propio: es un filtro mas
        —de quien son estos leads— y separado gastaba una franja entera para un solo control.

        Para una asesora la lista viene vacia y no se dibuja nada.
      */}
      <CrmRegistroTable
        records={data.records}
        referenceNow={data.generatedAt}
        soloLectura={data.soloLectura}
        filtroExtra={
          data.asesoras.length > 0 ? (
            <SelectorDeAsesora asesoras={data.asesoras} elegida={data.asesoraElegida} />
          ) : null
        }
      />

      <div className="flex justify-end">
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>
    </section>
  );
}
