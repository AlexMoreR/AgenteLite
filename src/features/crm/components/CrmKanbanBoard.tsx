"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { updateCrmCollapsedAction, updateCrmStageAction } from "@/app/actions/crm-actions";
import type { CrmColumn, CrmRecord } from "../types";
import { getCrmStageMeta } from "../domain/crm-config";

function formatCrmDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
  })
    .format(new Date(value))
    .replace(/\u00A0/g, " ");
}

function formatCrmDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
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

function KanbanCard({
  record,
  isDragging,
  isCollapsed,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
}: {
  record: CrmRecord;
  isDragging: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (recordId: string) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>, recordId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <Card
      className={`relative rounded-[8px] border border-[var(--line)] p-1.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-26px_rgba(15,23,42,0.16)] ${
        isDragging ? "cursor-grabbing opacity-60" : "cursor-grab"
      }`}
    >
      <HoverCard>
        <HoverCardTrigger className="block">
          <div draggable onDragStart={(event) => onDragStart(event, record.id)} onDragEnd={onDragEnd}>
            <div className={isCollapsed ? "space-y-0.5" : "space-y-1"}>
              <div className="flex items-start justify-between gap-1.5 pr-6">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-4 text-slate-950">{record.name}</p>
                </div>
              </div>

              {!isCollapsed ? (
                <>
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
                </>
              ) : null}
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-72 border border-[var(--line)] bg-white p-3 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]">
          <div className="space-y-2">
            <p className="truncate text-[13px] font-semibold text-slate-950">{record.name}</p>
            <p className="text-[12px] text-slate-500">{record.number}</p>
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-slate-700">{record.detail}</p>
            <p className="text-[12px] text-slate-500">{formatCrmDateTime(record.date)}</p>
          </div>
        </HoverCardContent>
      </HoverCard>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 top-1 h-5 w-5 rounded-full border border-[var(--line)] bg-white/90 text-slate-500 shadow-none hover:bg-white"
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapse(record.id);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        aria-label={isCollapsed ? `Expandir ${record.name}` : `Recoger ${record.name}`}
      >
        {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </Button>
    </Card>
  );
}

export function CrmKanbanBoard({ columns }: { columns: CrmColumn[] }) {
  const [localColumns, setLocalColumns] = React.useState(columns);
  const [draggedRecordId, setDraggedRecordId] = React.useState<string | null>(null);
  const [savingRecordIds, setSavingRecordIds] = React.useState<Record<string, boolean>>({});
  const [dropTargetStage, setDropTargetStage] = React.useState<CrmColumn["stage"] | null>(null);
  const [collapsedRecordIds, setCollapsedRecordIds] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      columns.flatMap((column) =>
        column.records.map((record) => [record.id, Boolean(record.isCollapsed)] as const),
      ),
    ),
  );

  React.useEffect(() => {
    setLocalColumns(columns);
  }, [columns]);

  React.useEffect(() => {
    setCollapsedRecordIds(
      Object.fromEntries(
        columns.flatMap((column) =>
          column.records.map((record) => [record.id, Boolean(record.isCollapsed)] as const),
        ),
      ),
    );
  }, [columns]);

  const handleDrop = async (recordId: string, nextStage: CrmColumn["stage"]) => {
    const currentRecord = localColumns.flatMap((column) => column.records).find((record) => record.id === recordId);

    if (!currentRecord || currentRecord.status === nextStage) {
      return;
    }

    const previousColumns = localColumns;
    setSavingRecordIds((current) => ({ ...current, [recordId]: true }));

    setLocalColumns((current) =>
      current.map((column) => ({
        ...column,
        records:
          column.stage === currentRecord.status
            ? column.records.filter((record) => record.id !== recordId)
            : column.stage === nextStage
              ? [...column.records, { ...currentRecord, status: nextStage }]
              : column.records,
      })),
    );

    const result = await updateCrmStageAction({
      contactId: recordId,
      status: nextStage,
    });

    setSavingRecordIds((current) => ({ ...current, [recordId]: false }));
    setDraggedRecordId(null);
    setDropTargetStage(null);

    if ("error" in result) {
      setLocalColumns(previousColumns);
    }
  };

  const handleToggleCollapse = async (recordId: string) => {
    const nextCollapsed = !collapsedRecordIds[recordId];
    const previousCollapsed = collapsedRecordIds[recordId] ?? false;

    setCollapsedRecordIds((current) => ({
      ...current,
      [recordId]: nextCollapsed,
    }));

    const result = await updateCrmCollapsedAction({
      contactId: recordId,
      collapsed: nextCollapsed,
    });

    if ("error" in result) {
      setCollapsedRecordIds((current) => ({
        ...current,
        [recordId]: previousCollapsed,
      }));
    }
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1320px] grid-cols-6 gap-0">
        {localColumns.map((column) => {
          const meta = getCrmStageMeta(column.stage);
          const isDropTarget = dropTargetStage === column.stage;

          return (
            <section
              key={column.stage}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTargetStage(column.stage);
              }}
              onDragLeave={() => {
                setDropTargetStage((current) => (current === column.stage ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const recordId = event.dataTransfer.getData("text/plain");

                if (recordId) {
                  void handleDrop(recordId, column.stage);
                }
              }}
              className={`rounded-[4px] border ${meta.borderClassName} ${meta.backgroundClassName} p-2 transition ${
                isDropTarget ? "ring-2 ring-offset-2 ring-offset-white" : ""
              }`}
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
                  column.records.map((record) => (
                    <KanbanCard
                      key={record.id}
                      record={record}
                      isDragging={draggedRecordId === record.id || Boolean(savingRecordIds[record.id])}
                      isCollapsed={Boolean(collapsedRecordIds[record.id])}
                      onToggleCollapse={(recordId) => {
                        void handleToggleCollapse(recordId);
                      }}
                      onDragStart={(event, recordId) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", recordId);
                        setDraggedRecordId(recordId);
                      }}
                      onDragEnd={() => {
                        setDraggedRecordId(null);
                        setDropTargetStage(null);
                      }}
                    />
                  ))
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
