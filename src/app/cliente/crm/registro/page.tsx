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
    <section className="space-y-3 p-6">
      <CrmStatsCards data={data} />

      <CrmRegistroTable records={data.records} referenceNow={data.generatedAt} />

      <div className="flex justify-end">
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>
    </section>
  );
}
