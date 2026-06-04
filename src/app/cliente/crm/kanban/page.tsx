import type { Metadata } from "next";
import { CrmKanbanBoard } from "@/features/crm/components/CrmKanbanBoard";
import { CrmStatsCards, CrmUpdatedAt } from "@/features/crm/components/CrmPagePrimitives";
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-foreground">CRM / Kanban</h1>
        <CrmUpdatedAt generatedAt={data.generatedAt} />
      </div>

      <CrmStatsCards data={data} />

      <CrmKanbanBoard columns={data.columns} />
    </section>
  );
}
