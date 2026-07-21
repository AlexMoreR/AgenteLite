"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CRM_STAGE_ORDER, getCrmStageLabel } from "../domain/crm-config";
import type { CrmData, CrmRecord } from "../types";
import { CrmReportCards, CrmReportStatsCards } from "./CrmPagePrimitives";
import { CrmTodayChart } from "./CrmReportCharts";
import { CrmConversionFunnel, CrmLostReasons } from "./CrmOwnerCharts";

type DateRange = "1" | "7" | "15" | "30" | "__all__";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "1": "1 Dia",
  "7": "7 Dias",
  "15": "15 Dias",
  "30": "30 Dias",
  __all__: "Todos",
};

const DATE_RANGE_ORDER: DateRange[] = ["1", "7", "15", "30", "__all__"];

function getBogotaDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function CrmTodayCard({ data }: { data: CrmData }) {
  const today = React.useMemo(() => {
    const todayKey = getBogotaDay(data.generatedAt);
    const todayRecords = data.records.filter((record) => getBogotaDay(record.date) === todayKey);

    const countByStage = (status: CrmRecord["status"]) =>
      todayRecords.filter((record) => record.status === status).length;

    return {
      total: todayRecords.length,
      nuevos: countByStage("NUEVO"),
      ganados: countByStage("GANADO"),
      descartados: countByStage("PERDIDO"),
    };
  }, [data]);

  return (
    <CrmTodayChart
      total={today.total}
      nuevos={today.nuevos}
      ganados={today.ganados}
      descartados={today.descartados}
    />
  );
}

export function CrmInformeView({ data }: { data: CrmData }) {
  // Abre en "Todos": el informe del dueno es acumulado (el embudo completo, dónde se caen las
  // ventas). El rango sigue disponible para acotar a un periodo.
  const [dateRange, setDateRange] = React.useState<DateRange>("__all__");

  const filteredData = React.useMemo<CrmData>(() => {
    const maxAgeDays = dateRange === "__all__" ? null : Number(dateRange);
    const now = new Date(data.generatedAt).getTime();

    const records =
      maxAgeDays === null
        ? data.records
        : data.records.filter((record) => {
            const ageDays = (now - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24);
            return ageDays <= maxAgeDays;
          });

    const countByStage = (status: CrmRecord["status"]) =>
      records.filter((record) => record.status === status).length;

    const columns = CRM_STAGE_ORDER.map((stage) => ({
      stage,
      title: getCrmStageLabel(stage),
      records: records.filter((record) => record.status === stage),
    }));

    const won = countByStage("GANADO");
    const lost = countByStage("PERDIDO");

    return {
      ...data,
      records,
      columns,
      stats: {
        total: records.length,
        active: records.length - won - lost,
        won,
        lost,
      },
    };
  }, [data, dateRange]);

  return (
    <div className="space-y-3">
      <CrmReportStatsCards data={filteredData} />

      <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            Rango de fechas
          </span>
          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-40" aria-label="Filtrar por rango de dias">
              <SelectValue>{(value) => DATE_RANGE_LABELS[value as DateRange] ?? "Todos"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_ORDER.map((value) => (
                <SelectItem key={value} value={value}>
                  {DATE_RANGE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <CrmConversionFunnel records={filteredData.records} />
        <CrmLostReasons records={filteredData.records} />
      </div>

      <CrmReportCards data={filteredData} />

      <CrmTodayCard data={data} />
    </div>
  );
}
