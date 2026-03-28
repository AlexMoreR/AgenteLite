"use client";

import { Copy, FileText, Megaphone, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AdsGeneratorResult } from "../types/ad-output";

type AdsGeneratorResultProps = {
  pending: boolean;
  result: AdsGeneratorResult | null;
};

export function AdsGeneratorResult({ pending, result }: AdsGeneratorResultProps) {
  const [copied, setCopied] = useState(false);

  if (pending) {
    return (
      <Card className="rounded-[28px] border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,255,0.92))] p-6 sm:p-7">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Resultado
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
            Generando propuesta mock
          </h2>
          <p className="max-w-[58ch] text-sm leading-6 text-slate-600">
            El modulo esta recorriendo el pipeline interno para devolverte estrategia, copies
            y salida lista para copiar.
          </p>
        </div>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="rounded-[28px] border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] p-6 sm:p-7">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Resultado
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
            Aqui apareceran tus anuncios
          </h2>
          <p className="max-w-[58ch] text-sm leading-6 text-slate-600">
            Completa el formulario y el modulo `ads-generator` te devolvera una estructura lista
            para revisar y copiar.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-[28px] border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(238,244,255,0.94))] p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Resultado
            </p>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              Salida base lista para revisar
            </h2>
            <p className="max-w-[58ch] text-sm leading-6 text-slate-600">{result.summary}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={async () => {
              await navigator.clipboard.writeText(result.meta.readyToCopyText);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
          >
            <Copy className="h-4 w-4" />
            {copied ? "Copiado" : "Copiar salida"}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
        <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-lg font-semibold text-slate-950">Estrategia</h3>
          </div>

          <dl className="space-y-4 text-sm">
            <div className="space-y-1">
              <dt className="font-medium text-slate-500">Angulo</dt>
              <dd className="leading-6 text-slate-800">{result.strategy.angle}</dd>
            </div>
            <div className="space-y-1">
              <dt className="font-medium text-slate-500">Resumen estrategico</dt>
              <dd className="leading-6 text-slate-800">{result.meta.strategicSummary}</dd>
            </div>
            <div className="space-y-1">
              <dt className="font-medium text-slate-500">Audiencia</dt>
              <dd className="leading-6 text-slate-800">{result.strategy.audience}</dd>
            </div>
            <div className="space-y-1">
              <dt className="font-medium text-slate-500">CTA</dt>
              <dd className="leading-6 text-slate-800">{result.strategy.callToAction}</dd>
            </div>
            <div className="space-y-2">
              <dt className="font-medium text-slate-500">Hooks</dt>
              <dd className="space-y-2">
                {result.strategy.hooks.map((hook) => (
                  <div
                    key={hook}
                    className="rounded-2xl border border-[var(--line)] bg-slate-50 px-3 py-2 leading-6 text-slate-700"
                  >
                    {hook}
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-lg font-semibold text-slate-950">Salida Meta</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Objetivo
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {result.meta.campaignObjective}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Formato
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {result.meta.recommendedFormat}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Estructura de campana
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {result.meta.campaignStructure}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Segmentacion basica
              </p>
              <div className="mt-2 space-y-2">
                {result.meta.basicSegmentation.map((segment) => (
                  <p key={segment} className="text-sm leading-6 text-slate-700">
                    {segment}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <p className="text-sm font-medium text-slate-700">Notas creativas</p>
            {result.meta.creativeNotes.map((note) => (
              <div
                key={note}
                className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700"
              >
                {note}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
        <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-lg font-semibold text-slate-950">Copy principal</h3>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Texto principal
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-800">{result.meta.primaryText}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Titulo
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{result.meta.headline}</p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Descripcion
                </p>
                <p className="mt-2 text-sm text-slate-700">{result.meta.description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  CTA recomendado
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{result.meta.callToAction}</p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Metrica principal
                </p>
                <p className="mt-2 text-sm text-slate-700">{result.meta.primaryMetric}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-lg font-semibold text-slate-950">Operacion del anuncio</h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Idea de creativo
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{result.meta.creativeIdea}</p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Presupuesto recomendado
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {result.meta.budgetRecommendation}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Checklist para publicar
              </p>
              <div className="mt-2 space-y-2">
                {result.meta.publicationChecklist.map((item) => (
                  <p key={item} className="text-sm leading-6 text-slate-700">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--primary)]" />
          <h3 className="text-lg font-semibold text-slate-950">Variantes de copy</h3>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {result.meta.copyVariants.map((variant) => (
            <article
              key={variant.id}
              className="rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {variant.id}
              </p>
              <h4 className="mt-2 text-base font-semibold text-slate-950">{variant.headline}</h4>
              <p className="mt-3 text-sm leading-6 text-slate-700">{variant.primaryText}</p>
              <p className="mt-3 text-sm leading-6 text-slate-500">{variant.description}</p>
            </article>
          ))}
        </div>
      </Card>

      <Card className="rounded-[28px] border-[var(--line)] bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-950">Bloque listo para copiar</h3>
          <span className="rounded-full border border-[var(--line)] bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            Meta Ads Manager
          </span>
        </div>

        <pre className="overflow-x-auto rounded-[24px] border border-[var(--line)] bg-slate-50 p-4 text-sm leading-6 whitespace-pre-wrap text-slate-700">
          {result.meta.readyToCopyText}
        </pre>
      </Card>
    </div>
  );
}
