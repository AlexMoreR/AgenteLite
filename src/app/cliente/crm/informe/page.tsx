import type { Metadata } from "next";
import { CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
import { CrmInformeView } from "@/features/crm/components/CrmInformeView";
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
    <section className="space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-foreground">CRM / Informe</h1>
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>

      <CrmInformeView data={data} />
    </section>
  );
}
