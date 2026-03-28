"use client";

import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { runAdsGenerator } from "../services/runAdsGenerator";
import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { AdsGeneratorForm } from "./AdsGeneratorForm";
import { AdsGeneratorResult as AdsGeneratorResultView } from "./AdsGeneratorResult";

export function AdsGeneratorWorkspace() {
  const [result, setResult] = useState<AdsGeneratorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<AdProductInput | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (input: AdProductInput) => {
    setError(null);
    setLastInput(input);
    setPending(true);

    try {
      const nextResult = await runAdsGenerator(input);
      setResult(nextResult);
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
              Primera version funcional del flujo para convertir la informacion de un producto
              en una propuesta mock de anuncio lista para revisar y copiar.
            </p>
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
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
        <AdsGeneratorForm pending={pending} onSubmit={handleSubmit} />
        <AdsGeneratorResultView pending={pending} result={result} />
      </div>
    </section>
  );
}
