"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdsGeneratorHistoryEntry } from "../types/ad-history";

type AdsGeneratorLibraryProps = {
  history: AdsGeneratorHistoryEntry[];
};

export function AdsGeneratorLibrary({ history }: AdsGeneratorLibraryProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sortedHistory = useMemo(
    () =>
      [...history].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [history],
  );

  const handleCreate = async () => {
    const trimmedName = productName.trim();
    if (trimmedName.length < 2) {
      return;
    }

    setPendingCreate(true);

    try {
      const response = await fetch("/api/marketing-ia/ads-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draft: true,
          productName: trimmedName,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { entry?: { id: string }; error?: string }
        | null;

      if (!response.ok || !payload?.entry?.id) {
        throw new Error(payload?.error || "No pudimos crear el anuncio.");
      }

      setModalOpen(false);
      setProductName("");
      router.push(`/cliente/marketing-ia/ads-generator/editor?entryId=${payload.entry.id}`);
      router.refresh();
    } finally {
      setPendingCreate(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    setPendingDeleteId(entryId);

    try {
      await fetch("/api/marketing-ia/ads-generator", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: entryId }),
      });

      router.refresh();
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <section className="app-page space-y-6">
      <div className="flex flex-col gap-4 rounded-[32px] border border-[var(--line)] bg-white px-5 py-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.18)] md:flex-row md:items-center md:justify-between md:px-7">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">
            Ads Generator
          </p>
          <h1 className="text-[1.9rem] font-semibold tracking-[-0.05em] text-slate-950">
            Anuncios IA
          </h1>
        </div>

        <Button
          type="button"
          className="h-11 rounded-full px-5 shadow-[0_18px_36px_-22px_color-mix(in_srgb,var(--primary)_45%,black)]"
          onClick={() => setModalOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Crear
        </Button>
      </div>

      {sortedHistory.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-[var(--line)] bg-white px-6 py-12 text-center shadow-[0_20px_50px_-40px_rgba(15,23,42,0.14)]">
          <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
            Aun no tienes anuncios creados
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Crea tu primer anuncio IA, define el nombre del producto y entra al editor para construirlo.
          </p>
          <Button
            type="button"
            className="mt-5 h-11 rounded-full px-5"
          onClick={() => setModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Crear Anuncio IA
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[28px] border border-[var(--line)] bg-white shadow-[0_20px_50px_-40px_rgba(15,23,42,0.18)]">
          <div className="hidden grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_140px_180px] gap-4 border-b border-[var(--line)] bg-slate-50/80 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid">
            <span>Producto</span>
            <span>Titulo</span>
            <span>Creado</span>
            <span className="text-right">Acciones</span>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {sortedHistory.map((entry) => (
              <article
                key={entry.id}
                className="px-4 py-4 transition hover:bg-slate-50/60 md:px-5"
              >
                <div className="grid gap-4 md:grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_140px_180px] md:items-center">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Producto
                    </p>
                    <h2 className="truncate text-base font-semibold tracking-[-0.03em] text-slate-950">
                      {entry.input.productName}
                    </h2>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm leading-5 text-slate-600 md:hidden">
                      {entry.result.meta.headline}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Titulo
                    </p>
                    <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                      {entry.result.meta.headline}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Creado
                    </p>
                    <p className="text-sm text-slate-600">
                      {new Date(entry.createdAt).toLocaleDateString("es-CO", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 md:justify-end">
                    <Button asChild variant="outline" className="h-11 w-11 rounded-full p-0">
                      <Link href={`/cliente/marketing-ia/ads-generator/editor?entryId=${entry.id}`}>
                        <Edit3 className="h-4 w-4" />
                        <span className="sr-only">Editar</span>
                      </Link>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11 rounded-full p-0 text-[var(--danger-fg)] hover:text-[var(--danger-fg)]"
                      disabled={pendingDeleteId === entry.id}
                      onClick={() => void handleDelete(entry.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Eliminar</span>
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0f172a80] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Crear anuncio IA"
          onClick={() => {
            if (pendingCreate) {
              return;
            }
            setModalOpen(false);
          }}
        >
          <div
            className="my-auto w-full max-w-md rounded-[28px] border border-[var(--line)] bg-white p-5 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.45)] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">
                  Nuevo anuncio
                </p>
                <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">
                  Como se llama tu producto
                </h3>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--line)] bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                onClick={() => {
                  if (pendingCreate) {
                    return;
                  }
                  setModalOpen(false);
                }}
                aria-label="Cerrar"
                disabled={pendingCreate}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-2">
              <label htmlFor="new-ad-product-name" className="text-sm font-medium text-slate-800">
                Nombre del producto
              </label>
              <input
                id="new-ad-product-name"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="Ej. Combo de camillas para spa"
                className="h-12 w-full rounded-2xl border border-[var(--line)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)]"
                disabled={pendingCreate}
              />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full sm:w-auto"
                onClick={() => setModalOpen(false)}
                disabled={pendingCreate}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="w-full rounded-full sm:w-auto"
                disabled={productName.trim().length < 2 || pendingCreate}
                onClick={() => void handleCreate()}
              >
                {pendingCreate ? "Creando..." : "Continuar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
