"use client";

import { useMemo, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmKanbanBoard } from "./CrmKanbanBoard";
import { CrmRegistroTable } from "./CrmRegistroTable";
import type { CrmData } from "../types";
import { Users2, TrendingUp, CheckCircle2, CircleSlash2 } from "lucide-react";

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">{label}</p>
        </div>
        <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">{value}</p>
      </div>
    </Card>
  );
}

function formatCrmDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  })
    .format(new Date(value))
    .replace(/\u00A0/g, " ");
}

export function CrmWorkspace({ data }: { data: CrmData }) {
  const activeRecords = useMemo(
    () => data.records.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length,
    [data.records],
  );

  const wonRecords = useMemo(
    () => data.records.filter((record) => record.status === "GANADO").length,
    [data.records],
  );

  const lostRecords = useMemo(
    () => data.records.filter((record) => record.status === "PERDIDO").length,
    [data.records],
  );

  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total" value={String(data.stats.total)} icon={<Users2 className="h-5 w-5" />} />
        <MetricCard label="En proceso" value={String(activeRecords)} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricCard label="Ganados" value={String(wonRecords)} icon={<CheckCircle2 className="h-5 w-5" />} />
        <MetricCard label="Descartados" value={String(lostRecords)} icon={<CircleSlash2 className="h-5 w-5" />} />
      </div>

      <Tabs defaultValue="registro" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="gap-1">
            <TabsTrigger value="registro">Registro</TabsTrigger>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
          </TabsList>
          <p className="text-xs text-slate-500">Actualizado: {formatCrmDateTime(data.generatedAt)}</p>
        </div>

        <TabsContent value="registro" className="space-y-3">
          <CrmRegistroTable records={data.records} referenceNow={data.generatedAt} />
        </TabsContent>

        <TabsContent value="kanban">
          <CrmKanbanBoard columns={data.columns} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
