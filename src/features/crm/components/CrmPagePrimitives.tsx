import type { ReactNode } from "react";
import { CheckCircle2, CircleSlash2, TrendingUp, Users2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CrmData } from "../types";

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
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Total" value={String(data.stats.total)} icon={<Users2 className="h-5 w-5" />} />
      <MetricCard label="En proceso" value={String(activeRecords)} icon={<TrendingUp className="h-5 w-5" />} />
      <MetricCard label="Ganados" value={String(wonRecords)} icon={<CheckCircle2 className="h-5 w-5" />} />
      <MetricCard label="Descartados" value={String(lostRecords)} icon={<CircleSlash2 className="h-5 w-5" />} />
    </div>
  );
}

export function CrmReportStatsCards({ data }: { data: CrmData }) {
  const { activeRecords, wonRecords, lostRecords } = getCrmSummaryStats(data);

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Total" value={String(data.stats.total)} icon={<Users2 className="h-5 w-5" />} />
      <MetricCard
        label="Activos"
        value={`${activeRecords} (${formatCrmPercent(activeRecords, data.stats.total)})`}
        icon={<TrendingUp className="h-5 w-5" />}
      />
      <MetricCard
        label="Ganados"
        value={`${wonRecords} (${formatCrmPercent(wonRecords, data.stats.total)})`}
        icon={<CheckCircle2 className="h-5 w-5" />}
      />
      <MetricCard
        label="Descartados"
        value={`${lostRecords} (${formatCrmPercent(lostRecords, data.stats.total)})`}
        icon={<CircleSlash2 className="h-5 w-5" />}
      />
    </div>
  );
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

export function CrmReportCards({ data }: { data: CrmData }) {
  const recordsByOrigin = getCrmRecordsByOrigin(data);

  return (
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
  );
}
