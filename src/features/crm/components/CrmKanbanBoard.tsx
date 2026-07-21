"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS, getTagBadgeColors } from "@/lib/tag-badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { updateCrmCollapsedAction, updateCrmStageAction } from "@/app/actions/crm-actions";
import type { CrmColumn, CrmRecord } from "../types";
import { CRM_LOST_REASONS, getCrmStageMeta } from "../domain/crm-config";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const CRM_STAGE_DARK_SURFACE_CLASS: Record<CrmColumn["stage"], string> = {
  NUEVO: "dark:border-violet-500/25 dark:bg-violet-500/10",
  CALIFICADO: "dark:border-cyan-500/25 dark:bg-cyan-500/10",
  PROPUESTA: "dark:border-amber-500/25 dark:bg-amber-500/10",
  NEGOCIACION: "dark:border-rose-500/25 dark:bg-rose-500/10",
  GANADO: "dark:border-emerald-500/25 dark:bg-emerald-500/10",
  PERDIDO: "dark:border-violet-500/25 dark:bg-violet-500/10",
};

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
      } bg-card`}
    >
      <HoverCard>
        <HoverCardTrigger className="block">
          <div draggable onDragStart={(event) => onDragStart(event, record.id)} onDragEnd={onDragEnd}>
            <div className={isCollapsed ? "space-y-0.5" : "space-y-1"}>
              <div className="flex items-start justify-between gap-1.5 pr-6">
                <div className="flex min-w-0 items-center gap-2">
                  <ContactAvatar
                    avatarUrl={record.avatarUrl}
                    label={record.name}
                    className="h-7 w-7 shrink-0 rounded-full"
                    fallbackClassName="rounded-full text-[10px]"
                  />
                  <p className="truncate text-[13px] font-semibold leading-4 text-foreground">{record.name}</p>
                </div>
              </div>

              {!isCollapsed ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {record.tags.map((tag) => (
                      <span
                        key={`${record.id}:${tag.label}`}
                        className={`inline-flex max-w-full items-center ${TAG_BADGE_CLASS}`}
                        style={getTagBadgeColors(tag.color)}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-0">
                    <span className="text-xs text-muted-foreground">{formatCrmDate(record.date)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-72 border border-[var(--line)] bg-popover p-3 text-popover-foreground shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]">
          <div className="space-y-2">
            <p className="truncate text-[13px] font-semibold text-foreground">{record.name}</p>
            <p className="text-[12px] text-muted-foreground">{record.number}</p>
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/80">{record.detail}</p>
            <p className="text-[12px] text-muted-foreground">{formatCrmDateTime(record.date)}</p>
          </div>
        </HoverCardContent>
      </HoverCard>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 top-1 h-5 w-5 rounded-full border border-[var(--line)] bg-background/90 text-muted-foreground shadow-none hover:bg-background"
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
  // Arrastre a Descartado en espera del motivo (mismo flujo que el selector del chat): guardamos
  // a quien mover y abrimos el dialogo de razon en vez de cerrar de una.
  const [pendingLostRecordId, setPendingLostRecordId] = React.useState<string | null>(null);
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

  const commitStageChange = async (
    recordId: string,
    nextStage: CrmColumn["stage"],
    lostReason?: string,
  ) => {
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
      lostReason,
    });

    setSavingRecordIds((current) => ({ ...current, [recordId]: false }));
    setDraggedRecordId(null);
    setDropTargetStage(null);

    if ("error" in result) {
      setLocalColumns(previousColumns);
    }
  };

  const handleDrop = async (recordId: string, nextStage: CrmColumn["stage"]) => {
    const currentRecord = localColumns.flatMap((column) => column.records).find((record) => record.id === recordId);

    if (!currentRecord || currentRecord.status === nextStage) {
      return;
    }

    // Descartar pide el motivo antes de mover, igual que el selector del chat. Sin el motivo el
    // informe de razones de perdida queda vacio, y ese "por que" es el unico dato que la maquina
    // no puede deducir. Se limpia el estado de arrastre para que la tarjeta no quede "pegada".
    if (nextStage === "PERDIDO") {
      setDraggedRecordId(null);
      setDropTargetStage(null);
      setPendingLostRecordId(recordId);
      return;
    }

    await commitStageChange(recordId, nextStage);
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
              className={`rounded-[4px] border ${meta.borderClassName} ${meta.backgroundClassName} ${CRM_STAGE_DARK_SURFACE_CLASS[column.stage]} p-2 transition ${
                isDropTarget ? "ring-2 ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
                </div>
                <Badge
                  variant="outline"
                  className={`h-auto rounded-full border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} bg-background/90 ${meta.accentClassName}`}
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
                <div className="rounded-[12px] border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                    Sin registros en esta columna.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog
        open={Boolean(pendingLostRecordId)}
        onOpenChange={(next) => {
          if (!next) setPendingLostRecordId(null);
        }}
      >
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-sm gap-0 overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3">
            <DialogTitle className="text-[13px] font-semibold text-foreground">¿Por qué se perdió?</DialogTitle>
          </div>
          <div className="py-1">
            {CRM_LOST_REASONS.map((reason) => (
              <button
                key={reason.value}
                type="button"
                onClick={() => {
                  const recordId = pendingLostRecordId;
                  setPendingLostRecordId(null);
                  if (recordId) {
                    void commitStageChange(recordId, "PERDIDO", reason.value);
                  }
                }}
                className="flex w-full items-center px-4 py-2.5 text-left text-[13px] text-foreground transition hover:bg-muted"
              >
                {reason.label}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
