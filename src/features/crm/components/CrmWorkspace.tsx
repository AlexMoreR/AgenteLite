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
    <Card className="py-3.5">
      <div className="flex items-center gap-3 px-4">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        </div>
        <p className="shrink-0 text-2xl font-semibold leading-none tracking-tight text-foreground">{value}</p>
      </div>
    </Card>
  );
}

function MetricInline({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center gap-2.5 px-4 py-1">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="truncate text-sm font-medium text-muted-foreground">{label}</span>
      <span className="ml-auto shrink-0 text-lg font-semibold leading-none tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function MetricBar({ children }: { children: ReactNode }) {
  return (
    <Card className="py-2.5">
      <div className="flex flex-col divide-y sm:flex-row sm:items-center sm:divide-x sm:divide-y-0">
        {children}
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

function formatCrmPercent(value: number, total: number) {
  if (total === 0) {
    return "0%";
  }

  return `${Math.round((value / total) * 100)}%`;
}

function ReportCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 px-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function CrmWorkspace({
  data,
  defaultView = "registro",
}: {
  data: CrmData;
  defaultView?: "registro" | "kanban" | "informe";
}) {
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

  const recordsByOrigin = useMemo(
    () =>
      data.records.reduce(
        (acc, record) => {
          acc[record.origin] += 1;
          return acc;
        },
        {
          FACEBOOK: 0,
          MARKETPLACE: 0,
          RECOMENDADO: 0,
          GENERICO: 0,
        },
      ),
    [data.records],
  );

  return (
    <section className="space-y-3">
      <MetricBar>
        <MetricInline label="Total" value={String(data.stats.total)} icon={<Users2 className="h-4 w-4" />} />
        <MetricInline label="En proceso" value={String(activeRecords)} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricInline label="Ganados" value={String(wonRecords)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricInline label="Descartados" value={String(lostRecords)} icon={<CircleSlash2 className="h-4 w-4" />} />
      </MetricBar>

      <Tabs defaultValue={defaultView} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="gap-1">
            <TabsTrigger value="registro">Registro</TabsTrigger>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="informe">Informe</TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">Actualizado: {formatCrmDateTime(data.generatedAt)}</p>
        </div>

        <TabsContent value="registro" className="space-y-3">
          <CrmRegistroTable records={data.records} referenceNow={data.generatedAt} />
        </TabsContent>

        <TabsContent value="kanban">
          <CrmKanbanBoard columns={data.columns} />
        </TabsContent>

        <TabsContent value="informe" className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total" value={String(data.stats.total)} icon={<Users2 className="h-5 w-5" />} />
            <MetricCard label="Activos" value={`${activeRecords} (${formatCrmPercent(activeRecords, data.stats.total)})`} icon={<TrendingUp className="h-5 w-5" />} />
            <MetricCard label="Ganados" value={`${wonRecords} (${formatCrmPercent(wonRecords, data.stats.total)})`} icon={<CheckCircle2 className="h-5 w-5" />} />
            <MetricCard label="Descartados" value={`${lostRecords} (${formatCrmPercent(lostRecords, data.stats.total)})`} icon={<CircleSlash2 className="h-5 w-5" />} />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <ReportCard
              title="Distribucion por etapa"
              rows={data.columns.map((column) => ({
                label: column.title,
                value: `${column.records.length}`,
              }))}
            />
            <ReportCard
              title="Origen de registros"
              rows={[
                { label: "Facebook Ads", value: String(recordsByOrigin.FACEBOOK) },
                { label: "Marketplace", value: String(recordsByOrigin.MARKETPLACE) },
                { label: "Recomendado", value: String(recordsByOrigin.RECOMENDADO) },
                { label: "Generico", value: String(recordsByOrigin.GENERICO) },
              ]}
            />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
