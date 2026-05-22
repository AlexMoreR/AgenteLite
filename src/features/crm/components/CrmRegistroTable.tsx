"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Eye, Hash, MoreHorizontal, Search, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getCrmStageMeta, getCrmStageLabel } from "../domain/crm-config";
import type { CrmRecord, CrmStage } from "../types";

type SortKey = "numero" | "nombre" | "fecha" | "estado";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 6;

function formatCrmDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  })
    .format(new Date(value))
    .replace(/\u00A0/g, " ");
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
      className="inline-flex items-center gap-2 text-[15px] font-normal text-slate-600 transition hover:text-slate-900"
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

export function CrmRegistroTable({ records }: { records: CrmRecord[] }) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<CrmStage | "__all__">("__all__");
  const [sortKey, setSortKey] = React.useState<SortKey>("fecha");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");
  const [page, setPage] = React.useState(1);
  const [copiedField, setCopiedField] = React.useState<string | null>(null);

  const statusOptions = React.useMemo(() => {
    const seen = new Map<CrmStage, string>();

    for (const record of records) {
      if (!seen.has(record.status)) {
        seen.set(record.status, getRecordStateLabel(record));
      }
    }

    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [records]);

  const filteredRecords = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return records.filter((record) => {
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

      return queryMatches && statusMatches;
    });
  }, [query, records, statusFilter]);

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
  }, [query, statusFilter]);

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
  };

  const handleCopy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1200);
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
            className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-[var(--line-strong)] sm:min-w-40 sm:w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="__all__">Estados</option>
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
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
                    <p className="truncate text-sm font-semibold text-slate-900">{record.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{record.number}</p>
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
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{record.detail}</p>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{formatCrmDate(record.date)}</span>
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
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "numero"}
                  direction={sortDirection}
                  onClick={() => toggleSort("numero")}
                  icon={<Hash className="h-3.5 w-3.5" />}
                >
                  Numero
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "nombre"}
                  direction={sortDirection}
                  onClick={() => toggleSort("nombre")}
                  icon={<Eye className="h-3.5 w-3.5" />}
                >
                  Nombre
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "fecha"}
                  direction={sortDirection}
                  onClick={() => toggleSort("fecha")}
                  icon={<Tag className="h-3.5 w-3.5" />}
                >
                  Fecha
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">Etiquetas</TableHead>
              <TableHead className="normal-case tracking-normal">Detalle</TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "estado"}
                  direction={sortDirection}
                  onClick={() => toggleSort("estado")}
                  icon={<ArrowUpDown className="h-3.5 w-3.5" />}
                >
                  Estado
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-9 text-center text-slate-500">
                  No hay registros para el filtro actual.
                </TableCell>
              </TableRow>
            ) : (
              pagedRecords.map((record) => {
                const meta = getCrmStageMeta(record.status);

                return (
                  <TableRow key={record.id}>
                    <TableCell className="text-sm font-medium text-slate-900">{record.number}</TableCell>
                    <TableCell className="text-sm text-slate-700">{record.name}</TableCell>
                    <TableCell className="text-sm text-slate-600">{formatCrmDate(record.date)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {record.tags.map((tag) => (
                          <Badge
                            key={`${record.id}:${tag.label}`}
                            variant="outline"
                            className="h-auto rounded-full border-[var(--line)] bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                            style={{ borderColor: tag.color, color: tag.color }}
                          >
                            {tag.label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[24rem] text-sm leading-6 text-slate-600">
                      <span className="line-clamp-2">{record.detail}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`h-auto rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
                      >
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
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
        <p className="text-xs text-slate-500">
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
          <span className="text-xs text-slate-600">
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
