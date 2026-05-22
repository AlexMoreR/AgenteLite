"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, ChartNoAxesCombined, Copy, Eye, FileText, Hash, MoreHorizontal, Search, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { CRM_STAGE_ORDER, getCrmStageMeta, getCrmStageLabel } from "../domain/crm-config";
import type { CrmRecord, CrmStage } from "../types";

type SortKey = "numero" | "nombre" | "fecha" | "estado";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 10;
const nativeSelectBaseClassName =
  "w-full rounded-lg border border-[var(--line)] bg-white pr-10 pl-2.5 text-sm text-slate-700 outline-none transition focus:border-[var(--line-strong)]";

function formatCrmDate(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = getPart("day");
  const month = getPart("month");
  const year = getPart("year");
  const hour = String(Number(getPart("hour")));
  const minute = getPart("minute");
  const dayPeriod = getPart("dayPeriod").toLowerCase();

  return `${day}/${month}/${year} ${hour}:${minute} ${dayPeriod}`;
}

function formatCrmDateShort(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("day")}/${getPart("month")}/${getPart("year")}`;
}

function HeaderLabel({
  children,
  active,
  direction,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-[13px] font-normal text-slate-600 transition hover:text-slate-900"
      onClick={onClick}
      aria-label={`Ordenar por ${String(children)}`}
    >
      <span className="text-slate-500">{icon}</span>
      {children}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5 text-slate-700" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5 text-slate-700" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />
      )}
    </button>
  );
}

function getRecordStateLabel(record: CrmRecord) {
  return getCrmStageLabel(record.status);
}

function getTagStyle(color?: string | null) {
  const normalized = color?.trim();

  return {
    backgroundColor: normalized || "var(--primary)",
  };
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CrmRegistroTable({
  records,
  referenceNow,
}: {
  records: CrmRecord[];
  referenceNow: string;
}) {
  const [editableRecords, setEditableRecords] = React.useState(records);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<CrmStage | "__all__">("__all__");
  const [dateRangeFilter, setDateRangeFilter] = React.useState<"1" | "7" | "15" | "30" | "__all__">("1");
  const [sortKey, setSortKey] = React.useState<SortKey>("fecha");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");
  const [page, setPage] = React.useState(1);
  const [copiedField, setCopiedField] = React.useState<string | null>(null);
  const [savingContactIds, setSavingContactIds] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setEditableRecords(records);
  }, [records]);

  const statusOptions = React.useMemo(() => {
    return CRM_STAGE_ORDER.map((value) => ({ value, label: getCrmStageLabel(value) }));
  }, []);

  const filteredRecords = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const maxAgeDays = dateRangeFilter === "__all__" ? null : Number(dateRangeFilter);
    const now = new Date(referenceNow).getTime();

    return editableRecords.filter((record) => {
      const recordAgeDays = (now - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24);
      const haystack = [
        record.number,
        record.name,
        record.detail,
        getRecordStateLabel(record),
        ...record.tags.map((tag) => tag.label),
      ]
        .join(" ")
        .toLowerCase();

      const queryMatches = !normalizedQuery || haystack.includes(normalizedQuery);
      const statusMatches = statusFilter === "__all__" || record.status === statusFilter;
      const dateMatches = maxAgeDays === null || recordAgeDays <= maxAgeDays;

      return queryMatches && statusMatches && dateMatches;
    });
  }, [dateRangeFilter, editableRecords, query, referenceNow, statusFilter]);

  const sortedRecords = React.useMemo(() => {
    const list = [...filteredRecords];
    const directionFactor = sortDirection === "asc" ? 1 : -1;
    const textCompare = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

    list.sort((a, b) => {
      switch (sortKey) {
        case "numero":
          return textCompare(a.number, b.number) * directionFactor;
        case "nombre":
          return textCompare(a.name, b.name) * directionFactor;
        case "fecha":
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * directionFactor;
        case "estado":
          return textCompare(getRecordStateLabel(a), getRecordStateLabel(b)) * directionFactor;
        default:
          return 0;
      }
    });

    return list;
  }, [filteredRecords, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage(1);
  }, [query, statusFilter, dateRangeFilter]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedRecords = sortedRecords.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = sortedRecords.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, sortedRecords.length);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  };

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("__all__");
    setDateRangeFilter("1");
  };

  const handleCopy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1200);
  };

  const handleChangeStatus = async (recordId: string, nextStatus: CrmStage) => {
    const previousRecord = editableRecords.find((record) => record.id === recordId);
    if (!previousRecord) {
      return;
    }

    setEditableRecords((current) =>
      current.map((record) => (record.id === recordId ? { ...record, status: nextStatus } : record)),
    );

    setSavingContactIds((current) => ({ ...current, [recordId]: true }));

    const result = await updateCrmStageAction({
      contactId: recordId,
      status: nextStatus,
    });

    setSavingContactIds((current) => ({ ...current, [recordId]: false }));

    if ("error" in result) {
      setEditableRecords((current) =>
        current.map((record) => (record.id === recordId ? { ...record, status: previousRecord.status } : record)),
      );
    }
  };

  const exportCsv = () => {
    const lines = [
      ["Numero", "Nombre", "Fecha", "Etiquetas", "Detalle", "Estado"].join(","),
      ...sortedRecords.map((record) =>
        [
          record.number,
          record.name,
          formatCrmDate(record.date),
          record.tags.map((tag) => tag.label).join(" | "),
          record.detail,
          getRecordStateLabel(record),
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];

    const stamp = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("/", "-");

    downloadTextFile(`crm-registro-${stamp}.csv`, `${lines.join("\n")}\n`, "text/csv;charset=utf-8");
  };

  return (
    <div className="space-y-3">
      <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por numero, nombre, detalle o etiqueta"
            className="h-9 pr-9 pl-9 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Limpiar busqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CrmStage | "__all__")}
            className={`${nativeSelectBaseClassName} h-9 sm:min-w-40 sm:w-auto`}
            aria-label="Filtrar por estado"
          >
            <option value="__all__">Estados</option>
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            value={dateRangeFilter}
            onChange={(event) => setDateRangeFilter(event.target.value as "__all__" | "1" | "7" | "15" | "30")}
            className={`${nativeSelectBaseClassName} h-9 sm:min-w-40 sm:w-auto`}
            aria-label="Filtrar por rango de dias"
          >
            <option value="1">1 Dia</option>
            <option value="7">7 Dias</option>
            <option value="15">15 Dias</option>
            <option value="30">30 Dias</option>
            <option value="__all__">Todos</option>
          </select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs"
            onClick={clearFilters}
            disabled={!query && statusFilter === "__all__"}
          >
            Limpiar filtros
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
            onClick={exportCsv}
          >
            Exportar CSV
          </Button>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {pagedRecords.length === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-6 text-center text-sm text-slate-500">
            No hay registros para el filtro actual.
          </div>
        ) : (
          pagedRecords.map((record) => {
            const meta = getCrmStageMeta(record.status);

            return (
              <article key={record.id} className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-900">{record.name}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500">{record.number}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`h-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
                  >
                    {meta.label}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {record.tags.map((tag) => (
                    <span
                      key={`${record.id}:${tag.label}`}
                      className="inline-flex max-w-full items-center rounded-full px-2.5 py-0.75 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                      style={getTagStyle(tag.color)}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>

                <p className="mt-3 truncate text-[13px] leading-6 text-slate-600">{record.detail}</p>

                <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[13px] text-slate-500">{formatCrmDateShort(record.date)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                      onClick={() => void handleCopy(record.name, `name-${record.id}`)}
                      aria-label={`Copiar nombre de ${record.name}`}
                    >
                      <Copy className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                      aria-label={`Ver ${record.name}`}
                    >
                      <Eye className="h-4 w-4 text-slate-600" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-[var(--line)] bg-white md:block">
        <Table className="min-w-[1120px]">
          <TableHeader>
            <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "fecha"}
                  direction={sortDirection}
                  onClick={() => toggleSort("fecha")}
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                >
                  Fecha
                </HeaderLabel>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "numero"}
                  direction={sortDirection}
                  onClick={() => toggleSort("numero")}
                  icon={<Hash className="h-3.5 w-3.5" />}
                >
                  Numero
                </HeaderLabel>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "nombre"}
                  direction={sortDirection}
                  onClick={() => toggleSort("nombre")}
                  icon={<Eye className="h-3.5 w-3.5" />}
                >
                  Nombre
                </HeaderLabel>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <span className="inline-flex items-center gap-2 text-[13px] font-normal text-slate-600">
                  <Tag className="h-3.5 w-3.5 text-slate-500" />
                  Etiquetas
                </span>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <span className="inline-flex items-center gap-2 text-[13px] font-normal text-slate-600">
                  <FileText className="h-3.5 w-3.5 text-slate-500" />
                  Detalle
                </span>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "estado"}
                  direction={sortDirection}
                  onClick={() => toggleSort("estado")}
                  icon={<ChartNoAxesCombined className="h-3.5 w-3.5" />}
                >
                  Estado
                </HeaderLabel>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="px-1.5 py-0.5 text-center text-slate-500">
                  No hay registros para el filtro actual.
                </TableCell>
              </TableRow>
            ) : (
              pagedRecords.map((record) => {
                const meta = getCrmStageMeta(record.status);

                return (
                  <TableRow key={record.id}>
                    <TableCell className="px-1.5 py-0.5 text-[13px] text-slate-600">
                      <HoverCard>
                        <HoverCardTrigger className="inline-flex cursor-help items-center">
                          {formatCrmDateShort(record.date)}
                        </HoverCardTrigger>
                        <HoverCardContent
                          className="w-fit border border-[var(--line)] bg-white p-3 text-[13px] leading-6 text-slate-700 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]"
                          style={{ width: "fit-content" }}
                        >
                          <p className="whitespace-pre-wrap text-[13px]">{formatCrmDate(record.date)}</p>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    <TableCell className="px-1.5 py-0.5 text-[13px] font-medium text-slate-900">{record.number}</TableCell>
                    <TableCell className="px-1.5 py-0.5 text-[13px] text-slate-700">{record.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {record.tags.map((tag) => (
                          <span
                            key={`${record.id}:${tag.label}`}
                            className="inline-flex max-w-full items-center rounded-full px-2.5 py-0.75 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                            style={getTagStyle(tag.color)}
                          >
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[18rem] px-1.5 py-0.5 text-[13px] leading-5 text-slate-600">
                      <HoverCard>
                        <HoverCardTrigger className="block w-full cursor-help truncate text-left">
                          {record.detail}
                        </HoverCardTrigger>
                        <HoverCardContent className="max-w-md border border-[var(--line)] bg-white p-3 text-[12px] leading-6 text-slate-700 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Detalle completo</p>
                          <p className="mt-2 whitespace-pre-wrap text-[13px]">{record.detail}</p>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    <TableCell className="px-1.5 py-0.5">
                      <Select
                        value={record.status}
                        onValueChange={(value) => handleChangeStatus(record.id, value as CrmStage)}
                        disabled={savingContactIds[record.id]}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Cambiar estado de ${record.name}`}
                          className={`h-8 min-w-28 rounded-sm border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
                        >
                          <SelectValue placeholder={meta.label} />
                        </SelectTrigger>
                        <SelectContent align="end" className="min-w-36 rounded-lg">
                          {statusOptions.map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-1.5 py-0.5">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                          onClick={() => void handleCopy(record.name, `desktop-name-${record.id}`)}
                          aria-label={`Copiar nombre de ${record.name}`}
                        >
                          <Copy className="h-4 w-4 text-slate-600" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                          aria-label={`Ver ${record.name}`}
                        >
                          <Eye className="h-4 w-4 text-slate-600" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                              aria-label={`Mas acciones de ${record.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
                            <DropdownMenuItem onSelect={() => void handleCopy(record.detail, `detail-${record.id}`)} className="gap-2">
                              <Copy className="h-4 w-4" />
                              Copiar detalle
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild className="gap-2">
                              <Link href="/cliente/chats">
                                <Eye className="h-4 w-4" />
                                Ir a chats
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 text-rose-600 focus:text-rose-700">
                              <Trash2 className="h-4 w-4" />
                              Marcar seguimiento
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-slate-500">
          Mostrando {rangeStart}-{rangeEnd} de {filteredRecords.length}
        </p>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            Anterior
          </Button>
          <span className="text-[13px] text-slate-600">
            Pagina {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      </div>

      {copiedField ? (
        <p className="text-xs text-emerald-600">Copiado al portapapeles.</p>
      ) : null}
    </div>
  );
}
