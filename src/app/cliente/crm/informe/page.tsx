import type { Metadata } from "next";
import { CrmReportCards, CrmReportStatsCards, CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
import { getAuthorizedCrmData } from "../_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteCrmInformePage() {
  const data = await getAuthorizedCrmData();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-slate-950">CRM / Informe</h1>
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>

      <CrmReportStatsCards data={data} />
      <CrmReportCards data={data} />
    </section>
  );
}
