"use client";

import Link from "next/link";
import * as React from "react";
import {
  ArrowDown,
  ArrowUpRight,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Edit3,
  FileText,
  MoreHorizontal,
  Trash2,
  User2,
} from "lucide-react";
import { adminDeleteQuoteAction } from "@/app/actions/quote-actions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, type SupportedCurrencyCode } from "@/lib/currency";

type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";

type QuoteRow = {
  id: string;
  code: string;
  clientName: string;
  itemsCount: number;
  total: number;
  status: QuoteStatus;
  createdAt: string;
  shareToken: string;
};

type QuotesDataTableProps = {
  quotes: QuoteRow[];
  currency: SupportedCurrencyCode;
};

type SortKey = "cotizacion" | "cliente" | "estado" | "total" | "fecha" | "acciones";
type SortDirection = "asc" | "desc";

function statusLabel(status: QuoteStatus): string {
  switch (status) {
    case "DRAFT":
      return "Borrador";
    case "SENT":
      return "Enviada";
    case "ACCEPTED":
      return "Aceptada";
    case "REJECTED":
      return "Rechazada";
    case "EXPIRED":
      return "Expirada";
    default:
      return status;
  }
}

function statusBadgeClassName(status: QuoteStatus): string {
  switch (status) {
    case "DRAFT":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "SENT":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "ACCEPTED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "REJECTED":
      return "border-red-200 bg-red-50 text-red-700";
    case "EXPIRED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
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

export function QuotesDataTable({ quotes, currency }: QuotesDataTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>("cotizacion");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; code: string } | null>(null);

  const sortedQuotes = React.useMemo(() => {
    const list = [...quotes];
    const directionFactor = sortDirection === "asc" ? 1 : -1;
    const textCompare = (a: string, b: string) =>
      a.localeCompare(b, "es", { sensitivity: "base", numeric: true });

    list.sort((a, b) => {
      switch (sortKey) {
        case "cotizacion":
        case "acciones":
          return textCompare(a.code, b.code) * directionFactor;
        case "cliente":
          return textCompare(a.clientName, b.clientName) * directionFactor;
        case "estado":
          return textCompare(statusLabel(a.status), statusLabel(b.status)) * directionFactor;
        case "total":
          return (a.total - b.total) * directionFactor;
        case "fecha":
          return textCompare(a.createdAt, b.createdAt) * directionFactor;
        default:
          return 0;
      }
    });

    return list;
  }, [quotes, sortDirection, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const confirmDelete = () => {
    if (!pendingDelete) {
      return;
    }
    const forms = document.querySelectorAll<HTMLFormElement>(
      `form[data-delete-quote-id="${pendingDelete.id}"]`,
    );
    const form =
      Array.from(forms).find((candidate) => candidate.offsetParent !== null) ??
      forms[0] ??
      null;
    form?.requestSubmit();
    setPendingDelete(null);
  };

  return (
    <div className="space-y-3">
      <div className="hidden overflow-hidden rounded-xl border border-[var(--line)] bg-white md:block">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "cotizacion"}
                  direction={sortDirection}
                  onClick={() => toggleSort("cotizacion")}
                  icon={<FileText className="h-3.5 w-3.5" />}
                >
                  Cotizacion
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "cliente"}
                  direction={sortDirection}
                  onClick={() => toggleSort("cliente")}
                  icon={<User2 className="h-3.5 w-3.5" />}
                >
                  Cliente
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "estado"}
                  direction={sortDirection}
                  onClick={() => toggleSort("estado")}
                  icon={<FileText className="h-3.5 w-3.5" />}
                >
                  Estado
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "total"}
                  direction={sortDirection}
                  onClick={() => toggleSort("total")}
                  icon={<FileText className="h-3.5 w-3.5" />}
                >
                  Total
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "fecha"}
                  direction={sortDirection}
                  onClick={() => toggleSort("fecha")}
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                >
                  Fecha
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "acciones"}
                  direction={sortDirection}
                  onClick={() => toggleSort("acciones")}
                  icon={<MoreHorizontal className="h-3.5 w-3.5" />}
                >
                  Acciones
                </HeaderLabel>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedQuotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-9 text-center text-slate-500">
                  Aun no hay cotizaciones.
                </TableCell>
              </TableRow>
            ) : (
              sortedQuotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell>
                    <p className="text-sm font-semibold text-slate-900">{quote.code}</p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">{quote.clientName}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClassName(quote.status)}`}
                    >
                      {statusLabel(quote.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-slate-800">
                    {formatMoney(quote.total, currency)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{quote.createdAt}</TableCell>
                  <TableCell>
                    <form data-delete-quote-id={quote.id} action={adminDeleteQuoteAction}>
                      <input type="hidden" name="returnTo" value="/admin/cotizaciones" />
                      <input type="hidden" name="quoteId" value={quote.id} />
                    </form>
                    <div className="flex items-center gap-1">
                      <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 border border-transparent hover:border-[var(--line)]">
                        <Link
                          href={`/cotizaciones/${quote.shareToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Ir a cotizacion ${quote.code}`}
                        >
                          <ArrowUpRight className="h-4 w-4 text-slate-600" />
                        </Link>
                      </Button>
                      <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 border border-transparent hover:border-[var(--line)]">
                        <Link href={`/admin/cotizaciones/${quote.id}`} aria-label={`Editar ${quote.code}`}>
                          <Edit3 className="h-4 w-4 text-slate-600" />
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 border border-transparent text-red-600 hover:border-red-100 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setPendingDelete({ id: quote.id, code: quote.code })}
                        aria-label={`Eliminar ${quote.code}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {sortedQuotes.length === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-6 text-center text-sm text-slate-500">
            Aun no hay cotizaciones.
          </div>
        ) : (
          sortedQuotes.map((quote) => (
            <article key={quote.id} className="space-y-2.5 rounded-xl border border-[var(--line)] bg-white p-3">
              <form data-delete-quote-id={quote.id} action={adminDeleteQuoteAction}>
                <input type="hidden" name="returnTo" value="/admin/cotizaciones" />
                <input type="hidden" name="quoteId" value={quote.id} />
              </form>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{quote.code}</p>
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClassName(quote.status)}`}
                  >
                    {statusLabel(quote.status)}
                  </span>
                </div>
                <p className="text-sm text-slate-700">{quote.clientName}</p>
                <p className="text-xs text-slate-500">{quote.createdAt}</p>
                <p className="text-sm font-semibold text-slate-800">{formatMoney(quote.total, currency)}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 border border-transparent hover:border-[var(--line)]">
                  <Link
                    href={`/cotizaciones/${quote.shareToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Ir a cotizacion ${quote.code}`}
                  >
                    <ArrowUpRight className="h-4 w-4 text-slate-600" />
                  </Link>
                </Button>
                <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8 border border-transparent hover:border-[var(--line)]">
                  <Link href={`/admin/cotizaciones/${quote.id}`} aria-label={`Editar ${quote.code}`}>
                    <Edit3 className="h-4 w-4 text-slate-600" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 border border-transparent text-red-600 hover:border-red-100 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDelete({ id: quote.id, code: quote.code })}
                  aria-label={`Eliminar ${quote.code}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </article>
          ))
        )}
      </div>

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar eliminacion"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="saas-card w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900">Eliminar cotizacion</h3>
              <p className="text-sm text-slate-600">
                Se eliminara <span className="font-medium text-slate-800">{pendingDelete.code}</span>. Esta accion no se puede deshacer.
              </p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={confirmDelete}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
