import type { Metadata } from "next";
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
      <CrmInformeView data={data} />
    </section>
  );
}
