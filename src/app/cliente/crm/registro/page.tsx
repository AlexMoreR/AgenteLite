import type { Metadata } from "next";
import { CrmRegistroTable } from "@/features/crm/components/CrmRegistroTable";
import { CrmStatsCards, CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
import { getAuthorizedCrmData } from "../_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteCrmRegistroPage() {
  const data = await getAuthorizedCrmData();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-slate-950">CRM / Registro</h1>
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>

      <CrmStatsCards data={data} />

      <CrmRegistroTable records={data.records} referenceNow={data.generatedAt} />
    </section>
  );
}
