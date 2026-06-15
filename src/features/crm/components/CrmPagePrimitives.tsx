import type { ReactNode } from "react";
import { CheckCircle2, CircleSlash2, TrendingUp, Users2 } from "lucide-react";
import type { CrmData } from "../types";
import { CrmOriginChart, CrmStageChart } from "./CrmReportCharts";

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
    <div className="flex flex-1 items-center gap-2 px-3 py-2">
      <span>{icon}</span>
      <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
      <span className="ml-auto shrink-0 text-[13px] font-medium text-foreground">{value}</span>
    </div>
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

function getCrmSummaryStats(data: CrmData) {
  const activeRecords = data.records.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const wonRecords = data.records.filter((record) => record.status === "GANADO").length;
  const lostRecords = data.records.filter((record) => record.status === "PERDIDO").length;

  return { activeRecords, wonRecords, lostRecords };
}

function getCrmRecordsByOrigin(data: CrmData) {
  return data.records.reduce(
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
  );
}

export function CrmUpdatedAt({ generatedAt }: { generatedAt: string }) {
  return <p className="text-xs text-muted-foreground">Actualizado: {formatCrmDateTime(generatedAt)}</p>;
}

export function CrmStatsCards({ data }: { data: CrmData }) {
  const { activeRecords, wonRecords, lostRecords } = getCrmSummaryStats(data);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-col divide-y divide-border sm:flex-row sm:items-center sm:divide-x sm:divide-y-0">
        <MetricInline label="Total" value={String(data.stats.total)} icon={<Users2 className="h-3.5 w-3.5 text-blue-600" />} />
        <MetricInline label="En proceso" value={String(activeRecords)} icon={<TrendingUp className="h-3.5 w-3.5 text-amber-500" />} />
        <MetricInline label="Ganados" value={String(wonRecords)} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />} />
        <MetricInline label="Descartados" value={String(lostRecords)} icon={<CircleSlash2 className="h-3.5 w-3.5 text-rose-600" />} />
      </div>
    </div>
  );
}

export function CrmReportStatsCards({ data }: { data: CrmData }) {
  const { activeRecords, wonRecords, lostRecords } = getCrmSummaryStats(data);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-col divide-y divide-border sm:flex-row sm:items-center sm:divide-x sm:divide-y-0">
        <MetricInline label="Total" value={String(data.stats.total)} icon={<Users2 className="h-3.5 w-3.5 text-blue-600" />} />
        <MetricInline
          label="Activos"
          value={`${activeRecords} (${formatCrmPercent(activeRecords, data.stats.total)})`}
          icon={<TrendingUp className="h-3.5 w-3.5 text-amber-500" />}
        />
        <MetricInline
          label="Ganados"
          value={`${wonRecords} (${formatCrmPercent(wonRecords, data.stats.total)})`}
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
        />
        <MetricInline
          label="Descartados"
          value={`${lostRecords} (${formatCrmPercent(lostRecords, data.stats.total)})`}
          icon={<CircleSlash2 className="h-3.5 w-3.5 text-rose-600" />}
        />
      </div>
    </div>
  );
}

export function CrmReportCards({ data }: { data: CrmData }) {
  const recordsByOrigin = getCrmRecordsByOrigin(data);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <CrmStageChart
        rows={data.columns.map((column) => ({
          label: column.title,
          value: column.records.length,
        }))}
      />
      <CrmOriginChart
        rows={[
          { label: "Facebook Ads", value: recordsByOrigin.FACEBOOK },
          { label: "Marketplace", value: recordsByOrigin.MARKETPLACE },
          { label: "Recomendado", value: recordsByOrigin.RECOMENDADO },
          { label: "Generico", value: recordsByOrigin.GENERICO },
        ]}
      />
    </div>
  );
}
