"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, ImagePlus, LoaderCircle, Megaphone, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import { generateFacebookAdsCreativeAction } from "@/app/actions/marketing-actions";
import {
  facebookAdsAspectRatioOptions,
  facebookAdsObjectiveOptions,
  facebookAdsToneOptions,
  type FacebookAdsFormInput,
} from "@/lib/marketing";

type FacebookAdsDraft = FacebookAdsFormInput & {
  referenceImageUrl?: string | null;
};

type FacebookAdsFormProps = {
  initialValues: FacebookAdsDraft | null;
  okMessage?: string;
  selectedHistoryId?: string;
};

const STORAGE_KEY = "marketing-ia-facebook-ads-draft";

const steps = [
  {
    title: "Producto y formato",
    subtitle: "Sube la imagen base del producto y elige el formato del anuncio.",
  },
  {
    title: "Objetivo y oferta",
    subtitle: "Define que quieres vender y cual es la propuesta principal del anuncio.",
  },
  {
    title: "Publico y tono",
    subtitle: "Aterriza para quien va el anuncio y como debe sonar el mensaje.",
  },
  {
    title: "Cierre y direccion visual",
    subtitle: "Define el diferenciador, CTA y una guia visual opcional para el anuncio.",
  },
] as const;

const emptyDraft: FacebookAdsDraft = {
  aspectRatio: facebookAdsAspectRatioOptions[0].value,
  campaignObjective: facebookAdsObjectiveOptions[0],
  productName: "",
  productDescription: "",
  targetAudience: "",
  tone: facebookAdsToneOptions[1],
  offerDetails: "",
  callToAction: "",
  differentiator: "",
  visualDirection: "",
  referenceImageUrl: "",
};

function loadDraft(): FacebookAdsDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as FacebookAdsDraft;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      ...emptyDraft,
      ...parsed,
    };
  } catch {
    return null;
  }
}

function saveDraft(value: FacebookAdsDraft) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Si storage no esta disponible, el flujo sigue funcionando.
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin impacto funcional.
  }
}

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

function StepFrame({ children }: { children: ReactNode }) {
  return <section className="space-y-4 md:space-y-5">{children}</section>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function FacebookAdsForm({
  initialValues,
  okMessage,
  selectedHistoryId,
}: FacebookAdsFormProps) {
  const [values, setValues] = useState<FacebookAdsDraft>(() => {
    if (selectedHistoryId && initialValues) {
      return initialValues;
    }

    if (typeof window !== "undefined") {
      const stored = loadDraft();
      if (stored) {
        return stored;
      }
    }

    return initialValues ?? emptyDraft;
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (okMessage) {
      clearDraft();
    }
  }, [okMessage]);

  useEffect(() => {
    if (okMessage) {
      return;
    }

    saveDraft(values);
  }, [okMessage, values]);

  const updateField = <K extends keyof FacebookAdsDraft>(key: K, value: FacebookAdsDraft[K]) => {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleReferenceImageChange = (file: File | null) => {
    if (!file) {
      updateField("referenceImageUrl", "");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    updateField("referenceImageUrl", objectUrl);
  };

  const openCreateFlow = () => {
    setStep(0);
    setIsSubmitting(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }

    setModalOpen(false);
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, steps.length - 1));
  const previousStep = () => setStep((current) => Math.max(current - 1, 0));

  const submitFlow = () => {
    setIsSubmitting(true);
    formRef.current?.requestSubmit();
  };

  return (
    <>
      <div className="space-y-4">
        <button
          type="button"
          onClick={openCreateFlow}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
        >
          <WandSparkles className="h-4 w-4" />
          Configurar el anuncio
        </button>

        <p className="text-sm leading-7 text-slate-600">
          Abre un asistente guiado paso a paso para definir el anuncio antes de generar el creativo.
        </p>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Configurar anuncio"
          onClick={closeModal}
        >
          <div
            className="flex h-full w-full max-w-[1040px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-4 md:px-8 md:py-4">
              <div className="relative flex items-start gap-4 pr-12">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
                      Paso {step + 1} de {steps.length}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {steps.map((item, index) => (
                        <ProgressDot key={item.title} active={index === step} done={index < step} />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold tracking-[-0.05em] text-slate-950 md:text-2xl">
                      {steps[step].title}
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-slate-600">{steps[step].subtitle}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Cerrar"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form ref={formRef} action={generateFacebookAdsCreativeAction} noValidate className="flex min-h-0 flex-1 flex-col">
              <div
                className={
                  isSubmitting
                    ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                    : "flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4"
                }
              >
                {isSubmitting ? (
                  <div className="mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center">
                    <div className="relative flex h-28 w-28 items-center justify-center">
                      <div className="absolute inset-0 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]" />
                      <div className="absolute inset-[10px] rounded-full border border-[color-mix(in_srgb,var(--primary)_20%,white)]" />
                      <LoaderCircle className="absolute h-24 w-24 animate-spin text-[color-mix(in_srgb,var(--primary)_42%,white)]" />
                      <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_14%,white)] text-[var(--primary)] shadow-[0_18px_40px_-24px_color-mix(in_srgb,var(--primary)_45%,black)]">
                        <Megaphone className="h-8 w-8" />
                      </div>
                    </div>

                    <div className="mt-7 space-y-3">
                      <h3 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950">
                        Generando tu creativo
                      </h3>
                      <p className="text-base leading-7 text-slate-600">
                        Estamos creando los copies, el prompt visual y la imagen para tu anuncio.
                      </p>
                    </div>

                    <div className="mt-8 w-full space-y-3">
                      <div className="h-3 overflow-hidden rounded-full bg-[rgba(148,163,184,0.14)] p-[3px]">
                        <div className="h-full w-[62%] animate-pulse rounded-full bg-[var(--primary)] shadow-[0_10px_20px_-12px_color-mix(in_srgb,var(--primary)_70%,black)]" />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        <span>Analizando</span>
                        <span>Escribiendo</span>
                        <span>Renderizando</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-4xl">
                    <div className={step === 0 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                          <div className="space-y-3">
                            <Field label="Imagen base del producto">
                              <input
                                ref={fileInputRef}
                                type="file"
                                name="referenceImage"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) =>
                                  handleReferenceImageChange(event.target.files?.[0] ?? null)
                                }
                              />

                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex min-h-[220px] w-full items-center justify-center rounded-[28px] border border-dashed border-[rgba(148,163,184,0.24)] bg-white px-5 py-6 text-center transition hover:border-[var(--primary)]/40"
                              >
                                {values.referenceImageUrl ? (
                                  <div className="w-full space-y-3">
                                    <div className="overflow-hidden rounded-[22px] border border-[rgba(148,163,184,0.14)]">
                                      <Image
                                        src={values.referenceImageUrl}
                                        alt="Referencia del producto"
                                        width={800}
                                        height={800}
                                        className="h-56 w-full object-cover"
                                        unoptimized={values.referenceImageUrl.startsWith("blob:")}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-sm font-medium text-slate-700">Imagen cargada</span>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (fileInputRef.current) {
                                            fileInputRef.current.value = "";
                                          }
                                          updateField("referenceImageUrl", "");
                                        }}
                                        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Quitar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                                      <ImagePlus className="h-6 w-6" />
                                    </span>
                                    <div className="space-y-1">
                                      <p className="text-sm font-semibold text-slate-900">Subir imagen del producto</p>
                                      <p className="text-sm leading-6 text-slate-600">
                                        Recomendado para mantener mejor la fidelidad visual del producto.
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </button>
                            </Field>
                          </div>

                          <div className="space-y-4">
                            <Field label="Formato del anuncio">
                              <div className="grid gap-3">
                                {facebookAdsAspectRatioOptions.map((option) => (
                                  <label key={option.value} className="cursor-pointer">
                                    <input
                                      type="radio"
                                      name="aspectRatio"
                                      value={option.value}
                                      checked={values.aspectRatio === option.value}
                                      onChange={() => updateField("aspectRatio", option.value)}
                                      className="peer sr-only"
                                    />
                                    <span className="flex items-center justify-between rounded-[22px] border border-[rgba(148,163,184,0.16)] bg-white px-4 py-4 text-sm font-medium text-slate-700 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_6%,white)] peer-checked:text-[var(--primary)]">
                                      <span>{option.label}</span>
                                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                        {option.value}
                                      </span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </Field>

                            <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-5 text-sm leading-7 text-slate-600">
                              El formato elegido se usara para la composicion final de la pieza publicitaria.
                            </div>
                          </div>
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 1 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Objetivo de campana">
                            <select
                              name="campaignObjective"
                              value={values.campaignObjective}
                              onChange={(event) => updateField("campaignObjective", event.target.value)}
                              className="field-select"
                              required
                            >
                              {facebookAdsObjectiveOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </Field>

                          <Field label="Oferta o promocion">
                            <input
                              name="offerDetails"
                              value={values.offerDetails}
                              onChange={(event) => updateField("offerDetails", event.target.value)}
                              className="field-input"
                              placeholder="Ej. Envio gratis y descuento del 10% esta semana"
                              required
                            />
                          </Field>
                        </div>

                        <Field label="Producto o servicio">
                          <input
                            name="productName"
                            value={values.productName}
                            onChange={(event) => updateField("productName", event.target.value)}
                            className="field-input"
                            placeholder="Ej. Silla de barberia premium"
                            required
                          />
                        </Field>

                        <Field label="Descripcion del producto o servicio">
                          <textarea
                            name="productDescription"
                            value={values.productDescription}
                            onChange={(event) => updateField("productDescription", event.target.value)}
                            rows={5}
                            className="field-textarea"
                            placeholder="Describe beneficios, resultado, materiales, formato o promesa principal."
                            required
                          />
                        </Field>
                      </StepFrame>
                    </div>

                    <div className={step === 2 ? "block" : "hidden"}>
                      <StepFrame>
                        <Field label="Publico objetivo">
                          <textarea
                            name="targetAudience"
                            value={values.targetAudience}
                            onChange={(event) => updateField("targetAudience", event.target.value)}
                            rows={5}
                            className="field-textarea"
                            placeholder="Ej. Barberos duenos de negocio que quieren elevar la imagen de su local."
                            required
                          />
                        </Field>

                        <Field label="Tono del anuncio">
                          <select
                            name="tone"
                            value={values.tone}
                            onChange={(event) => updateField("tone", event.target.value)}
                            className="field-select"
                            required
                          >
                            {facebookAdsToneOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </StepFrame>
                    </div>

                    <div className={step === 3 ? "block" : "hidden"}>
                      <StepFrame>
                        <Field label="Diferenciador principal">
                          <textarea
                            name="differentiator"
                            value={values.differentiator}
                            onChange={(event) => updateField("differentiator", event.target.value)}
                            rows={4}
                            className="field-textarea"
                            placeholder="Ej. Diseno premium, garantia, personalizacion, instalacion incluida."
                            required
                          />
                        </Field>

                        <Field label="CTA">
                          <input
                            name="callToAction"
                            value={values.callToAction}
                            onChange={(event) => updateField("callToAction", event.target.value)}
                            className="field-input"
                            placeholder="Ej. Escribenos hoy"
                            required
                          />
                        </Field>

                        <Field label="Direccion visual">
                          <textarea
                            name="visualDirection"
                            value={values.visualDirection}
                            onChange={(event) => updateField("visualDirection", event.target.value)}
                            rows={5}
                            className="field-textarea"
                            placeholder="Opcional. Ej. Fondo elegante oscuro, producto protagonista, luz cinematografica, estilo premium y realista."
                          />
                        </Field>

                        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-5 text-sm leading-7 text-slate-600">
                          Si no defines una direccion visual, el sistema usara una guia base profesional para generar la imagen del anuncio.
                        </div>
                      </StepFrame>
                    </div>
                  </div>
                )}
              </div>

              {!isSubmitting ? (
                <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.92)] px-5 py-4 backdrop-blur md:px-8">
                  <button
                    type="button"
                    onClick={previousStep}
                    disabled={step === 0 || isSubmitting}
                    className="inline-flex h-12 min-w-[120px] items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-5 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.16)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Volver
                  </button>

                  {step < steps.length - 1 ? (
                    <button
                      type="button"
                      onClick={nextStep}
                      className="inline-flex h-12 min-w-[186px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
                    >
                      Continuar
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={submitFlow}
                      className="inline-flex h-12 min-w-[186px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
                    >
                      Generar creativo
                      <Sparkles className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
