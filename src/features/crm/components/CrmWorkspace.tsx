"use client";

import { useMemo, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmKanbanBoard } from "./CrmKanbanBoard";
import { CrmRegistroTable } from "./CrmRegistroTable";
import type { CrmData } from "../types";
import { Users2, KanbanSquare, TrendingUp, CheckCircle2, CircleSlash2 } from "lucide-react";

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
    <Card className="rounded-[24px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="text-[1.35rem] font-semibold leading-none tracking-[-0.05em] text-slate-950">{value}</p>
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
          {icon}
        </div>
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
    <section className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total" value={String(data.stats.total)} icon={<Users2 className="h-5 w-5" />} />
        <MetricCard label="En proceso" value={String(activeRecords)} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricCard label="Ganados" value={String(wonRecords)} icon={<CheckCircle2 className="h-5 w-5" />} />
        <MetricCard label="Perdidos" value={String(lostRecords)} icon={<CircleSlash2 className="h-5 w-5" />} />
        <MetricCard label="Columnas" value={String(data.columns.length)} icon={<KanbanSquare className="h-5 w-5" />} />
      </div>

      <Tabs defaultValue="registro" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
