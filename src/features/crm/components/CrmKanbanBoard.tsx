"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CrmColumn, CrmRecord } from "../types";
import { getCrmStageMeta } from "../domain/crm-config";

function formatCrmDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
  })
    .format(new Date(value))
    .replace(/\u00A0/g, " ");
}

function KanbanCard({ record }: { record: CrmRecord }) {
  const meta = getCrmStageMeta(record.status);

  return (
    <Card className="rounded-[20px] border border-[var(--line)] p-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-26px_rgba(15,23,42,0.16)]">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{record.name}</p>
            <p className="text-xs text-slate-500">{record.number}</p>
          </div>
          <Badge
            variant="outline"
            className={`h-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
          >
            {meta.label}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {record.tags.map((tag) => (
            <span
              key={`${record.id}:${tag.label}`}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.label}
            </span>
          ))}
        </div>

        <p className="line-clamp-3 text-sm leading-6 text-slate-600">{record.detail}</p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-500">{formatCrmDate(record.date)}</span>
          <span className="text-xs font-medium text-slate-500">Actualizado</span>
        </div>
      </div>
    </Card>
  );
}

export function CrmKanbanBoard({ columns }: { columns: CrmColumn[] }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1320px] grid-cols-6 gap-4">
        {columns.map((column) => {
          const meta = getCrmStageMeta(column.stage);

          return (
            <section
              key={column.stage}
              className={`rounded-[24px] border ${meta.borderClassName} ${meta.backgroundClassName} p-4`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">{column.title}</h3>
                  <p className="text-xs text-slate-500">{column.records.length} oportunidades</p>
                </div>
                <Badge
                  variant="outline"
                  className={`h-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} bg-white ${meta.accentClassName}`}
                >
                  {column.records.length}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                {column.records.length > 0 ? (
                  column.records.map((record) => <KanbanCard key={record.id} record={record} />)
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
                    Sin registros en esta columna.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
