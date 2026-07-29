"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CRM_STAGE_ORDER, getCrmStageLabel } from "../domain/crm-config";
import type { CrmData, CrmRecord } from "../types";
import { CrmReportCards, CrmReportStatsCards } from "./CrmPagePrimitives";
import { CrmTodayChart } from "./CrmReportCharts";
import { CrmConversionFunnel, CrmLostReasons } from "./CrmOwnerCharts";
import { CrmFugaPanel } from "./CrmFugaPanel";

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
    const dentroDelRango = (iso: string) =>
      maxAgeDays === null || (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24) <= maxAgeDays;

    // El rango filtra por fecha de ENTRADA, no por ultima actividad. Antes filtraba por
    // actividad y eso contaba el MISMO lead una vez por cada dia que alguien le tocaba la
    // ficha: "1 Dia" mostraba hasta 48% mas leads de los que realmente habian entrado, y la
    // conversion (ventas / leads) salia mas baja de lo que era.
    const records =
      maxAgeDays === null ? data.records : data.records.filter((record) => dentroDelRango(record.enteredAt));

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

  // Leads TRABAJADOS: los que tuvieron movimiento en el rango, sin importar cuando entraron.
  // Es el numero que antes se mezclaba con el de arriba; ahora va aparte y con nombre propio,
  // porque responde otra pregunta: no "cuantos llegaron" sino "a cuantos les pusimos la mano".
  // Se calcula sobre TODOS los leads a proposito: casi siempre son de dias anteriores.
  const trabajados = React.useMemo(() => {
    const maxAgeDays = dateRange === "__all__" ? null : Number(dateRange);
    if (maxAgeDays === null) {
      return null;
    }
    const now = new Date(data.generatedAt).getTime();
    return data.records.filter(
      (record) => (now - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24) <= maxAgeDays,
    ).length;
  }, [data, dateRange]);

  return (
    <div className="space-y-3">
      <CrmReportStatsCards data={filteredData} isRanged={dateRange !== "__all__"} />

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
        {trabajados !== null ? (
          <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
            {/* Las tarjetas de arriba miran SOLO a los leads que entraron en el rango. Sin decirlo,
                "Descartados 1" se leia como "hoy descartamos 1" y no como "de los que entraron
                hoy, 1 ya se descartó". */}
            <p>
              Entraron{" "}
              <span className="font-semibold text-foreground">{filteredData.records.length}</span>{" "}
              {filteredData.records.length === 1 ? "lead nuevo" : "leads nuevos"}. Las cifras de
              arriba son de ellos: cuántos siguen activos, cuántos ya compraron y cuántos se
              descartaron.
            </p>
            <p>
              Aparte, se le escribió o se movió la ficha a{" "}
              <span className="font-semibold text-foreground">{trabajados}</span>{" "}
              {trabajados === 1 ? "lead" : "leads"}, contando los que ya venían de antes.
            </p>
          </div>
        ) : null}
      </div>

      {/* Sobre TODOS los leads vivos, no sobre el rango: un lead que entro hace 20 dias y
          esta parado es exactamente el que hay que ver, y el rango lo escondia. */}
      <CrmFugaPanel records={data.records} generatedAt={data.generatedAt} />

      <div className="grid gap-3 xl:grid-cols-2">
        <CrmConversionFunnel records={filteredData.records} />
        <CrmLostReasons records={filteredData.records} />
      </div>

      <CrmReportCards data={filteredData} />

      <CrmTodayCard data={data} />
    </div>
  );
}
