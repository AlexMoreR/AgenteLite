import type { Metadata } from "next";
import { CrmKanbanBoard } from "@/features/crm/components/CrmKanbanBoard";
import { CrmStatsCards } from "@/features/crm/components/CrmPagePrimitives";
import { getAuthorizedCrmKanbanData } from "../_lib";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteCrmKanbanPage() {
  const data = await getAuthorizedCrmKanbanData();

  return (
    <section className="space-y-3 p-6">
      <CrmStatsCards data={data} />

      <CrmKanbanBoard columns={data.columns} />
    </section>
  );
}
