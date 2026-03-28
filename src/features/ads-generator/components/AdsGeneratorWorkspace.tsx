"use client";

import { AlertCircle, ArrowRight, CheckCircle2, History, LoaderCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorHistoryEntry } from "../types/ad-history";
import type { AdsGeneratorResult } from "../types/ad-output";
import { AdsGeneratorForm } from "./AdsGeneratorForm";
import { AdsGeneratorResult as AdsGeneratorResultView } from "./AdsGeneratorResult";
import { Card } from "@/components/ui/card";

type AdsGeneratorWorkspaceProps = {
  initialHistory?: AdsGeneratorHistoryEntry[];
  initialInput?: Partial<AdProductInput>;
  sourceHint?: string | null;
};

export function AdsGeneratorWorkspace({
  initialHistory = [],
  initialInput,
  sourceHint,
}: AdsGeneratorWorkspaceProps) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(initialHistory[0]?.id ?? null);
  const [result, setResult] = useState<AdsGeneratorResult | null>(initialHistory[0]?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<AdProductInput | null>(initialHistory[0]?.input ?? null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<AdsGeneratorHistoryEntry[]>(initialHistory);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function buildInitialState(input: AdProductInput) {
    setLastInput(input);
    setPending(true);
    setError(null);
  }

  const handleSubmit = async (input: AdProductInput) => {
    buildInitialState(input);

    try {
      const response = await fetch("/api/marketing-ia/ads-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as
        | { entry?: AdsGeneratorHistoryEntry; history?: AdsGeneratorHistoryEntry[]; error?: string }
        | undefined;

      if (!response.ok || !payload?.entry) {
        throw new Error(payload?.error || "No pudimos generar el anuncio base en este momento.");
      }

      setResult(payload.entry.result);
      setLastInput(payload.entry.input);
      setActiveEntryId(payload.entry.id);
      setHistory(payload.history ?? [payload.entry, ...history]);
    } catch (nextError: unknown) {
      setResult(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "No pudimos generar el anuncio base en este momento.",
      );
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);

    try {
      const response = await fetch("/api/marketing-ia/ads-generator", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as
        | { history?: AdsGeneratorHistoryEntry[]; error?: string }
        | undefined;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos eliminar esta entrada.");
      }

      const nextHistory = payload?.history ?? [];
      setHistory(nextHistory);

      if (activeEntryId === id) {
        setActiveEntryId(nextHistory[0]?.id ?? null);
        setResult(nextHistory[0]?.result ?? null);
        setLastInput(nextHistory[0]?.input ?? null);
      }
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "No pudimos eliminar esta entrada del historial.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="app-page space-y-5">
      <div className="relative overflow-hidden rounded-[30px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,247,255,0.94))] p-6 shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)] sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_24%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
              Marketing IA
            </p>
            <h1 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[2.5rem]">
              Ads Generator
            </h1>
            <p className="max-w-[62ch] text-sm leading-7 text-slate-600 sm:text-base">
              Convierte la informacion del producto en una propuesta comercial base con
              estrategia, copy, estructura de campana y salida lista para adaptar en Meta Ads Manager.
            </p>
            {sourceHint ? (
              <p className="text-xs leading-6 text-[var(--primary)]">
                Fuente detectada: {sourceHint}.
              </p>
            ) : null}
          </div>

          <Button asChild variant="outline" size="lg" className="rounded-2xl">
            <Link href="/cliente/marketing-ia/creativos">
              Ir a Creativos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[var(--danger-line)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-fg)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {lastInput ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[var(--info-line)] bg-[var(--info-bg)] px-4 py-3 text-sm text-[var(--info-fg)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Ultimo producto procesado: <span className="font-semibold">{lastInput.productName}</span>
          </p>
        </div>
      ) : initialInput?.productName ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[var(--info-line)] bg-[var(--info-bg)] px-4 py-3 text-sm text-[var(--info-fg)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Base precargada para <span className="font-semibold">{initialInput.productName}</span>.
            Puedes ajustarla antes de generar el anuncio.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
        <AdsGeneratorForm pending={pending} initialValues={initialInput} onSubmit={handleSubmit} />
        <AdsGeneratorResultView pending={pending} result={result} />
      </div>

      <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold text-slate-950">Historial del workspace</h2>
          </div>
          <p className="text-sm text-slate-500">
            Las ejecuciones recientes quedan guardadas para reutilizarlas desde cualquier sesion.
          </p>
        </div>

        {history.length === 0 ? (
          <div className="rounded-[24px] border border-[var(--line)] bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Aun no hay ejecuciones guardadas del Ads Generator.
          </div>
        ) : (
          <div className="grid gap-3">
            {history.map((entry) => (
              <article
                key={entry.id}
                className="rounded-[24px] border border-[var(--line)] bg-slate-50 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-950">{entry.input.productName}</p>
                    <p className="text-xs text-slate-500">
                      {new Intl.DateTimeFormat("es-CO", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(entry.createdAt))}
                    </p>
                    <p className="text-sm leading-6 text-slate-600">{entry.result.summary}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => {
                        setActiveEntryId(entry.id);
                        setResult(entry.result);
                        setLastInput(entry.input);
                      }}
                    >
                      Reabrir
                    </Button>
                    <Button asChild variant="outline" className="rounded-2xl">
                      <Link
                        href={`/cliente/marketing-ia/ads-generator?productName=${encodeURIComponent(entry.input.productName)}&productDescription=${encodeURIComponent(entry.input.productDescription)}&keyBenefits=${encodeURIComponent(entry.input.keyBenefits.join("\n"))}${entry.input.image?.url ? `&imageUrl=${encodeURIComponent(entry.input.image.url)}&source=${encodeURIComponent(entry.input.image.source)}` : ""}`}
                      >
                        Duplicar
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingId === entry.id}
                      onClick={() => handleDelete(entry.id)}
                    >
                      {deletingId === entry.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Eliminar
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
