"use client";

import Image from "next/image";
import { AlertCircle, ArrowDownToLine, ImagePlus, Plus, SendHorizonal, Trash2, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { AdsGeneratorForm } from "./AdsGeneratorForm";
import { AdsGeneratorResult as AdsGeneratorResultView } from "./AdsGeneratorResult";
import type { FacebookAdCreative } from "@/lib/facebook-ad-creatives";

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
  const [uploadedImages, setUploadedImages] = useState<Array<{ id: string; url: string; name: string; file: File }>>([]);
  const [generatedCreatives, setGeneratedCreatives] = useState<FacebookAdCreative[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    return () => {
      uploadedImages.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, [uploadedImages]);

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
      image:
        uploadedImages[0]
          ? {
              url: uploadedImages[0].url,
              alt: uploadedImages[0].name || "Imagen del producto",
              source: "upload" as const,
              isPrimary: true,
            }
          : initialInput?.image,
    }),
    [draftPrompt, initialInput, uploadedImages],
  );

  const handleUploadImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setUploadedImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.url));

      return files.slice(0, 4).map((file, index) => ({
        id: `${file.name}-${index}-${file.lastModified}`,
        url: URL.createObjectURL(file),
        name: file.name,
        file,
      }));
    });

    event.target.value = "";
  };

  const handleGenerateCreatives = async () => {
    setPending(true);
    setError(null);

    try {
      const formData = new FormData();
      const primaryFile = uploadedImages[0]?.file;
      const primaryImageUrl = uploadedImages[0]?.url || initialInput?.image?.url || "";
      const prompt = draftPrompt.trim();

      if (primaryFile) {
        formData.append("image", primaryFile);
      }

      if (primaryImageUrl) {
        formData.append("sourceImageUrl", primaryImageUrl);
      }

      formData.append("prompt", prompt);
      formData.append("productName", initialInput?.productName?.trim() || "");
      formData.append("creativeMode", "real");
      formData.append("creativeCount", String(variantCount));

      const response = await fetch("/api/marketing-ia/ads-generator/creatives", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { creatives?: FacebookAdCreative[]; sourceImageUrl?: string; error?: string }
        | undefined;

      if (!response.ok || !payload?.creatives?.length) {
        throw new Error(payload?.error || "No pudimos generar los creativos en este momento.");
      }

      setGeneratedCreatives(payload.creatives);
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "No pudimos generar los creativos en este momento.",
      );
    } finally {
      setPending(false);
    }
  };

  const handleRemoveCreative = (creativeId: string) => {
    setGeneratedCreatives((current) => current.filter((creative) => creative.id !== creativeId));
  };

  const handleRemoveUploadedImage = (imageId: string) => {
    setUploadedImages((current) => {
      const next = current.filter((image) => image.id !== imageId);
      const removed = current.find((image) => image.id === imageId);

      if (removed) {
        URL.revokeObjectURL(removed.url);
      }

      return next;
    });
  };

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
      {error ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[var(--danger-line)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-fg)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-white shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)]">
        <div className="px-4 py-5 md:px-6 md:py-6">
          {result ? (
            <AdsGeneratorResultView pending={pending} result={result} />
          ) : (
            <div className="mx-auto flex min-h-[50vh] w-full max-w-6xl flex-col justify-center">
              <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#14213d_0%,#1d2d5a_100%)] p-4 text-white shadow-[0_28px_72px_-48px_rgba(15,23,42,0.26),inset_0_1px_0_rgba(255,255,255,0.05)] md:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.08)] text-[#8fb4ff] ring-1 ring-[rgba(143,180,255,0.2)]">
                      <ImagePlus className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-semibold tracking-[-0.03em] text-white">
                          Imagenes seleccionadas: {uploadedImages.length || (initialInput?.image?.url ? 1 : 0)}/10
                        </p>
                        <p className="text-sm text-[rgba(226,232,240,0.76)]">
                          Arrastra, elige o genera con IA las imagenes que quieres usar en el anuncio.
                        </p>
                        {sourceHint ? (
                          <p className="text-xs text-[#9dc0ff]">
                            Fuente detectada: {sourceHint}.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-full border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] px-4 text-white shadow-none hover:bg-[rgba(255,255,255,0.12)] hover:text-white"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      Subir imagenes
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: variantCount }).map((_, index) => {
                      const creative = generatedCreatives[index];

                      if (creative) {
                        return (
                          <div
                            key={creative.id}
                            className="group relative aspect-square overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] shadow-[0_22px_40px_-28px_rgba(8,15,35,0.55)]"
                          >
                            <Image
                              src={creative.imageUrl}
                              alt={creative.headline || `Creativo ${index + 1}`}
                              fill
                              className="object-contain"
                              unoptimized
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-[rgba(7,14,30,0.45)] opacity-0 transition duration-200 group-hover:opacity-100">
                              <div className="flex items-center gap-2">
                                <a
                                  href={creative.imageUrl}
                                  download={`creative-${index + 1}.png`}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.12)] text-white backdrop-blur-sm transition hover:bg-[rgba(255,255,255,0.18)]"
                                  aria-label="Descargar imagen"
                                >
                                  <ArrowDownToLine className="h-4 w-4" />
                                </a>
                                <button
                                  type="button"
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.12)] text-white backdrop-blur-sm transition hover:bg-[rgba(255,255,255,0.18)]"
                                  onClick={() => handleRemoveCreative(creative.id)}
                                  aria-label="Eliminar imagen"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={`creative-slot-${index}`}
                          className="group relative aspect-[4/5] rounded-[24px] border border-dashed border-[rgba(143,180,255,0.22)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]"
                        >
                          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.08)] text-[#8fb4ff]">
                              <Plus className="h-5 w-5" />
                            </span>
                            <span className="px-4 text-xs font-medium text-[rgba(226,232,240,0.8)]">
                              Creativo {index + 1}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="mt-3 text-xs text-[rgba(226,232,240,0.72)]">
                    {generatedCreatives.length > 0
                      ? `${generatedCreatives.length} creativo${generatedCreatives.length === 1 ? "" : "s"} generado${generatedCreatives.length === 1 ? "" : "s"} para este producto.`
                      : "Aqui veras los creativos disenados cuando se generen."}
                  </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#14213d_0%,#1d2d5a_100%)] px-4 py-4 md:px-6 md:py-5">
          <div className="rounded-[30px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-2.5">
            <label className="block">
              <span className="sr-only">Describe el producto o servicio</span>
              <div className="rounded-[26px] bg-transparent px-3 py-2 md:px-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handleUploadImages}
                  />
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-[rgba(255,255,255,0.1)]"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 text-[#8fb4ff]" />
                    Subir imagenes
                  </button>
                  {uploadedImages.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center -space-x-3">
                        {uploadedImages.slice(0, 4).map((image) => (
                          <div
                            key={image.id}
                            className="group relative h-11 w-11 overflow-hidden rounded-[14px] border-2 border-white bg-slate-100 shadow-[0_10px_20px_-14px_rgba(15,23,42,0.35)]"
                          >
                            <Image src={image.url} alt={image.name} fill className="object-cover" unoptimized />
                            <button
                              type="button"
                              className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(15,23,42,0.88)] text-white opacity-0 shadow-sm transition group-hover:opacity-100"
                              onClick={() => handleRemoveUploadedImage(image.id)}
                              aria-label="Eliminar miniatura"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <span className="text-[11px] font-medium text-[rgba(226,232,240,0.76)]">
                        {uploadedImages.length} imagen{uploadedImages.length === 1 ? "" : "es"} lista{uploadedImages.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : initialInput?.image?.url ? (
                    <div className="flex items-center gap-2">
                      <div className="relative h-11 w-11 overflow-hidden rounded-[14px] border-2 border-white bg-slate-100 shadow-[0_10px_20px_-14px_rgba(15,23,42,0.35)]">
                        <Image
                          src={initialInput.image.url}
                          alt={initialInput.image.alt ?? "Imagen del producto"}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <span className="text-[11px] font-medium text-[rgba(226,232,240,0.76)]">1 imagen lista</span>
                    </div>
                  ) : null}
                  <span className="text-[11px] text-[rgba(226,232,240,0.76)]">
                    Escribe como si le hablaras al asistente.
                  </span>
                </div>
                <textarea
                  value={draftPrompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                  rows={2}
                  className="min-h-[54px] w-full resize-none border-0 bg-transparent px-1 py-0.5 text-[15px] leading-6 text-white outline-none placeholder:text-[rgba(226,232,240,0.5)] focus:ring-0"
                  placeholder="Describe tu producto, el precio, la oferta, para quien es y que quieres lograr con el anuncio."
                />
              </div>
            </label>

            <div className="mt-1 flex flex-col gap-2.5 border-t border-[rgba(255,255,255,0.08)] px-3 pt-2.5 pb-0.5 md:flex-row md:items-center md:justify-between md:px-4">
              <div className="min-w-[210px]">
                <Select
                  value={String(variantCount)}
                  onValueChange={(value) => setVariantCount(Number(value) as 3 | 5 | 10)}
                >
                  <SelectTrigger className="h-11 w-full rounded-full border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] pl-4 pr-3 text-sm font-semibold text-white shadow-none transition hover:bg-[rgba(255,255,255,0.08)] data-[state=open]:bg-[rgba(255,255,255,0.1)] data-[state=open]:border-[rgba(255,255,255,0.16)]">
                    <SelectValue placeholder="Cantidad de imagenes" />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    className="min-w-[210px] rounded-3xl border-[rgba(15,23,42,0.08)] bg-white/95 p-2 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.3)] backdrop-blur"
                  >
                    <SelectItem value="3">3 imagenes</SelectItem>
                    <SelectItem value="5">5 imagenes</SelectItem>
                    <SelectItem value="10">10 imagenes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-end gap-3">
                <p className="hidden text-[11px] text-[rgba(226,232,240,0.72)] md:block">
                  Luego completas el detalle fino en el formulario.
                </p>
                <Button
                  type="button"
                  disabled={pending}
                  className="h-11 rounded-full px-6 shadow-[0_18px_36px_-22px_color-mix(in_srgb,var(--primary)_45%,black)]"
                  onClick={handleGenerateCreatives}
                >
                  {pending ? "Generando..." : "Continuar"}
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
