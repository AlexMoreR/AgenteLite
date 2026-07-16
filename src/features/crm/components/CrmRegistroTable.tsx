"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, ChartNoAxesCombined, Copy, Eraser, Eye, FileText, Globe2, Hash, MoreHorizontal, Search, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS, getTagBadgeColors } from "@/lib/tag-badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { CRM_STAGE_ORDER, getCrmOriginLabel, getCrmOriginMeta, getCrmStageMeta, getCrmStageLabel } from "../domain/crm-config";
import type { CrmRecord, CrmStage } from "../types";

type SortKey = "numero" | "nombre" | "fecha" | "estado";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 10;
const DATE_RANGE_LABELS: Record<string, string> = {
  "1": "1 Dia",
  "7": "7 Dias",
  "15": "15 Dias",
  "30": "30 Dias",
  __all__: "Todos",
};

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
      className="inline-flex items-center gap-2 text-[13px] font-normal text-muted-foreground transition hover:text-foreground"
      onClick={onClick}
      aria-label={`Ordenar por ${String(children)}`}
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5 text-foreground" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5 text-foreground" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

function getRecordStateLabel(record: CrmRecord) {
  return getCrmStageLabel(record.status);
}

function getRecordOriginLabel(record: CrmRecord) {
  return getCrmOriginLabel(record.origin);
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
        getRecordOriginLabel(record),
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
      ["Numero", "Nombre", "Origen", "Fecha", "Etiquetas", "Detalle", "Estado"].join(","),
      ...sortedRecords.map((record) =>
        [
          record.number,
          record.name,
          getRecordOriginLabel(record),
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por numero, nombre, origen, detalle o etiqueta"
            className="h-9 pr-9 pl-9 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-muted-foreground"
              aria-label="Limpiar busqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as CrmStage | "__all__")}
          >
            <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-40" aria-label="Filtrar por estado">
              <SelectValue placeholder="Estados">
                {(value) => (value === "__all__" ? "Estados" : getCrmStageLabel(value as CrmStage))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Estados</SelectItem>
              {statusOptions.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={dateRangeFilter}
            onValueChange={(value) => setDateRangeFilter(value as "__all__" | "1" | "7" | "15" | "30")}
          >
            <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-40" aria-label="Filtrar por rango de dias">
              <SelectValue>{(value) => DATE_RANGE_LABELS[value as string] ?? "Todos"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Dia</SelectItem>
              <SelectItem value="7">7 Dias</SelectItem>
              <SelectItem value="15">15 Dias</SelectItem>
              <SelectItem value="30">30 Dias</SelectItem>
              <SelectItem value="__all__">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={clearFilters}
            disabled={!query && statusFilter === "__all__"}
            aria-label="Limpiar filtros"
            title="Limpiar filtros"
          >
            <Eraser className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Mas opciones"
                title="Mas opciones"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
              <DropdownMenuItem onSelect={exportCsv} className="gap-2">
                <FileText className="h-4 w-4" />
                Exportar CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {pagedRecords.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            No hay registros para el filtro actual.
          </div>
        ) : (
              pagedRecords.map((record) => {
                const meta = getCrmStageMeta(record.status);
                const originMeta = getCrmOriginMeta(record.origin);

                return (
                  <article key={record.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <ContactAvatar
                          avatarUrl={record.avatarUrl}
                          label={record.name}
                          className="h-9 w-9 shrink-0 rounded-full"
                          fallbackClassName="rounded-full"
                        />
                        <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-foreground">{record.name}</p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{record.number}</p>
                        <div className="mt-1">
                          <Badge
                            variant="outline"
                            className={`h-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${originMeta.borderClassName} ${originMeta.backgroundClassName} ${originMeta.accentClassName}`}
                          >
                            {originMeta.label}
                          </Badge>
                        </div>
                        </div>
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
                    <Badge
                      key={`${record.id}:${tag.label}`}
                      className={`shrink-0 max-w-[140px] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)] ${TAG_BADGE_CLASS}`}
                      style={getTagBadgeColors(tag.color)}
                      title={tag.label}
                    >
                      <span className="truncate">{tag.label}</span>
                    </Badge>
                  ))}
                </div>

                <p className="mt-3 truncate text-[13px] leading-6 text-muted-foreground">{record.detail}</p>

                <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[13px] text-muted-foreground">{formatCrmDateShort(record.date)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent hover:border-border"
                      onClick={() => void handleCopy(record.name, `name-${record.id}`)}
                      aria-label={`Copiar nombre de ${record.name}`}
                    >
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent hover:border-border"
                      aria-label={`Ver ${record.name}`}
                    >
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="hidden w-full overflow-hidden rounded-xl border border-border bg-card md:block">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                <span className="inline-flex items-center gap-2 text-[13px] font-normal text-muted-foreground">
                  <Globe2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Origen
                </span>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <span className="inline-flex items-center gap-2 text-[13px] font-normal text-muted-foreground">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  Etiquetas
                </span>
              </TableHead>
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <span className="inline-flex items-center gap-2 text-[13px] font-normal text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
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
              <TableHead className="px-2 py-1 normal-case tracking-normal">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="px-1.5 py-0.5 text-center text-muted-foreground">
                  No hay registros para el filtro actual.
                </TableCell>
              </TableRow>
            ) : (
              pagedRecords.map((record) => {
                const meta = getCrmStageMeta(record.status);
                const originMeta = getCrmOriginMeta(record.origin);

                return (
                  <TableRow key={record.id}>
                    <TableCell className="px-1.5 py-0.5 text-[13px] text-muted-foreground">
                      <HoverCard>
                        <HoverCardTrigger className="inline-flex cursor-help items-center">
                          {formatCrmDateShort(record.date)}
                        </HoverCardTrigger>
                        <HoverCardContent
                          className="w-fit border border-border bg-card p-3 text-[13px] leading-6 text-foreground shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]"
                          style={{ width: "fit-content" }}
                        >
                          <p className="whitespace-pre-wrap text-[13px]">{formatCrmDate(record.date)}</p>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    <TableCell className="px-1.5 py-0.5 text-[13px] font-medium text-foreground">{record.number}</TableCell>
                    <TableCell className="px-1.5 py-0.5 text-[13px] text-foreground">
                      <div className="flex min-w-0 items-center gap-2">
                        <ContactAvatar
                          avatarUrl={record.avatarUrl}
                          label={record.name}
                          className="h-7 w-7 shrink-0 rounded-full"
                          fallbackClassName="rounded-full text-[10px]"
                        />
                        <span className="truncate">{record.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-1.5 py-0.5">
                      <Badge
                        variant="outline"
                        className={`h-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${originMeta.borderClassName} ${originMeta.backgroundClassName} ${originMeta.accentClassName}`}
                      >
                        {originMeta.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {record.tags.map((tag) => (
                          <Badge
                            key={`${record.id}:${tag.label}`}
                            className={`shrink-0 max-w-[140px] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)] ${TAG_BADGE_CLASS}`}
                            style={getTagBadgeColors(tag.color)}
                            title={tag.label}
                          >
                            <span className="truncate">{tag.label}</span>
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[18rem] px-1.5 py-0.5 text-[13px] leading-5 text-muted-foreground">
                      <HoverCard>
                        <HoverCardTrigger className="block w-full cursor-help truncate text-left">
                          {record.detail}
                        </HoverCardTrigger>
                        <HoverCardContent className="max-w-md border border-border bg-card p-3 text-[12px] leading-6 text-foreground shadow-[0_16px_34px_-28px_rgba(15,23,42,0.2)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Detalle completo</p>
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 border border-transparent hover:border-border"
                              aria-label={`Mas acciones de ${record.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
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
                            <DropdownMenuItem variant="destructive" className="gap-2">
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
          <p className="text-[13px] text-muted-foreground">
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
          <span className="text-[13px] text-muted-foreground">
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
