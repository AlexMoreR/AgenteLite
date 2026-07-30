"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, MessageCircle, Pencil, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TAG_BADGE_CLASS, getTagBadgeColors } from "@/lib/tag-badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { updateCrmCollapsedAction, updateCrmStageAction } from "@/app/actions/crm-actions";
import { getContactCallHistoryAction, type CallHistoryItem } from "@/app/actions/call-actions";
import type { CrmColumn, CrmRecord } from "../types";
import { CRM_LOST_REASONS, getCrmStageMeta, getCrmLostReasonLabel } from "../domain/crm-config";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// Valor "YYYY-MM-DD" (para <input type="date">) a partir de una fecha, en hora local.
function toDateInputValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

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
  onEditWonDate,
  onOpenDetail,
}: {
  record: CrmRecord;
  isDragging: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (recordId: string) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>, recordId: string) => void;
  onDragEnd: () => void;
  onEditWonDate?: (recordId: string, dateISO: string) => void;
  onOpenDetail?: (record: CrmRecord) => void;
}) {
  return (
    <Card
      className={`relative rounded-[8px] border-0 p-1 shadow-none transition ${
        isDragging ? "cursor-grabbing opacity-60" : "cursor-grab"
      } bg-card`}
    >
      <HoverCard>
        <HoverCardTrigger className="block">
          <div
            draggable
            onDragStart={(event) => onDragStart(event, record.id)}
            onDragEnd={onDragEnd}
            onClick={() => onOpenDetail?.(record)}
          >
            <div className={isCollapsed ? "space-y-0.5" : "space-y-1"}>
              <div className="flex items-start justify-between gap-1.5 pr-6">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ContactAvatar
                    avatarUrl={record.avatarUrl}
                    label={record.name}
                    className="h-8 w-8 shrink-0 rounded-full"
                    fallbackClassName="rounded-full text-[11px]"
                  />
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate text-[13px] font-semibold leading-4 text-foreground">{record.name}</p>
                    {record.number && record.number !== record.name ? (
                      <p className="truncate text-[12px] leading-4 text-muted-foreground">{record.number}</p>
                    ) : null}
                  </div>
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

                  {/* Solo mostramos fecha en los Ganados: ahi es la fecha real de venta
                      (editable con el lapiz). En el resto de tarjetas se oculta. */}
                  {record.status === "GANADO" ? (
                    <div className="flex items-center justify-between gap-2 pt-0">
                      <span className="text-xs text-muted-foreground">
                        Venta: {formatCrmDate(record.date)}
                      </span>
                      {onEditWonDate ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onEditWonDate(record.id, record.date);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          aria-label="Editar fecha de venta"
                          title="Editar fecha de venta"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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

// Modal de detalle del lead: se abre al hacer CLIC en una tarjeta (el hover solo servía en
// escritorio y en móvil no mostraba nada). Reúne la info del Kanban + el historial de llamadas.
function KanbanDetailModal({
  record,
  onClose,
  onEditWonDate,
}: {
  record: CrmRecord;
  onClose: () => void;
  onEditWonDate: (recordId: string, dateISO: string) => void;
}) {
  const meta = getCrmStageMeta(record.status);
  const [history, setHistory] = React.useState<CallHistoryItem[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setHistory(null);
    getContactCallHistoryAction(record.id)
      .then((res) => {
        if (!cancelled) setHistory(res.items);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [record.id]);

  const nextContact = history?.find((item) => item.nextContactAt)?.nextContactAt ?? null;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogTitle className="sr-only">Detalle del lead</DialogTitle>
        <div className="space-y-3">
          {/* pr-8: deja libre la esquina superior derecha, donde el diálogo dibuja la X. */}
          <div className="flex items-start gap-3 pr-8">
            <ContactAvatar
              avatarUrl={record.avatarUrl}
              label={record.name}
              className="h-11 w-11 shrink-0 rounded-full"
              fallbackClassName="rounded-full"
            />
            {/* El badge de etapa va DEBAJO del nombre, no pegado al borde derecho: ahí vive la X
                de cerrar del diálogo y se encimaban (sobre todo en pantallas angostas). */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{record.name}</p>
              <p className="truncate text-xs text-muted-foreground">{record.number}</p>
              {meta ? (
                <span
                  className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.backgroundClassName} ${meta.borderClassName} ${meta.accentClassName}`}
                >
                  {meta.label}
                </span>
              ) : null}
            </div>
          </div>

          {/* Accesos directos: abrir el chat de esa persona (ahí también queda la nota de quién
              movió la etapa y por qué) y llamarla desde el celular. */}
          <div className="flex items-center gap-2">
            {record.chatKey ? (
              <Link
                href={`/cliente/chats?chatKey=${encodeURIComponent(record.chatKey)}`}
                className="flex-1"
              >
                <Button size="sm" className="w-full gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  Abrir chat
                </Button>
              </Link>
            ) : null}
            <a href={`tel:${record.number.replace(/[^0-9+]/g, "")}`} aria-label="Llamar">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Phone className="h-4 w-4" />
                Llamar
              </Button>
            </a>
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            {record.status === "GANADO" ? (
              <div className="flex items-center gap-2">
                <span>
                  Venta: <b className="text-foreground">{formatCrmDate(record.date)}</b>
                </span>
                <button
                  type="button"
                  onClick={() => onEditWonDate(record.id, record.date)}
                  className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" /> editar
                </button>
              </div>
            ) : (
              <p>
                Última actividad: <span className="text-foreground">{formatCrmDate(record.date)}</span>
              </p>
            )}
            {record.status === "PERDIDO" && record.lostReason ? (
              <p>
                Motivo de pérdida: <span className="text-foreground">{getCrmLostReasonLabel(record.lostReason)}</span>
              </p>
            ) : null}
            {nextContact ? (
              <p>
                Próximo contacto: <span className="text-foreground">{formatCrmDate(nextContact)}</span>
              </p>
            ) : null}
          </div>

          {record.tags.length > 0 ? (
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
          ) : null}

          {record.detail ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-foreground/80">{record.detail}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Historial de llamadas
            </p>
            {history === null ? (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin llamadas registradas.</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-foreground">
                        #{item.attemptNumber} · {item.resultLabel}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{formatCrmDate(item.calledAt)}</span>
                    </div>
                    {item.summary ? <p className="mt-0.5 text-foreground/70">{item.summary}</p> : null}
                    {item.calledByName ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">por {item.calledByName}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  // Arrastre a Ganado / edición de la fecha de venta: guardamos a quién y la fecha elegida (por
  // defecto hoy), y abrimos el diálogo para confirmar el DÍA REAL de la venta antes de guardar.
  const [pendingWonRecordId, setPendingWonRecordId] = React.useState<string | null>(null);
  const [wonDateValue, setWonDateValue] = React.useState<string>("");
  // Lead abierto en el modal de detalle (al hacer clic en una tarjeta).
  const [detailRecord, setDetailRecord] = React.useState<CrmRecord | null>(null);
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

    // Ganado pide la FECHA REAL de la venta antes de mover (Playbook: "el día del pago"). Sin esto
    // la venta quedaba fechada con la última actividad (hoy), y el reporte de "ganado hoy" mentía.
    if (nextStage === "GANADO") {
      setDraggedRecordId(null);
      setDropTargetStage(null);
      setWonDateValue(toDateInputValue(new Date()));
      setPendingWonRecordId(recordId);
      return;
    }

    await commitStageChange(recordId, nextStage);
  };

  // Confirma/edita la fecha de venta y deja el lead en Ganado. Sirve para el arrastre a Ganado y
  // para corregir la fecha desde el lápiz de la tarjeta (mismo diálogo).
  const confirmWonDate = async (recordId: string, dateStr: string) => {
    const wonAtIso = new Date(`${dateStr}T12:00:00`).toISOString();
    const currentRecord = localColumns.flatMap((column) => column.records).find((record) => record.id === recordId);
    if (!currentRecord) {
      return;
    }

    const previousColumns = localColumns;
    setSavingRecordIds((current) => ({ ...current, [recordId]: true }));

    setLocalColumns((current) =>
      current.map((column) => {
        const withoutRecord = column.records.filter((record) => record.id !== recordId);
        if (column.stage === "GANADO") {
          return { ...column, records: [...withoutRecord, { ...currentRecord, status: "GANADO", date: wonAtIso }] };
        }
        return { ...column, records: withoutRecord };
      }),
    );

    const result = await updateCrmStageAction({ contactId: recordId, status: "GANADO", wonAt: wonAtIso });

    setSavingRecordIds((current) => ({ ...current, [recordId]: false }));

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
      <div className="grid min-w-[1320px] grid-cols-6 gap-3">
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
              className={`rounded-[4px] py-2 transition ${
                isDropTarget ? "bg-muted/40 ring-1 ring-[var(--line)]" : ""
              }`}
            >
              {/* Sin contenedor de color: la columna es transparente y solo el header
                  lleva un acento sutil. Las tarjetas ocupan todo el ancho. */}
              <div
                className={`flex items-center justify-between gap-2 border-b-2 ${meta.borderClassName} px-2 pb-2`}
              >
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${meta.accentClassName}`}>
                  {column.records.length}
                </span>
              </div>

              <div className="mt-2 space-y-1">
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
                      onEditWonDate={(recordId, dateISO) => {
                        setWonDateValue(toDateInputValue(dateISO));
                        setPendingWonRecordId(recordId);
                      }}
                      onOpenDetail={(nextRecord) => setDetailRecord(nextRecord)}
                    />
                  ))
                ) : (
                <div className="mx-2 rounded-[12px] border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
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

      <Dialog
        open={Boolean(pendingWonRecordId)}
        onOpenChange={(next) => {
          if (!next) setPendingWonRecordId(null);
        }}
      >
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-sm gap-0 overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3">
            <DialogTitle className="text-[13px] font-semibold text-foreground">Fecha de la venta</DialogTitle>
          </div>
          <div className="space-y-3 px-4 py-4">
            <p className="text-[12px] text-muted-foreground">
              ¿Qué día se cerró la venta (el pago)? Podés poner una fecha pasada.
            </p>
            <input
              type="date"
              value={wonDateValue}
              onChange={(event) => setWonDateValue(event.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingWonRecordId(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!wonDateValue}
                onClick={() => {
                  const recordId = pendingWonRecordId;
                  setPendingWonRecordId(null);
                  if (recordId && wonDateValue) {
                    void confirmWonDate(recordId, wonDateValue);
                  }
                }}
              >
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {detailRecord ? (
        <KanbanDetailModal
          record={detailRecord}
          onClose={() => setDetailRecord(null)}
          onEditWonDate={(recordId, dateISO) => {
            setDetailRecord(null);
            setWonDateValue(toDateInputValue(dateISO));
            setPendingWonRecordId(recordId);
          }}
        />
      ) : null}
    </div>
  );
}
