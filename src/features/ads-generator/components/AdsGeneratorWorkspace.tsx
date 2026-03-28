"use client";

import { AlertCircle, ArrowRight, ImagePlus, Plus, SendHorizonal, X } from "lucide-react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { AdsGeneratorForm } from "./AdsGeneratorForm";
import { AdsGeneratorResult as AdsGeneratorResultView } from "./AdsGeneratorResult";

type AdsGeneratorWorkspaceProps = {
  initialInput?: Partial<AdProductInput>;
  sourceHint?: string | null;
};

export function AdsGeneratorWorkspace({ initialInput, sourceHint }: AdsGeneratorWorkspaceProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(initialInput?.productDescription ?? "");
  const [variantCount, setVariantCount] = useState<3 | 5 | 10>(3);
  const [result, setResult] = useState<AdsGeneratorResult | null>(null);
  const [lastInput, setLastInput] = useState<AdProductInput | null>(null);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    if (!modalOpen || !canPortal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [canPortal, modalOpen]);

  const modalInitialValues = useMemo(
    () => ({
      ...initialInput,
      productDescription: draftPrompt.trim() || initialInput?.productDescription || "",
    }),
    [draftPrompt, initialInput],
  );

  const handleSubmit = async (input: AdProductInput) => {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/marketing-ia/ads-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as
        | { entry?: { id: string; input: AdProductInput; result: AdsGeneratorResult }; error?: string }
        | undefined;

      if (!response.ok || !payload?.entry) {
        throw new Error(payload?.error || "No pudimos generar el anuncio base en este momento.");
      }

      setLastInput(payload.entry.input);
      setResult(payload.entry.result);
      setDraftPrompt(payload.entry.input.productDescription);
      setModalOpen(false);
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "No pudimos generar el anuncio base en este momento.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="app-page space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" size="lg" className="h-12 rounded-2xl px-6" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Crear anuncios
        </Button>
        <Button asChild variant="outline" size="lg" className="rounded-2xl">
          <Link href="/cliente/marketing-ia/creativos">
            Ir a Creativos
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[var(--danger-line)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-fg)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)]">
        <div className="min-h-[58vh] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,248,252,0.96))] px-4 py-5 md:px-6 md:py-6">
          {result ? (
            <AdsGeneratorResultView pending={pending} result={result} />
          ) : (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                <ImagePlus className="h-7 w-7" />
              </div>
              <div className="mt-6 max-w-2xl space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Ads Generator
                </p>
                <h1 className="text-[1.8rem] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[2.2rem]">
                  Describe tu producto y la IA arma el anuncio
                </h1>
                <p className="text-sm leading-7 text-slate-600 sm:text-base">
                  Escribe una descripcion simple abajo. Si ya vienes de Creativos, usaremos tambien tu imagen y el contexto del negocio.
                </p>
                {sourceHint ? (
                  <p className="text-xs leading-6 text-[var(--primary)]">
                    Fuente detectada: {sourceHint}.
                  </p>
                ) : null}
                {initialInput?.image?.url ? (
                  <p className="text-xs leading-6 text-slate-500">
                    Ya hay una imagen lista para usar en el anuncio.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] px-4 py-4 md:px-6 md:py-5">
          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-3 shadow-[0_20px_44px_-34px_rgba(15,23,42,0.18)] md:p-4">
            <label className="block space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">Describe el producto o servicio</span>
                <span className="rounded-full border border-[rgba(148,163,184,0.14)] bg-white px-3 py-1 text-[11px] font-medium text-slate-500">
                  Entrada rapida
                </span>
              </div>
              <textarea
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                rows={3}
                className="field-textarea min-h-[120px] rounded-[24px] border-[rgba(148,163,184,0.14)] bg-white px-5 py-4 text-[15px] leading-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                placeholder="Ej. Combo de camillas para salon de belleza, con acabado elegante, faciles de limpiar y pensadas para mejorar la atencion del cliente."
              />
            </label>

            <div className="mt-4 flex flex-col gap-3 border-t border-[rgba(148,163,184,0.12)] pt-4 md:flex-row md:items-center md:justify-between">
              <div className="relative flex h-12 min-w-[220px] items-center rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white pl-3 pr-10 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.3)]">
                <div className="pointer-events-none mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <ImagePlus className="h-4 w-4" />
                </div>
                <select
                  value={variantCount}
                  onChange={(event) => setVariantCount(Number(event.target.value) as 3 | 5 | 10)}
                  className="h-full w-full appearance-none bg-transparent text-sm font-semibold text-slate-700 outline-none"
                >
                  <option value={3}>3 imagenes</option>
                  <option value={5}>5 imagenes</option>
                  <option value={10}>10 imagenes</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-3 md:pb-0.5">
                <Button
                  type="button"
                  className="h-12 rounded-2xl px-6 shadow-[0_16px_32px_-20px_color-mix(in_srgb,var(--primary)_45%,black)]"
                  onClick={() => setModalOpen(true)}
                >
                  Continuar
                  <SendHorizonal className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {lastInput ? (
        <div className="rounded-[24px] border border-[var(--info-line)] bg-[var(--info-bg)] px-4 py-3 text-sm text-[var(--info-fg)]">
          Ultimo producto procesado: <span className="font-semibold">{lastInput.productName}</span>
        </div>
      ) : null}

      {modalOpen && canPortal
        ? createPortal(
            <AdsGeneratorModal
              pending={pending}
              initialValues={modalInitialValues}
              onClose={() => {
                if (!pending) {
                  setModalOpen(false);
                }
              }}
              onSubmit={handleSubmit}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

function AdsGeneratorModal({
  pending,
  initialValues,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  initialValues?: Partial<AdProductInput>;
  onClose: () => void;
  onSubmit: (input: AdProductInput) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Formulario del Ads Generator"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-[1040px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="absolute right-5 top-5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 md:right-8 md:top-4"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>

        <AdsGeneratorForm pending={pending} initialValues={initialValues} onSubmit={onSubmit} />
      </div>
    </div>
  );
}
