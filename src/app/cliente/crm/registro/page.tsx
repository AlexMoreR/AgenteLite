import type { Metadata } from "next";
import { CrmRegistroTable } from "@/features/crm/components/CrmRegistroTable";
import { CrmStatsCards, CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
import { SelectorDeAsesora } from "@/features/crm/components/SelectorDeAsesora";
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
  const params = await searchParams;
  const pedido = typeof params.userId === "string" ? params.userId.trim() : "";
  const data = await getAuthorizedCrmData(pedido);

  return (
    <section className="space-y-3 p-6">
      {/* El selector solo aparece para el jefe; para una asesora la lista viene vacia y no se
          dibuja nada. */}
      {data.asesoras.length > 0 ? (
        <div className="flex justify-end">
          <SelectorDeAsesora asesoras={data.asesoras} elegida={data.asesoraElegida} />
        </div>
      ) : null}

      <CrmStatsCards data={data} />

      <CrmRegistroTable records={data.records} referenceNow={data.generatedAt} />

      <div className="flex justify-end">
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>
    </section>
  );
}
