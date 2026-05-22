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

function getTagStyle(color?: string | null) {
  const normalized = color?.trim();

  return {
    backgroundColor: normalized || "var(--primary)",
  };
}

function KanbanCard({ record }: { record: CrmRecord }) {
  return (
  <Card className="rounded-[8px] border border-[var(--line)] p-1.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-26px_rgba(15,23,42,0.16)]">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-4 text-slate-950">{record.name}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {record.tags.map((tag) => (
            <span
              key={`${record.id}:${tag.label}`}
              className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
              style={getTagStyle(tag.color)}
            >
              {tag.label}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0">
          <span className="text-xs text-slate-500">{formatCrmDate(record.date)}</span>
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
              className={`rounded-[12px] border ${meta.borderClassName} ${meta.backgroundClassName} p-2`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">{column.title}</h3>
                </div>
                <Badge
                  variant="outline"
                  className={`h-auto rounded-full border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} bg-white ${meta.accentClassName}`}
                >
                  {column.records.length}
                </Badge>
              </div>

              <div className="mt-2 space-y-2">
                {column.records.length > 0 ? (
                  column.records.map((record) => <KanbanCard key={record.id} record={record} />)
                ) : (
                <div className="rounded-[12px] border border-dashed border-slate-200 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
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
