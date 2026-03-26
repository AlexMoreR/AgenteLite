"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { History, ImagePlus, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
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

const steps = [
  {
    title: "Imagen del producto",
    subtitle: "Sube la foto real que quieres convertir en anuncio.",
  },
  {
    title: "Datos del anuncio",
    subtitle: "Completa el nombre y las instrucciones para el copy.",
  },
  {
    title: "Generando imagenes",
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
};

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
      <Card className="flex min-h-80 items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-base font-semibold text-slate-900">{emptyTitle}</p>
          <p className="text-sm leading-6 text-slate-600">{emptyDescription}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {creatives.map((creative, index) => (
        <article
          key={creative.id}
          className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_20px_40px_-34px_rgba(15,23,42,0.45)]"
        >
          <div className="relative aspect-square bg-slate-100">
            <img
              src={creative.imageUrl}
              alt={`Anuncio ${index + 1}`}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
              Opcion {index + 1}
            </span>
          </div>
          <div className="space-y-3 p-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {creative.angle}
              </p>
              <p className="text-lg font-semibold tracking-tight text-slate-900">
                {creative.headline}
              </p>
              <p className="text-sm text-slate-600">{creative.supportLine}</p>
              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {creative.cta}
              </span>
            </div>

            <a
              href={creative.imageUrl}
              download={`facebook-ad-${index + 1}.png`}
              className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
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
        ? parsed.filter((item) => Array.isArray(item.creatives))
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
          },
          ...current,
        ].slice(0, 12);

        window.localStorage.setItem(MARKETING_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    });
  }, [state.ok, state.creatives]);

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
    setHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      window.localStorage.setItem(MARKETING_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openModal}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
        >
          <Plus className="h-4 w-4" />
          Crear anuncio
        </button>
      </div>

      <section className="space-y-3">

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
              <Card key={entry.id} className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Generacion {history.length - entryIndex}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatHistoryDate(entry.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeHistoryEntry(entry.id)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {entry.creatives.map((creative, index) => (
                    <article
                      key={creative.id}
                      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white"
                    >
                      <div className="relative aspect-square bg-slate-100">
                        <img
                          src={creative.imageUrl}
                          alt={`Historial ${entryIndex + 1} opcion ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                          Opcion {index + 1}
                        </span>
                      </div>
                      <div className="space-y-2 p-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {creative.headline}
                        </p>
                        <p className="text-xs text-slate-600">{creative.supportLine}</p>
                        <a
                          href={creative.imageUrl}
                          download={`facebook-ad-history-${entryIndex + 1}-${index + 1}.png`}
                          className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-[var(--line)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
          <Card className="p-6 text-center">
            <p className="text-sm text-slate-600">
              Aun no hay historial guardado de anuncios generados.
            </p>
          </Card>
        )}
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Crear anuncio"
          onClick={closeModal}
        >
          <div
            className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
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
                    <h2 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2.1rem]">
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
                  className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                    : "flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-5"
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
                      <h3 className="text-[2.1rem] font-semibold tracking-[-0.06em] text-slate-950">
                        Generando tus imagenes
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
                        <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)] sm:p-5">
                          <label className="block space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Foto del producto</span>
                            <div className="overflow-hidden rounded-2xl border border-dashed border-[var(--line-strong)] bg-slate-50">
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
                        <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)] sm:p-5">
                          <div className="grid gap-4">
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
                <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.92)] px-5 py-4 backdrop-blur md:px-8">
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
