"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, History, ImagePlus, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteFacebookAdsHistoryImagesAction,
  generateFacebookAdsFromImageAction,
  type FacebookAdsGeneratorState,
} from "@/app/actions/marketing-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initialState: FacebookAdsGeneratorState = {
  ok: false,
  message: "",
  creatives: [],
};

const MARKETING_HISTORY_KEY = "marketing-ia:facebook-ads-history:v1";
const creativeModes = [
  {
    value: "real",
    title: "Real",
    description: "Para productos",
  },
  {
    value: "creative",
    title: "Creativo",
    description: "Para servicios",
  },
  {
    value: "inspired",
    title: "Inspirado",
    description: "Para impacto / branding / atencion",
  },
] as const;

const steps = [
  {
    title: "🖼️ Imagen del producto",
    subtitle: "Sube la foto real que quieres convertir en anuncio.",
  },
  {
    title: "✍️ Datos del anuncio",
    subtitle: "Completa el nombre y las instrucciones para el copy.",
  },
  {
    title: "✨ Generando imagenes",
    subtitle: "La IA esta preparando tus 3 opciones.",
  },
] as const;

function ProgressDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={`h-2 rounded-full transition-all ${
        active
          ? "w-9 bg-[var(--primary)] shadow-[0_8px_18px_-10px_color-mix(in_srgb,var(--primary)_65%,black)]"
          : done
            ? "w-4 bg-[color-mix(in_srgb,var(--primary)_58%,white)]"
            : "w-4 bg-slate-200"
      }`}
    />
  );
}

type HistoryEntry = {
  id: string;
  createdAt: string;
  creatives: FacebookAdsGeneratorState["creatives"];
  sourceImageUrl?: string;
  creativeMode?: FacebookAdsGeneratorState["creativeMode"];
  productName?: string;
  productDescription?: string;
  brief?: string;
};

function buildAdsGeneratorHref(input: {
  sourceImageUrl?: string;
  creatives: FacebookAdsGeneratorState["creatives"];
  creativeMode?: FacebookAdsGeneratorState["creativeMode"];
  productName?: string;
  productDescription?: string;
  brief?: string;
}) {
  const imageUrl = input.sourceImageUrl || input.creatives[0]?.imageUrl || "";
  const params = new URLSearchParams();

  if (imageUrl) {
    params.set("imageUrl", imageUrl);
  }

  params.set("source", "creativos");

  if (input.productName?.trim()) {
    params.set("productName", input.productName.trim());
  }

  if (input.productDescription?.trim()) {
    params.set("productDescription", input.productDescription.trim());
  }

  if (input.brief?.trim()) {
    params.set("keyBenefits", input.brief.trim());
  }

  return `/cliente/marketing-ia/ads-generator?${params.toString()}`;
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Hace un momento";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function CreativeGrid({
  creatives,
  emptyTitle,
  emptyDescription,
}: {
  creatives: FacebookAdsGeneratorState["creatives"];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (creatives.length === 0) {
    return (
      <Card className="flex min-h-80 items-center justify-center rounded-[32px] border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,244,255,0.9))] p-6 text-center shadow-[0_24px_64px_-46px_rgba(42,16,81,0.24)]">
        <div className="max-w-md space-y-2">
          <p className="text-[1.1rem] font-semibold tracking-[-0.04em] text-slate-950">{emptyTitle}</p>
          <p className="text-sm leading-6 text-slate-600">{emptyDescription}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {creatives.map((creative, index) => (
        <article
          key={creative.id}
          className={`group overflow-hidden rounded-[30px] border border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(247,243,251,0.92))] shadow-[0_26px_70px_-46px_rgba(41,16,78,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_34px_84px_-50px_rgba(41,16,78,0.32)] ${
            index === 0 ? "xl:col-span-2 2xl:col-span-1" : ""
          }`}
        >
          <div className="relative aspect-square overflow-hidden bg-[radial-gradient(circle_at_top,rgba(244,238,252,0.95),rgba(232,237,244,0.9))]">
            <img
              src={creative.imageUrl}
              alt={`Anuncio ${index + 1}`}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(17,24,39,0.16),transparent)]" />
          </div>
          <div className="space-y-4 p-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {creative.angle}
              </p>
              <p className="text-[1.35rem] font-semibold tracking-[-0.05em] text-slate-950">
                {creative.headline}
              </p>
              <p className="max-w-[34ch] text-sm leading-6 text-slate-600">{creative.supportLine}</p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex rounded-full border border-[rgba(87,72,117,0.12)] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.14)]">
                {creative.cta}
              </span>
              <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(99,78,153,0.18),rgba(99,78,153,0))]" />
            </div>

            <a
              href={creative.imageUrl}
              download={`facebook-ad-${index + 1}.png`}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[rgba(87,72,117,0.12)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Descargar imagen
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SimpleMarketingForm() {
  const [state, formAction, pending] = useActionState(
    generateFacebookAdsFromImageAction,
    initialState,
  );
  const [isDeletingHistory, startDeletingHistory] = useTransition();
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [creativeMode, setCreativeMode] = useState<FacebookAdsGeneratorState["creativeMode"]>("real");
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(MARKETING_HISTORY_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as HistoryEntry[];
      return Array.isArray(parsed)
        ? parsed.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              Array.isArray(item.creatives) &&
              (typeof item.sourceImageUrl === "string" || typeof item.sourceImageUrl === "undefined") &&
              (typeof item.productName === "string" || typeof item.productName === "undefined") &&
              (typeof item.productDescription === "string" || typeof item.productDescription === "undefined") &&
              (typeof item.brief === "string" || typeof item.brief === "undefined") &&
              (item.creativeMode === "real" ||
                item.creativeMode === "creative" ||
                item.creativeMode === "inspired" ||
                typeof item.creativeMode === "undefined"),
          )
        : [];
    } catch {
      window.localStorage.removeItem(MARKETING_HISTORY_KEY);
      return [];
    }
  });

  useEffect(() => {
    if (!state.message) {
      return;
    }

    if (state.ok) {
      toast.success(state.message);
      queueMicrotask(() => {
        setModalOpen(false);
        setStep(0);
        setCreativeMode("real");
        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return "";
        });
      });
      return;
    }

    toast.error(state.message);
    queueMicrotask(() => {
      setStep(1);
    });
  }, [state]);

  useEffect(() => {
    if (!state.ok || state.creatives.length === 0) {
      return;
    }

    queueMicrotask(() => {
      setHistory((current) => {
        const next = [
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            creatives: state.creatives,
            sourceImageUrl: state.sourceImageUrl,
            creativeMode: state.creativeMode,
            productName: state.productName,
            productDescription: state.productDescription,
            brief: state.brief,
          },
          ...current,
        ].slice(0, 12);

        window.localStorage.setItem(MARKETING_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    });
  }, [
    state.ok,
    state.creatives,
    state.sourceImageUrl,
    state.creativeMode,
    state.productName,
    state.productDescription,
    state.brief,
  ]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const creatives = useMemo(() => state.creatives, [state.creatives]);
  const activeStep = pending ? 2 : step;
  const latestCreatives = creatives.length > 0 ? creatives : history[0]?.creatives ?? [];
  const hasGeneratedCreatives = latestCreatives.length > 0 || history.length > 0;
  const latestAdsGeneratorHref = latestCreatives.length > 0
    ? buildAdsGeneratorHref({
        sourceImageUrl: state.sourceImageUrl ?? history[0]?.sourceImageUrl,
        creatives: latestCreatives,
        creativeMode: state.creativeMode ?? history[0]?.creativeMode,
        productName: state.productName ?? history[0]?.productName,
        productDescription: state.productDescription ?? history[0]?.productDescription,
        brief: state.brief ?? history[0]?.brief,
      })
    : null;

  const openModal = () => {
    setStep(0);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (pending) {
      return;
    }

    setModalOpen(false);
    setStep(0);
  };

  const removeHistoryEntry = (id: string) => {
    const entry = history.find((item) => item.id === id);
    if (!entry || isDeletingHistory) {
      return;
    }

    setDeletingEntryId(id);
    startDeletingHistory(async () => {
      const result = await deleteFacebookAdsHistoryImagesAction({
        imageUrls: entry.creatives.map((creative) => creative.imageUrl),
        sourceImageUrl: entry.sourceImageUrl,
      });

      if (!result.ok) {
        toast.error(result.message);
        setDeletingEntryId(null);
        return;
      }

      setHistory((current) => {
        const next = current.filter((item) => item.id !== id);
        window.localStorage.setItem(MARKETING_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
      toast.success(result.message);
      setDeletingEntryId(null);
    });
  };

  return (
    <div className="space-y-5">
      {hasGeneratedCreatives ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openModal}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_18px_34px_-22px_color-mix(in_srgb,var(--primary)_62%,black)] transition hover:bg-[var(--primary-strong)]"
          >
            <Plus className="h-4 w-4" />
            Crear anuncio
          </button>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[34px] border border-[rgba(87,72,117,0.14)] bg-[linear-gradient(155deg,rgba(255,255,255,0.96),rgba(248,243,255,0.95)_52%,rgba(240,235,247,0.98))] p-6 shadow-[0_28px_80px_-52px_rgba(42,16,83,0.3)] sm:p-8">
          <div className="relative flex min-h-[280px] flex-col items-center justify-center text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] shadow-[0_18px_40px_-28px_color-mix(in_srgb,var(--primary)_38%,black)]">
              <Sparkles className="h-7 w-7" />
            </div>

            <div className="mt-6 max-w-2xl space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Creativos
              </p>
              <h2 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[2.25rem]">
                Crea tu anuncio
              </h2>
              <p className="text-sm leading-7 text-slate-600 sm:text-base">
                Sube una foto real del producto y genera piezas listas para vender.
              </p>
            </div>

            <button
              type="button"
              onClick={openModal}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_18px_34px_-22px_color-mix(in_srgb,var(--primary)_62%,black)] transition hover:bg-[var(--primary-strong)]"
            >
              <Plus className="h-4 w-4" />
              Crear anuncio
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(99,78,153,0.18),rgba(99,78,153,0))]" />
            <div className="h-2 w-2 rounded-full bg-[color-mix(in_srgb,var(--primary)_65%,white)]" />
          </div>
          {latestAdsGeneratorHref ? (
            <Link
              href={latestAdsGeneratorHref}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Llevar al Ads Generator
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
        <CreativeGrid
          creatives={latestCreatives}
          emptyTitle="Aqui apareceran tus 3 anuncios"
          emptyDescription="Sube una foto del producto, completa el formulario y te devolvemos tres creativos con texto comercial integrado."
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-900">Historial</h3>
        </div>

        {history.length > 0 ? (
          <div className="space-y-4">
            {history.map((entry, entryIndex) => (
              <Card key={entry.id} className="space-y-4 rounded-[30px] border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,244,255,0.9))] p-4 shadow-[0_24px_64px_-48px_rgba(41,16,79,0.28)] sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Generacion {history.length - entryIndex}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatHistoryDate(entry.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={buildAdsGeneratorHref(entry)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Usar en Ads Generator
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeHistoryEntry(entry.id)}
                      disabled={isDeletingHistory}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      {deletingEntryId === entry.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      {deletingEntryId === entry.id ? "Eliminando..." : "Eliminar"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {entry.creatives.map((creative, index) => (
                    <article
                      key={creative.id}
                      className="overflow-hidden rounded-[24px] border border-[rgba(87,72,117,0.12)] bg-white shadow-[0_18px_36px_-30px_rgba(15,23,42,0.22)]"
                    >
                      <div className="relative aspect-square bg-slate-100">
                        <img
                          src={creative.imageUrl}
                          alt={`Historial ${entryIndex + 1} opcion ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-2 p-3.5">
                        <p className="text-sm font-semibold text-slate-900">
                          {creative.headline}
                        </p>
                        <p className="text-xs text-slate-600">{creative.supportLine}</p>
                        <a
                          href={creative.imageUrl}
                          download={`facebook-ad-history-${entryIndex + 1}-${index + 1}.png`}
                          className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[rgba(87,72,117,0.12)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Descargar
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rounded-[28px] border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,244,255,0.9))] p-6 text-center shadow-[0_18px_48px_-40px_rgba(43,17,86,0.24)]">
            <p className="text-sm text-slate-600">
              Aun no hay historial guardado de anuncios generados.
            </p>
          </Card>
        )}
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[radial-gradient(circle_at_top,rgba(35,25,57,0.58),rgba(15,23,42,0.74))] p-0 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Crear anuncio"
          onClick={closeModal}
        >
          <div
            className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-none border border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,#fbf8ff_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[36px] md:shadow-[0_50px_120px_-56px_rgba(27,18,56,0.56)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,244,255,0.9)_100%)] px-5 py-5 md:px-8 md:py-5">
              <div className="relative flex items-start justify-center gap-4">
                <div className="space-y-2 text-center">
                  <div className="flex flex-wrap justify-center gap-2">
                    {steps.map((item, index) => (
                      <ProgressDot
                        key={item.title}
                        active={index === activeStep}
                        done={index < activeStep}
                      />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-[1.45rem] font-semibold tracking-[-0.05em] text-slate-950 md:text-[1.7rem]">
                      {steps[activeStep].title}
                    </h2>
                    {!pending ? (
                      <p className="text-sm text-slate-600">
                        {steps[activeStep].subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(87,72,117,0.12)] bg-white/92 text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Cerrar"
                  disabled={pending}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form
              action={formAction}
              className="flex min-h-0 flex-1 flex-col"
              onSubmitCapture={() => {
                setStep(2);
              }}
            >
              <div
                className={
                  pending
                    ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                    : "flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f3edf8_0%,#f7f3fb_18%,#f1f3f5_100%)] px-5 py-6 md:px-8 md:py-6"
                }
              >
                {pending ? (
                  <div className="mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center">
                    <div className="relative flex h-28 w-28 items-center justify-center">
                      <div className="absolute inset-0 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]" />
                      <div className="absolute inset-[10px] rounded-full border border-[color-mix(in_srgb,var(--primary)_20%,white)]" />
                      <LoaderCircle className="absolute h-24 w-24 animate-spin text-[color-mix(in_srgb,var(--primary)_42%,white)]" />
                      <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_14%,white)] text-[var(--primary)] shadow-[0_18px_40px_-24px_color-mix(in_srgb,var(--primary)_45%,black)]">
                        <Sparkles className="h-8 w-8" />
                      </div>
                    </div>

                    <div className="mt-7 space-y-3">
                      <h3 className="text-[1.7rem] font-semibold tracking-[-0.05em] text-slate-950 md:text-[1.9rem]">
                        ✨ Generando tus imagenes
                      </h3>
                      <p className="text-base leading-7 text-slate-600">
                        Estamos ajustando la foto del producto y creando 3 anuncios
                        con texto comercial listo para vender.
                      </p>
                    </div>

                    <div className="mt-8 w-full space-y-3">
                      <div className="h-3 overflow-hidden rounded-full bg-[rgba(148,163,184,0.14)] p-[3px]">
                        <div className="h-full w-[58%] animate-pulse rounded-full bg-[var(--primary)] shadow-[0_10px_20px_-12px_color-mix(in_srgb,var(--primary)_70%,black)]" />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        <span>Mejorando foto</span>
                        <span>Aplicando copy</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-[760px]">
                    <div className={step === 0 ? "block" : "hidden"}>
                      <section className="space-y-4 md:space-y-5">
                        <div className="rounded-[30px] border border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,246,255,0.9))] p-4 shadow-[0_24px_54px_-42px_rgba(35,19,71,0.2)] sm:p-5">
                          <label className="block space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Foto del producto</span>
                            <div className="overflow-hidden rounded-[24px] border border-dashed border-[rgba(87,72,117,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,241,252,0.92))]">
                              <div className="flex min-h-72 items-center justify-center bg-white p-4">
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt="Vista previa del producto"
                                    className="max-h-64 w-full object-contain"
                                  />
                                ) : (
                                  <div className="space-y-2 text-center">
                                    <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                                      <ImagePlus className="h-5 w-5" />
                                    </div>
                                    <p className="text-sm font-medium text-slate-700">Sube la imagen del articulo</p>
                                    <p className="text-xs text-slate-500">
                                      La IA la mejora un poco, pero conserva el producto real.
                                    </p>
                                  </div>
                                )}
                              </div>
                              <div className="border-t border-[var(--line)] p-3">
                                <Input
                                  name="image"
                                  type="file"
                                  accept="image/*"
                                  required
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (!file) {
                                      setPreviewUrl("");
                                      return;
                                    }

                                    setPreviewUrl((current) => {
                                      if (current) {
                                        URL.revokeObjectURL(current);
                                      }
                                      return URL.createObjectURL(file);
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          </label>
                        </div>
                      </section>
                    </div>

                    <div className={step === 1 ? "block" : "hidden"}>
                      <section className="space-y-4 md:space-y-5">
                        <div className="rounded-[30px] border border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,246,255,0.9))] p-4 shadow-[0_24px_54px_-42px_rgba(35,19,71,0.2)] sm:p-5">
                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <input type="hidden" name="creativeMode" value={creativeMode ?? "real"} />
                              <span className="text-sm font-medium text-slate-700">Tipo de generacion</span>
                              <div className="grid gap-3 md:grid-cols-3">
                                {creativeModes.map((mode) => {
                                  const selected = creativeMode === mode.value;
                                  return (
                                    <button
                                      key={mode.value}
                                      type="button"
                                      onClick={() => setCreativeMode(mode.value)}
                                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                                        selected
                                          ? "border-[var(--primary)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_9%,white),rgba(255,255,255,0.92))] shadow-[0_20px_36px_-28px_color-mix(in_srgb,var(--primary)_42%,black)]"
                                          : "border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(252,251,255,0.9),rgba(247,243,251,0.88))] hover:border-[rgba(87,72,117,0.22)] hover:bg-white"
                                      }`}
                                      aria-pressed={selected}
                                    >
                                      <span className="block text-sm font-semibold text-slate-900">{mode.title}</span>
                                      <span className="mt-1 block text-xs leading-5 text-slate-500">{mode.description}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-slate-700">Nombre del producto</span>
                              <Input name="productName" placeholder="Ej. Perfume arabe premium" required />
                            </label>

                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-slate-700">Descripcion</span>
                              <textarea
                                name="productDescription"
                                rows={3}
                                className="field-textarea min-h-20"
                                placeholder="Describe rapido el articulo, beneficios o lo que lo hace atractivo."
                              />
                            </label>

                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-slate-700">Instrucciones extra</span>
                              <textarea
                                name="brief"
                                rows={4}
                                className="field-textarea min-h-24"
                                placeholder="Ej. resaltar lujo, oferta por tiempo limitado, tono femenino, envio gratis..."
                              />
                            </label>

                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </div>

              {!pending ? (
                <div className="flex items-center justify-between border-t border-[rgba(87,72,117,0.12)] bg-[rgba(255,255,255,0.9)] px-5 py-4 backdrop-blur md:px-8">
                  <button
                    type="button"
                    onClick={() => setStep((current) => Math.max(current - 1, 0))}
                    disabled={step === 0}
                    className="inline-flex h-12 min-w-[120px] items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-5 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.16)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Volver
                  </button>

                  {step < 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!previewUrl) {
                          toast.error("Primero debes subir la imagen del producto.");
                          return;
                        }
                        setStep(1);
                      }}
                      className="inline-flex h-12 min-w-[186px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
                    >
                      Continuar
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
                    >
                      <Sparkles className="h-4 w-4" />
                      Generar 3 anuncios
                    </button>
                  )}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
