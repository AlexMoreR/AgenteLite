"use client";

import { useMemo, useState } from "react";
import { Plus, Truck, X } from "lucide-react";
import {
  adminCreateSupplierAction,
  adminUpdateSupplierAction,
} from "@/app/actions/catalog-actions";
import { SuppliersDataTable } from "@/components/admin/suppliers-data-table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  productsCount: number;
};

type SuppliersWorkspaceProps = {
  suppliers: SupplierRow[];
};

export function SuppliersWorkspace({ suppliers }: SuppliersWorkspaceProps) {
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(null);

  const activeSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === activeSupplierId) ?? null,
    [suppliers, activeSupplierId],
  );

  const openNewModal = () => {
    setActiveSupplierId(null);
    setModal("new");
  };

  const openEditModal = (supplierId: string) => {
    setActiveSupplierId(supplierId);
    setModal("edit");
  };

  const closeModal = () => {
    setModal(null);
    setActiveSupplierId(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
            <Truck className="h-4 w-4 text-slate-500" />
            <span>Proveedores</span>
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Crea, edita y elimina proveedores del catalogo.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewModal}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
        >
          <Plus className="h-4 w-4" />
          Nuevo proveedor
        </button>
      </div>

      <SuppliersDataTable suppliers={suppliers} onEditSupplier={openEditModal} />

      {modal === "new" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo proveedor"
          onClick={closeModal}
        >
          <Card
            className="w-full max-w-lg rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Nuevo proveedor</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={adminCreateSupplierAction} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Nombre</span>
                <Input name="name" placeholder="Ej. Textiles Andina" required />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Correo</span>
                  <Input name="email" type="email" placeholder="ventas@proveedor.com" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Telefono</span>
                  <Input name="phone" placeholder="+57 300..." />
                </label>
              </div>
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                Guardar proveedor
              </button>
            </form>
          </Card>
        </div>
      ) : null}

      {modal === "edit" && activeSupplier ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Editar ${activeSupplier.name}`}
          onClick={closeModal}
        >
          <Card
            className="w-full max-w-lg rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Editar proveedor</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={adminUpdateSupplierAction} className="space-y-3">
              <input type="hidden" name="supplierId" value={activeSupplier.id} />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Nombre</span>
                <Input name="name" defaultValue={activeSupplier.name} required />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Correo</span>
                  <Input
                    name="email"
                    type="email"
                    defaultValue={activeSupplier.email ?? ""}
                    placeholder="ventas@proveedor.com"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Telefono</span>
                  <Input
                    name="phone"
                    defaultValue={activeSupplier.phone ?? ""}
                    placeholder="+57 300..."
                  />
                </label>
              </div>
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                Guardar cambios
              </button>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
