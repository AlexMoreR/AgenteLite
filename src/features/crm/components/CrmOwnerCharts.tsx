"use client";

import * as React from "react";
import { TrendingDown, CircleSlash2 } from "lucide-react";
import { CRM_STAGE_META, getCrmLostReasonLabel } from "../domain/crm-config";
import type { CrmRecord, CrmStage } from "../types";

// Orden lineal del embudo. PERDIDO queda fuera: es una salida lateral y ademas el registro no
// guarda hasta que etapa habia llegado antes de perderse.
const FUNNEL_STAGES: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO"];

function formatPct(part: number, whole: number) {
  if (whole <= 0) return "0%";
  return `${Math.round((part * 100) / whole)}%`;
}

/**
 * Embudo de conversion: cuantos leads ALCANZARON cada etapa y el % que paso de una a la
 * siguiente. Responde la pregunta del dueno "¿donde se caen las ventas?". Como crmStage es la
 * etapa ACTUAL (un lead en Negociacion ya paso por Calificado y Cotizado), "alcanzo la etapa i"
 * = esta en la etapa i o mas adelante.
 */
export function CrmConversionFunnel({ records }: { records: CrmRecord[] }) {
  const reached = React.useMemo(() => {
    const stageIndex = (stage: CrmStage) => FUNNEL_STAGES.indexOf(stage);
    return FUNNEL_STAGES.map((stage, index) =>
      records.filter((record) => {
        const recordIndex = stageIndex(record.status);
        return recordIndex >= index && recordIndex >= 0; // excluye PERDIDO (index -1)
      }).length,
    );
  }, [records]);

  const total = reached[0] ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Embudo de conversión</h3>
        <span className="text-[11px] text-muted-foreground">dónde se caen las ventas</span>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sin leads en el rango elegido.</p>
      ) : (
        <div className="space-y-2">
          {FUNNEL_STAGES.map((stage, index) => {
            const meta = CRM_STAGE_META[stage];
            const count = reached[index] ?? 0;
            const widthPct = total > 0 ? Math.max((count * 100) / total, 2) : 0;
            const prev = index > 0 ? reached[index - 1] ?? 0 : null;
            return (
              <div key={stage} className="space-y-0.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-foreground">{meta.label}</span>
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{count}</span>
                    {prev !== null ? <span className="ml-1.5">({formatPct(count, prev)} del paso anterior)</span> : null}
                  </span>
                </div>
                <div className="h-6 w-full overflow-hidden rounded-md bg-muted">
                  <div
                    className={`flex h-full items-center rounded-md ${meta.backgroundClassName} ${meta.borderClassName} border`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-[11px] text-muted-foreground">
            De {total} leads, {reached[FUNNEL_STAGES.indexOf("GANADO")] ?? 0} llegaron a la venta
            ({formatPct(reached[FUNNEL_STAGES.indexOf("GANADO")] ?? 0, total)}).
          </p>
        </div>
      )}
    </div>
  );
}

/** Top de razones por las que se pierden los leads. Se llena cuando la vendedora descarta con motivo. */
export function CrmLostReasons({ records }: { records: CrmRecord[] }) {
  const reasons = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      if (record.status !== "PERDIDO") continue;
      const label = getCrmLostReasonLabel(record.lostReason) ?? "Sin motivo";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [records]);

  const total = reasons.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <CircleSlash2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Por qué se pierden</h3>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Aún no hay leads descartados con motivo. Aparecen acá cuando la vendedora marca un lead
          como “Descartado” y elige por qué.
        </p>
      ) : (
        <div className="space-y-2">
          {reasons.map(([label, count]) => (
            <div key={label} className="space-y-0.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-muted-foreground">
                  <span className="font-semibold text-foreground">{count}</span> ({formatPct(count, total)})
                </span>
              </div>
              <div className="h-5 w-full overflow-hidden rounded-md bg-muted">
                <div className="h-full rounded-md bg-rose-200 dark:bg-rose-500/30" style={{ width: `${Math.max((count * 100) / total, 2)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
