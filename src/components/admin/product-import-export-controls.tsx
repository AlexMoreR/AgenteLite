"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, MoreHorizontal, Upload } from "lucide-react";
import { adminImportProductsCsvAction } from "@/app/actions/product-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProductImportExportControls() {
  const [openModal, setOpenModal] = useState<"import" | "export" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!openModal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenModal(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openModal]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-slate-700 transition hover:bg-slate-50"
            aria-label="Opciones de importacion y exportacion"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => setOpenModal("import")} className="gap-2">
            <Upload className="h-3.5 w-3.5" />
            Importar CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenModal("export")} className="gap-2">
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {openModal === "import" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Importar productos"
          onClick={() => setOpenModal(null)}
        >
          <div
            className="saas-card w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Importar productos</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Sube un archivo CSV para crear productos en lote.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-medium text-slate-600">Formato recomendado</p>
              <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded-md bg-white px-2 py-1 text-[11px] text-slate-700">
                Codigo, Nombre, Descripcion, Costo, %Detal, %Mayor, MinMayor, Categoria, Proveedor, Imagen
              </code>
            </div>

            <form action={adminImportProductsCsvAction} className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  if (!event.currentTarget.files?.length) {
                    return;
                  }
                  event.currentTarget.form?.requestSubmit();
                  setOpenModal(null);
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-10 w-full items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Importar por CSV
              </button>
            </form>
          </div>
        </div>
      )}

      {openModal === "export" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Exportar productos"
          onClick={() => setOpenModal(null)}
        >
          <div
            className="saas-card w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Exportar productos</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Descarga tu catalogo actual en CSV para respaldo o edicion masiva.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <Link
              href="/admin/productos/export"
              className="inline-flex h-10 w-full items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              onClick={() => setOpenModal(null)}
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
