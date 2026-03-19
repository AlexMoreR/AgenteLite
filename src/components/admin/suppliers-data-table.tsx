"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Edit3,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { adminDeleteSupplierAction } from "@/app/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  productsCount: number;
};

type SuppliersDataTableProps = {
  suppliers: SupplierRow[];
  onEditSupplier?: (supplierId: string) => void;
};

type SortKey = "proveedor" | "correo" | "telefono" | "productos" | "acciones";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 12;

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

export function SuppliersDataTable({ suppliers, onEditSupplier }: SuppliersDataTableProps) {
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("proveedor");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("asc");
  const [page, setPage] = React.useState(1);
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; name: string } | null>(null);

  const filteredSuppliers = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return suppliers.filter((supplier) => {
      const haystack = [supplier.name, supplier.email ?? "", supplier.phone ?? ""].join(" ").toLowerCase();
      return !normalizedQuery || haystack.includes(normalizedQuery);
    });
  }, [suppliers, query]);

  const sortedSuppliers = React.useMemo(() => {
    const list = [...filteredSuppliers];
    const directionFactor = sortDirection === "asc" ? 1 : -1;
    const textCompare = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

    list.sort((a, b) => {
      switch (sortKey) {
        case "proveedor":
        case "acciones":
          return textCompare(a.name, b.name) * directionFactor;
        case "correo":
          return textCompare(a.email ?? "Sin correo", b.email ?? "Sin correo") * directionFactor;
        case "telefono":
          return textCompare(a.phone ?? "Sin telefono", b.phone ?? "Sin telefono") * directionFactor;
        case "productos":
          return (a.productsCount - b.productsCount) * directionFactor;
        default:
          return 0;
      }
    });

    return list;
  }, [filteredSuppliers, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedSuppliers.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage(1);
  }, [query]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedSuppliers = sortedSuppliers.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = sortedSuppliers.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, sortedSuppliers.length);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;

    const forms = document.querySelectorAll<HTMLFormElement>(
      `form[data-delete-supplier-id="${pendingDelete.id}"]`,
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
      <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por proveedor, correo o telefono"
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs"
            onClick={() => setQuery("")}
            disabled={!query}
          >
            Limpiar filtros
          </Button>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {pagedSuppliers.length === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-6 text-center text-sm text-slate-500">
            No hay proveedores para el filtro actual.
          </div>
        ) : (
          pagedSuppliers.map((supplier) => (
            <article key={supplier.id} className="rounded-xl border border-[var(--line)] bg-white p-3">
              <form data-delete-supplier-id={supplier.id} action={adminDeleteSupplierAction}>
                <input type="hidden" name="supplierId" value={supplier.id} />
              </form>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <Truck className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{supplier.name}</p>
                      <p className="text-xs text-slate-500">{supplier.productsCount} producto(s)</p>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    <p>{supplier.email ?? "Sin correo"}</p>
                    <p>{supplier.phone ?? "Sin telefono"}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEditSupplier?.(supplier.id)}
                    aria-label={`Editar ${supplier.name}`}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setPendingDelete({ id: supplier.id, name: supplier.name })}
                    aria-label={`Eliminar ${supplier.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-[var(--line)] bg-white md:block">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "proveedor"}
                  direction={sortDirection}
                  onClick={() => toggleSort("proveedor")}
                  icon={<Truck className="h-3.5 w-3.5" />}
                >
                  Proveedor
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "correo"}
                  direction={sortDirection}
                  onClick={() => toggleSort("correo")}
                  icon={<Mail className="h-3.5 w-3.5" />}
                >
                  Correo
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "telefono"}
                  direction={sortDirection}
                  onClick={() => toggleSort("telefono")}
                  icon={<Phone className="h-3.5 w-3.5" />}
                >
                  Telefono
                </HeaderLabel>
              </TableHead>
              <TableHead className="normal-case tracking-normal">
                <HeaderLabel
                  active={sortKey === "productos"}
                  direction={sortDirection}
                  onClick={() => toggleSort("productos")}
                  icon={<Truck className="h-3.5 w-3.5" />}
                >
                  Productos
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
            {pagedSuppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-9 text-center text-slate-500">
                  No hay proveedores para el filtro actual.
                </TableCell>
              </TableRow>
            ) : (
              pagedSuppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--line)] bg-slate-50 text-slate-700">
                        <Truck className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{supplier.name}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {supplier.email ?? "Sin correo"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {supplier.phone ?? "Sin telefono"}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-slate-700">
                    {supplier.productsCount}
                  </TableCell>
                  <TableCell>
                    <form data-delete-supplier-id={supplier.id} action={adminDeleteSupplierAction}>
                      <input type="hidden" name="supplierId" value={supplier.id} />
                    </form>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 border border-transparent hover:border-[var(--line)]"
                        onClick={() => onEditSupplier?.(supplier.id)}
                        aria-label={`Editar ${supplier.name}`}
                      >
                        <Edit3 className="h-4 w-4 text-slate-600" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 border border-transparent text-red-600 hover:border-red-100 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setPendingDelete({ id: supplier.id, name: supplier.name })}
                        aria-label={`Eliminar ${supplier.name}`}
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Mostrando {rangeStart}-{rangeEnd} de {filteredSuppliers.length}
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
              <h3 className="text-base font-semibold text-slate-900">Eliminar proveedor</h3>
              <p className="text-sm text-slate-600">
                Se eliminara <span className="font-medium text-slate-800">{pendingDelete.name}</span>. Esta accion no se puede deshacer.
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
