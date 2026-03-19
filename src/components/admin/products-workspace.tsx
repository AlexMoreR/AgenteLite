"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Plus, X } from "lucide-react";
import { EditProductForm } from "@/components/admin/edit-product-form";
import { NEW_PRODUCT_DRAFT_KEY, NewProductForm } from "@/components/admin/new-product-form";
import { ProductImportExportControls } from "@/components/admin/product-import-export-controls";
import { ProductsDataTable } from "@/components/admin/products-data-table";
import type { SupportedCurrencyCode } from "@/lib/currency";

type CategoryOption = {
  id: string;
  name: string;
};

type SupplierOption = {
  id: string;
  name: string;
};

type ProductWorkspaceRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  thumbnailUrl: string;
  imageUrls: string[];
  baseCost: number;
  retailMarginPct: number;
  wholesaleMarginPct: number;
  minWholesaleQty: number;
  price: number;
  wholesalePrice: number;
};

type ProductsWorkspaceProps = {
  products: ProductWorkspaceRow[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  currency: SupportedCurrencyCode;
  okMessage?: string;
};

export function ProductsWorkspace({
  products,
  categories,
  suppliers,
  currency,
  okMessage,
}: ProductsWorkspaceProps) {
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);

  const activeProduct = useMemo(
    () => products.find((product) => product.id === activeProductId) ?? null,
    [products, activeProductId],
  );

  const openNewModal = () => {
    setActiveProductId(null);
    setModal("new");
  };

  const openEditModal = (productId: string) => {
    setActiveProductId(productId);
    setModal("edit");
  };

  const closeModal = () => {
    setModal(null);
    setActiveProductId(null);
  };

  useEffect(() => {
    if (okMessage?.includes("Producto creado")) {
      window.localStorage.removeItem(NEW_PRODUCT_DRAFT_KEY);
    }
  }, [okMessage]);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
            <Package className="h-4 w-4 text-slate-500" />
            <span>Productos</span>
          </h1>
          <p className="mt-1 text-xs text-slate-600">Gestion de productos.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <ProductImportExportControls />
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] sm:flex-none"
          >
            <Plus className="h-4 w-4" />
            Nuevo producto
          </button>
        </div>
      </div>

      <ProductsDataTable
        currency={currency}
        products={products}
        onOpenProduct={openEditModal}
      />

      {modal === "new" ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#11182770] p-0 sm:items-start sm:p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo producto"
          onClick={closeModal}
        >
          <div
            className="h-full w-full max-w-6xl overflow-y-auto overflow-x-hidden rounded-none border border-[var(--line)] bg-white p-3 sm:max-h-[92vh] sm:rounded-xl sm:p-4 md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Nuevo producto</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NewProductForm categories={categories} suppliers={suppliers} currency={currency} />
          </div>
        </div>
      ) : null}

      {modal === "edit" && activeProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#11182770] p-0 sm:items-start sm:p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Editar ${activeProduct.name}`}
          onClick={closeModal}
        >
          <div
            className="h-full w-full max-w-6xl overflow-y-auto overflow-x-hidden rounded-none border border-[var(--line)] bg-white p-3 sm:max-h-[92vh] sm:rounded-xl sm:p-4 md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{activeProduct.name}</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <EditProductForm
              categories={categories}
              suppliers={suppliers}
              currency={currency}
              initialData={{
                id: activeProduct.id,
                code: activeProduct.code,
                name: activeProduct.name,
                description: activeProduct.description,
                baseCost: activeProduct.baseCost,
                price: activeProduct.price,
                wholesalePrice: activeProduct.wholesalePrice,
                retailMarginPct: activeProduct.retailMarginPct,
                wholesaleMarginPct: activeProduct.wholesaleMarginPct,
                minWholesaleQty: activeProduct.minWholesaleQty,
                categoryId: activeProduct.categoryId,
                supplierId: activeProduct.supplierId,
                imageUrls: activeProduct.imageUrls,
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
