import type { Metadata } from "next";
import { CrmKanbanBoard } from "@/features/crm/components/CrmKanbanBoard";
import { CrmStatsCards } from "@/features/crm/components/CrmPagePrimitives";
import { SelectorDeAsesora } from "@/features/crm/components/SelectorDeAsesora";
import { getAuthorizedCrmKanbanData } from "../_lib";

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

export default async function ClienteCrmKanbanPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const pedido = typeof params.userId === "string" ? params.userId.trim() : "";
  const data = await getAuthorizedCrmKanbanData(pedido);

  return (
    <section className="space-y-3 p-6">
      {data.asesoras.length > 0 ? (
        <div className="flex justify-end">
          <SelectorDeAsesora asesoras={data.asesoras} elegida={data.asesoraElegida} />
        </div>
      ) : null}

      <CrmStatsCards data={data} />

      <CrmKanbanBoard columns={data.columns} />
    </section>
  );
}
