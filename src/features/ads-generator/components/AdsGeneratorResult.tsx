"use client";

import { Copy, FileText, Megaphone } from "lucide-react";
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
      <Card className="rounded-2xl border-border bg-card p-6 sm:p-7">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Resultado
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Generando propuesta mock
          </h2>
          <p className="max-w-[58ch] text-sm leading-6 text-muted-foreground">
            El modulo esta recorriendo el pipeline interno para devolverte estrategia, copies
            y salida lista para copiar.
          </p>
        </div>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="rounded-2xl border-border bg-card p-6 sm:p-7">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Resultado
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Aqui apareceran tus anuncios
          </h2>
          <p className="max-w-[58ch] text-sm leading-6 text-muted-foreground">
            Completa el formulario y el modulo `ads-generator` te devolvera una estructura lista
            para revisar y copiar.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border bg-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Resultado
            </p>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
              Salida base lista para revisar
            </h2>
            <p className="max-w-[58ch] text-sm leading-6 text-muted-foreground">{result.summary}</p>
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
        <Card className="rounded-2xl border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Copy principal</h3>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-muted px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Texto principal
              </p>
              <p className="mt-2 text-sm leading-6 text-foreground">{result.meta.primaryText}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Titulo
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">{result.meta.headline}</p>
              </div>
              <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Descripcion
                </p>
                <p className="mt-2 text-sm text-foreground">{result.meta.description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  CTA recomendado
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">{result.meta.callToAction}</p>
              </div>
              <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Metrica principal
                </p>
                <p className="mt-2 text-sm text-foreground">{result.meta.primaryMetric}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Sugerencias del anuncio</h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-muted px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Idea de creativo</p>
              <p className="mt-2 text-sm leading-6 text-foreground">{result.meta.creativeIdea}</p>
            </div>

            <div className="rounded-2xl border border-border bg-muted px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Presupuesto recomendado</p>
              <p className="mt-2 text-sm leading-6 text-foreground">
                {result.meta.budgetRecommendation}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-muted px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Checklist para publicar</p>
              <div className="mt-2 space-y-2">
                {result.meta.publicationChecklist.map((item) => (
                  <p key={item} className="text-sm leading-6 text-foreground">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Variantes de copy</h3>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {result.meta.copyVariants.map((variant) => (
            <article
              key={variant.id}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {variant.id}
              </p>
              <h4 className="mt-2 text-base font-semibold text-foreground">{variant.headline}</h4>
              <p className="mt-3 text-sm leading-6 text-foreground">{variant.primaryText}</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{variant.description}</p>
            </article>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">Bloque listo para copiar</h3>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Meta Ads Manager
          </span>
        </div>

        <pre className="overflow-x-auto rounded-2xl border border-border bg-muted p-4 text-sm leading-6 whitespace-pre-wrap text-foreground">
          {result.meta.readyToCopyText}
        </pre>
      </Card>
    </div>
  );
}
