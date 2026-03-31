"use client";

import Image from "next/image";
import { AlertCircle, ArrowDownToLine, Copy, ImagePlus, LoaderCircle, MoreHorizontal, Plus, SendHorizonal, Trash2, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MarketingBusinessContext } from "@/lib/marketing-business-context";
import type { AdProductInput } from "../types/ad-input";
import type { AdsGeneratorResult } from "../types/ad-output";
import { AdsGeneratorForm } from "./AdsGeneratorForm";
import { AdsGeneratorResult as AdsGeneratorResultView } from "./AdsGeneratorResult";
import type { AdCreative } from "@/lib/ad-creatives";

type AdsGeneratorWorkspaceProps = {
  initialInput?: Partial<AdProductInput>;
  sourceHint?: string | null;
  businessContext?: MarketingBusinessContext | null;
  historyEntryId?: string | null;
  draftStorageKeySuffix?: string | null;
};

type PublishedAdCard = {
  id: string;
  imageUrl: string;
  result: AdsGeneratorResult;
};

type UploadedImageDraft = {
  id: string;
  url: string;
  name: string;
  file?: File;
};

const ADS_GENERATOR_DRAFT_KEY = "marketing-ia:ads-generator-workspace:v1";

function buildHistoryAssets(input: {
  generatedCreatives: AdCreative[];
  sourceImageUrl: string;
  fallbackImageUrl?: string | null;
}) {
  const creativeImageUrls = Array.from(
    new Set(
      input.generatedCreatives
        .map((creative) => creative.imageUrl.trim())
        .filter(Boolean),
    ),
  );

  const sourceImageUrl = input.sourceImageUrl.trim() || input.fallbackImageUrl?.trim() || "";

  return {
    creativeImageUrls,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  };
}

function applyPrimaryVariant(result: AdsGeneratorResult, variantIndex: number): AdsGeneratorResult {
  const variants = result.meta.copyVariants;
  if (!variants.length) {
    return result;
  }

  const normalizedIndex = variantIndex % variants.length;
  const primaryVariant = variants[normalizedIndex] ?? variants[0];
  const reorderedVariants = [
    primaryVariant,
    ...variants.filter((_, index) => index !== normalizedIndex),
  ];

  const readyToCopyText = [
    "Anuncio principal",
    `Texto principal:\n${primaryVariant.primaryText}`,
    `Titulo: ${primaryVariant.headline}`,
    `Descripcion: ${primaryVariant.description}`,
    `CTA: ${result.meta.callToAction}`,
    "",
    "Variantes de copy",
    ...reorderedVariants.slice(0, 3).map(
      (variant, index) =>
        [
          `Variante ${index + 1}`,
          `Texto principal:\n${variant.primaryText}`,
          `Titulo: ${variant.headline}`,
          `Descripcion: ${variant.description}`,
          `CTA: ${result.meta.callToAction}`,
        ].join("\n"),
    ),
  ].join("\n\n");

  return {
    ...result,
    meta: {
      ...result.meta,
      primaryText: primaryVariant.primaryText,
      headline: primaryVariant.headline,
      description: primaryVariant.description,
      copyVariants: reorderedVariants,
      readyToCopyText,
    },
  };
}

export function AdsGeneratorWorkspace({
  initialInput,
  sourceHint,
  businessContext,
  historyEntryId,
  draftStorageKeySuffix,
}: AdsGeneratorWorkspaceProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [variantCount, setVariantCount] = useState<3 | 5 | 10>(3);
  const [result, setResult] = useState<AdsGeneratorResult | null>(null);
  const [lastInput, setLastInput] = useState<AdProductInput | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImageDraft[]>([]);
  const [generatedCreatives, setGeneratedCreatives] = useState<AdCreative[]>([]);
  const [publishedAds, setPublishedAds] = useState<PublishedAdCard[]>([]);
  const [detailAd, setDetailAd] = useState<PublishedAdCard | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canPortal = typeof document !== "undefined";
  const draftStorageKey = `${ADS_GENERATOR_DRAFT_KEY}:${(draftStorageKeySuffix ?? historyEntryId ?? initialInput?.productName ?? "default").trim() || "default"}`;

  useEffect(() => {
    return () => {
      uploadedImages.forEach((image) => {
        if (image.url.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });
    };
  }, [uploadedImages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) {
        setDraftPrompt(initialInput?.productDescription ?? "");
        setSourceImageUrl(initialInput?.image?.url ?? "");
        return;
      }

      const parsed = JSON.parse(raw) as {
        draftPrompt?: string;
        variantCount?: 3 | 5 | 10;
        uploadedImages?: Array<{ id: string; url: string; name: string }>;
        generatedCreatives?: AdCreative[];
        publishedAds?: PublishedAdCard[];
        sourceImageUrl?: string;
      };

      setDraftPrompt(parsed.draftPrompt ?? initialInput?.productDescription ?? "");
      setVariantCount(parsed.variantCount && [3, 5, 10].includes(parsed.variantCount) ? parsed.variantCount : 3);
      setUploadedImages(
        Array.isArray(parsed.uploadedImages)
          ? parsed.uploadedImages.map((image) => ({
              id: image.id,
              url: image.url,
              name: image.name,
            }))
          : [],
      );
      setGeneratedCreatives(Array.isArray(parsed.generatedCreatives) ? parsed.generatedCreatives : []);
      setPublishedAds(Array.isArray(parsed.publishedAds) ? parsed.publishedAds : []);
      setSourceImageUrl(parsed.sourceImageUrl ?? initialInput?.image?.url ?? "");
    } catch {
      setDraftPrompt(initialInput?.productDescription ?? "");
      setSourceImageUrl(initialInput?.image?.url ?? "");
    }
  }, [draftStorageKey, initialInput]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        draftPrompt,
        variantCount,
        uploadedImages: uploadedImages.map(({ id, url, name }) => ({ id, url, name })),
        generatedCreatives,
        publishedAds,
        sourceImageUrl,
      }),
    );
  }, [draftPrompt, draftStorageKey, generatedCreatives, publishedAds, sourceImageUrl, uploadedImages, variantCount]);

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

  useEffect(() => {
    if (!detailAd || !canPortal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [canPortal, detailAd]);

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

    setSourceImageUrl("");
    void Promise.all(
      files.map(
        (file) =>
          new Promise<UploadedImageDraft>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `${file.name}-${file.lastModified}`,
                url: String(reader.result ?? ""),
                name: file.name,
                file,
              });
            reader.onerror = () => reject(new Error("No pudimos leer una de las imagenes."));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((nextImages) => {
        setUploadedImages((current) => {
          const availableSlots = Math.max(0, 10 - current.length);
          return [...current, ...nextImages.slice(0, availableSlots)];
        });
      })
      .catch(() => {
        setError("No pudimos cargar una de las imagenes.");
      });

    event.target.value = "";
  };

  const inferredProductName =
    initialInput?.productName?.trim() ||
    draftPrompt
      .trim()
      .split(/[.,:;!?]/)[0]
      ?.trim()
      .split(" ")
      .slice(0, 6)
      .join(" ") ||
    "Producto del anuncio";

  const handleGenerateCreatives = async () => {
    const missingCreatives = Math.max(variantCount - generatedCreatives.length, 0);

    if (missingCreatives === 0) {
      setError("Elimina creativos para generar mas.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const formData = new FormData();
      const primaryFile = uploadedImages[0]?.file;
      const primaryImageUrl = sourceImageUrl || initialInput?.image?.url || "";
      const prompt = draftPrompt.trim();

      if (primaryFile && !sourceImageUrl) {
        formData.append("image", primaryFile);
      }

      if (primaryImageUrl) {
        formData.append("sourceImageUrl", primaryImageUrl);
      }

      formData.append("prompt", prompt);
      formData.append("productName", initialInput?.productName?.trim() || "");
      formData.append("creativeMode", "real");
      formData.append("creativeCount", String(missingCreatives));

      const response = await fetch("/api/marketing-ia/ads-generator/creatives", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { creatives?: AdCreative[]; sourceImageUrl?: string; error?: string }
        | undefined;

      if (!response.ok || !payload?.creatives?.length) {
        throw new Error(payload?.error || "No pudimos generar los creativos en este momento.");
      }

      setGeneratedCreatives((current) => [...current, ...payload.creatives!]);
      if (payload.sourceImageUrl) {
        setSourceImageUrl(payload.sourceImageUrl);
      }
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

  const handlePublishAds = async () => {
    if (generatedCreatives.length === 0) {
      setError("Primero genera al menos un creativo.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const responses = await Promise.all(
        generatedCreatives.map(async (creative, index) => {
          const input: AdProductInput = {
            productName: inferredProductName,
            productDescription:
              [
                draftPrompt.trim(),
                businessContext?.valueProposition?.trim(),
                businessContext?.mainOffer?.trim(),
              ]
                .filter(Boolean)
                .join(". ") || inferredProductName,
            brandName: businessContext?.businessName || initialInput?.brandName,
            categoryName: businessContext?.businessType || initialInput?.categoryName,
            landingPageUrl: businessContext?.websiteUrl || initialInput?.landingPageUrl,
            objective: "sales",
            audienceSummary:
              businessContext?.idealCustomer ||
              (businessContext?.targetAudiences.length
                ? businessContext.targetAudiences.join(", ")
                : initialInput?.audienceSummary),
            tone:
              businessContext?.salesTone?.toLowerCase().includes("premium")
                ? "premium"
                : businessContext?.salesTone?.toLowerCase().includes("direct")
                  ? "direct"
                  : businessContext?.salesTone?.toLowerCase().includes("cerc")
                    ? "friendly"
                    : "persuasive",
            keyBenefits: [
              creative.headline,
              creative.supportLine,
              businessContext?.valueProposition ?? "",
              businessContext?.mainOffer ?? "",
            ].filter(Boolean),
            painPoints: [creative.angle, businessContext?.painPoints ?? ""].filter(Boolean),
            callToAction: businessContext?.primaryCallToAction || creative.cta,
            image: {
              url: creative.imageUrl,
              alt: creative.headline || `Creativo ${index + 1}`,
              source: "creativos",
              isPrimary: true,
            },
          };

          const response = await fetch("/api/marketing-ia/ads-generator", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              historyEntryId && index === 0
                ? {
                    entryId: historyEntryId,
                    input,
                    assets: buildHistoryAssets({
                      generatedCreatives,
                      sourceImageUrl,
                      fallbackImageUrl: initialInput?.image?.url,
                    }),
                  }
                : {
                    input,
                    assets: buildHistoryAssets({
                      generatedCreatives,
                      sourceImageUrl,
                      fallbackImageUrl: initialInput?.image?.url,
                    }),
                  },
            ),
          });

          const payload = (await response.json()) as
            | { entry?: { id: string; input: AdProductInput; result: AdsGeneratorResult }; error?: string }
            | undefined;

          if (!response.ok || !payload?.entry) {
            throw new Error(payload?.error || "No pudimos publicar los anuncios.");
          }

          const resultWithVariant = applyPrimaryVariant(payload.entry.result, index);

          return {
            id: `${creative.id}-published`,
            imageUrl: creative.imageUrl,
            result: resultWithVariant,
          } satisfies PublishedAdCard;
        }),
      );

      setPublishedAds(responses);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "No pudimos publicar los anuncios.");
    } finally {
      setPending(false);
    }
  };

  const handleRemoveCreative = async (creativeId: string) => {
    const creativeToRemove = generatedCreatives.find((creative) => creative.id === creativeId);
    if (!creativeToRemove) {
      return;
    }

    try {
      const response = await fetch("/api/marketing-ia/ads-generator/creatives", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl: creativeToRemove.imageUrl }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos eliminar el creativo.");
      }

      setGeneratedCreatives((current) => current.filter((creative) => creative.id !== creativeId));
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error ? nextError.message : "No pudimos eliminar el creativo.",
      );
    }
  };

  const handleRemoveUploadedImage = (imageId: string) => {
    setUploadedImages((current) => {
      const isPrimaryImage = current[0]?.id === imageId;
      const next = current.filter((image) => image.id !== imageId);
      const removed = current.find((image) => image.id === imageId);

      if (removed) {
        URL.revokeObjectURL(removed.url);
      }

      if (isPrimaryImage) {
        setSourceImageUrl("");
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
        body: JSON.stringify(
          historyEntryId
            ? {
                entryId: historyEntryId,
                input,
                assets: buildHistoryAssets({
                  generatedCreatives,
                  sourceImageUrl,
                  fallbackImageUrl: initialInput?.image?.url,
                }),
              }
            : {
                input,
                assets: buildHistoryAssets({
                  generatedCreatives,
                  sourceImageUrl,
                  fallbackImageUrl: initialInput?.image?.url,
                }),
              },
        ),
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

      {publishedAds.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[1.4rem] font-semibold tracking-[-0.04em] text-slate-950">
                Anuncios Listos
              </h2>
              <p className="text-sm text-slate-600">
                {publishedAds.length} anuncio{publishedAds.length === 1 ? "" : "s"} generado{publishedAds.length === 1 ? "" : "s"} para Meta Ads.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              onClick={() => setPublishedAds([])}
            >
              Volver
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {publishedAds.map((ad, index) => (
              <article
                key={ad.id}
                className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white shadow-[0_18px_38px_-30px_rgba(15,23,42,0.16)]"
              >
                <div className="relative aspect-square bg-slate-100">
                  <Image
                    src={ad.imageUrl}
                    alt={`Anuncio ${index + 1}`}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">Anuncio {index + 1}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                        onClick={() => void navigator.clipboard.writeText(ad.result.meta.readyToCopyText)}
                        aria-label="Copiar anuncio"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                            aria-label="Mas opciones"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40 rounded-2xl">
                          <DropdownMenuItem onSelect={() => setDetailAd(ad)}>
                            Por que este anuncio
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <InfoBlock title="Copy" value={ad.result.meta.primaryText} compact />
                    <InfoBlock title="Titulo" value={ad.result.meta.headline} compact />
                    <InfoBlock title="Descripcion" value={ad.result.meta.description} compact />
                    <InfoBlock title="CTA" value={ad.result.meta.callToAction} compact />
                    {ad.result.meta.copyVariants.slice(0, 3).map((variant, variantIndex) => (
                      <InfoBlock
                        key={`${ad.id}-variant-${variant.id}`}
                        title={`Variante ${variantIndex + 1}`}
                        value={variant.primaryText}
                        compact
                      />
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
      <div className="space-y-0">
        {result ? (
          <AdsGeneratorResultView pending={pending} result={result} />
        ) : (
          <div className="mx-auto flex min-h-[50vh] w-full max-w-6xl flex-col justify-center">
            <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#14213d_0%,#1d2d5a_100%)] p-3.5 text-white shadow-[0_28px_72px_-48px_rgba(15,23,42,0.26),inset_0_1px_0_rgba(255,255,255,0.05)] md:p-4">
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
                      disabled={pending}
                      className="h-10 rounded-full px-4 text-white shadow-[0_18px_36px_-22px_color-mix(in_srgb,var(--primary)_45%,black)]"
                      onClick={handlePublishAds}
                    >
                      <SendHorizonal className="h-4 w-4" />
                      {pending ? "Publicando..." : "Publicar"}
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                      {Array.from({ length: variantCount }).map((_, index) => {
                        const creative = generatedCreatives[index];

                        if (creative) {
                          return (
                            <div
                              key={creative.id}
                              className="group relative aspect-[0.92] w-[280px] max-w-full overflow-hidden rounded-[22px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] shadow-[0_22px_40px_-28px_rgba(8,15,35,0.55)]"
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
                                    onClick={() => void handleRemoveCreative(creative.id)}
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
                            className="group relative aspect-[0.92] w-[280px] max-w-full rounded-[22px] border border-dashed border-[rgba(143,180,255,0.22)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]"
                          >
                            {pending ? (
                              <div className="relative flex h-full animate-pulse flex-col items-center justify-center gap-3 overflow-hidden text-center">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_65%)]" />
                                <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.08)] text-[#8fb4ff]">
                                  <LoaderCircle className="h-5 w-5 animate-spin" />
                                </span>
                                <span className="relative px-4 text-xs font-medium text-[rgba(226,232,240,0.8)]">
                                  Creativo {index + 1}
                                </span>
                              </div>
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.08)] text-[#8fb4ff]">
                                  <Plus className="h-5 w-5" />
                                </span>
                                <span className="px-4 text-xs font-medium text-[rgba(226,232,240,0.8)]">
                                  Creativo {index + 1}
                                </span>
                              </div>
                            )}
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

        <div className="border-t border-[rgba(148,163,184,0.14)] bg-transparent px-4 py-4 md:px-6 md:py-5">
          <div className="rounded-[30px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#14213d_0%,#1d2d5a_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-2.5">
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
                              className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(15,23,42,0.88)] text-white opacity-0 shadow-sm transition group-hover:opacity-100"
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
      )}

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

      {detailAd && canPortal
        ? createPortal(
            <AdsGeneratorDetailModal
              ad={detailAd}
              onClose={() => setDetailAd(null)}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

function InfoBlock({ title, value, compact = false }: { title: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-[18px] border border-[var(--line)] bg-slate-50 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className={`mt-2 whitespace-pre-line text-slate-800 ${compact ? "text-[13px] leading-5" : "text-sm leading-6"}`}>{value}</p>
    </div>
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

function AdsGeneratorDetailModal({
  ad,
  onClose,
}: {
  ad: PublishedAdCard;
  onClose: () => void;
}) {
  const meta = ad.result.meta;
  const strategy = ad.result.strategy;
  const primaryHook = meta.primaryText.split("\n").find(Boolean) ?? strategy.hooks[0] ?? "";
  const primaryBenefit =
    meta.description || meta.headline || "Mejor imagen y mas confianza";
  const variantDifferences = meta.copyVariants.slice(0, 3).map((variant, index) => {
    const angleLabel =
      variant.id === "dolor-problema"
        ? "Entra por el problema real del cliente"
        : variant.id === "resultado-aspiracion"
          ? "Entra por el resultado que la persona quiere ver"
          : "Entra directo, claro y sin rodeos";

    return `Variante ${index + 1}: ${angleLabel}.`;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a99] p-0 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle completo del anuncio"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-[920px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-white md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 md:px-7">
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Por que este anuncio</h3>
            <p className="text-sm text-slate-600">Esto es lo que el sistema entendio y por que llego a este mensaje.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="border-b border-[var(--line)] bg-slate-50 p-5 md:border-b-0 md:border-r md:p-6">
            <div className="relative aspect-square overflow-hidden rounded-[24px] bg-white shadow-[0_16px_32px_-28px_rgba(15,23,42,0.25)]">
              <Image
                src={ad.imageUrl}
                alt="Preview del anuncio"
                fill
                className="object-contain"
                unoptimized
              />
            </div>
          </div>

          <div className="space-y-5 p-5 md:p-6">
            <DetailSection
              title="1. Que entendimos"
              lines={[
                `Lo que estamos vendiendo: ${meta.headline}`,
                `Audiencia interpretada: ${strategy.audience}`,
                `Objetivo principal: ${meta.campaignObjective}`,
              ]}
            />

            <DetailSection
              title="2. Enfoque del anuncio"
              lines={[
                meta.recommendedSalesAngle,
              ]}
            />

            <DetailSection
              title="3. Hook elegido"
              lines={[
                primaryHook,
              ]}
            />

            <DetailSection
              title="4. Beneficio principal"
              lines={[
                primaryBenefit,
              ]}
            />

            <DetailSection
              title="5. CTA elegido"
              lines={[
                meta.callToAction,
              ]}
            />

            <DetailSection
              title="6. Diferencia entre variantes"
              lines={variantDifferences}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="space-y-2 rounded-[22px] border border-[var(--line)] bg-slate-50 px-4 py-4">
      <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
      <div className="space-y-2">
        {lines.filter(Boolean).map((line, index) => (
          <p key={`${title}-${index}`} className="whitespace-pre-line text-sm leading-6 text-slate-700">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
