"use client";

import { startTransition, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Bot,
  ChevronLeft,
  Globe,
  LoaderCircle,
  Search,
  Sparkles,
  Store,
  Target,
  X,
} from "lucide-react";
import {
  analyzeMarketingBusinessLinksAction,
  improveMarketingBusinessDescriptionAction,
  updateMarketingBusinessContextAction,
} from "@/app/actions/marketing-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MarketingBusinessContext } from "@/lib/marketing-business-context";

type MarketingBusinessIntakeModalProps = {
  context: MarketingBusinessContext;
};

type Stage = "basics" | "customer" | "scanning" | "summary";

type ScanResult = Awaited<ReturnType<typeof analyzeMarketingBusinessLinksAction>>;

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function StageDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={`h-2 rounded-full transition-all ${
        active
          ? "w-10 bg-[var(--primary)] shadow-[0_10px_18px_-12px_color-mix(in_srgb,var(--primary)_70%,black)]"
          : done
            ? "w-4 bg-[color-mix(in_srgb,var(--primary)_40%,white)]"
            : "w-4 bg-slate-200"
      }`}
    />
  );
}

function improveWhatSells(value: string, businessName: string) {
  const trimmed = value.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");

  if (!trimmed) {
    return "";
  }

  if (
    /que buscan una imagen mas profesional|que buscan una opcion profesional|transmitir una imagen mas profesional/i.test(
      trimmed,
    )
  ) {
    return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  }

  const base = trimmed
    .replace(/^vendemos\s+/i, "")
    .replace(/^ofrecemos\s+/i, "")
    .replace(/^somos\s+/i, "");

  const normalizedBusinessName = businessName.trim().toLowerCase();
  const baseWithoutBusinessName = normalizedBusinessName
    ? base.replace(new RegExp(`^${normalizedBusinessName}\\s+ofrece\\s+`, "i"), "")
    : base;

  const normalizedBase = baseWithoutBusinessName
    .toLowerCase()
    .replace(/\bpeluqueria\b/g, "peluqueria")
    .replace(/\bbarberia\b/g, "barberia")
    .replace(/\bsalon de belleza\b/g, "salon de belleza")
    .replace(/\bspa\b/g, "spa")
    .replace(/\s+/g, " ")
    .trim();
  const businessPrefix = businessName.trim() ? `${businessName.trim()} ofrece` : "Ofrecemos";

  if (/barber|peluquer|salon|spa|belleza/i.test(normalizedBase)) {
    let audience = "negocios de belleza";

    if (/peluquer/.test(normalizedBase) && /barber/.test(normalizedBase) && /spa/.test(normalizedBase)) {
      audience = "peluquerias, barberias, salones de belleza y spa";
    } else if (/peluquer/.test(normalizedBase) || /salon/.test(normalizedBase)) {
      audience = "peluquerias y salones de belleza";
    } else if (/barber/.test(normalizedBase)) {
      audience = "barberias";
    } else if (/spa/.test(normalizedBase)) {
      audience = "spa y centros de bienestar";
    }

    const cleanedBase = normalizedBase
      .replace(/\bpara\s+peluquerias?\b/g, "")
      .replace(/\bpara\s+barberias?\b/g, "")
      .replace(/\bpara\s+salones? de belleza\b/g, "")
      .replace(/\bpara\s+spa\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return `${businessPrefix} ${applyBasicWritingCleanup(cleanedBase)} para ${audience} que buscan una imagen más profesional, cómoda y atractiva para sus clientes.`;
  }

  if (/mobiliario|mueble|equipo|equipamiento/i.test(normalizedBase)) {
    return `${businessPrefix} ${applyBasicWritingCleanup(normalizedBase)} para negocios que quieren mejorar su espacio, atender mejor y transmitir una imagen más profesional.`;
  }

  if (/ropa|moda|calzado|accesorio/i.test(normalizedBase)) {
    return `${businessPrefix} ${applyBasicWritingCleanup(normalizedBase)} para clientes que buscan verse bien, comprar con confianza y encontrar una opción alineada con su estilo.`;
  }

  return `${businessPrefix} ${applyBasicWritingCleanup(normalizedBase)} para clientes que buscan una opción profesional, confiable y fácil de elegir.`;
}

function applyBasicWritingCleanup(value: string) {
  return value
    .replace(/\bpeluqueria\b/g, "peluquería")
    .replace(/\bpeluquerias\b/g, "peluquerías")
    .replace(/\bbarberia\b/g, "barbería")
    .replace(/\bbarberias\b/g, "barberías")
    .replace(/\bsalon\b/g, "salón")
    .replace(/\bsalones\b/g, "salones")
    .replace(/\bopcion\b/g, "opción")
    .replace(/\bcomod[ao]s?\b/g, (match) =>
      match.toLowerCase() === "comoda" ? "cómoda" : match.toLowerCase() === "comodo" ? "cómodo" : match,
    )
    .replace(/\bfacil\b/g, "fácil")
    .replace(/\bmas\b/g, "más")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function MarketingBusinessIntakeModal({ context }: MarketingBusinessIntakeModalProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("basics");
  const [error, setError] = useState("");
  const [businessName, setBusinessName] = useState(context.businessName ?? "");
  const [whatSells, setWhatSells] = useState(context.businessDescription ?? context.mainOffer ?? "");
  const [idealCustomer, setIdealCustomer] = useState(
    context.idealCustomer ?? (context.targetAudiences.length > 0 ? context.targetAudiences.join(", ") : ""),
  );
  const [painPoints, setPainPoints] = useState(context.painPoints ?? "");
  const [primaryCallToAction, setPrimaryCallToAction] = useState(context.primaryCallToAction ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(context.websiteUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(context.instagramUrl ?? "");
  const [facebookUrl, setFacebookUrl] = useState(context.facebookUrl ?? "");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isImprovingWhatSells, setIsImprovingWhatSells] = useState(false);
  const [isImprovingIdealCustomer, setIsImprovingIdealCustomer] = useState(false);
  const [isImprovingPainPoints, setIsImprovingPainPoints] = useState(false);
  const canPortal = typeof document !== "undefined";

  const stageIndex =
    stage === "basics" ? 0 : stage === "customer" ? 1 : stage === "scanning" ? 2 : 3;

  useEffect(() => {
    if (!open || !canPortal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [canPortal, open]);

  const closeModal = () => {
    setOpen(false);
    setStage("basics");
    setError("");
  };

  const handleContinueBasics = () => {
    if (businessName.trim().length < 2) {
      setError("Escribe el nombre del negocio.");
      return;
    }

    if (whatSells.trim().length < 6) {
      setError("Cuéntanos un poco mejor qué vendes.");
      return;
    }

    setError("");
    setStage("customer");
  };

  const handleAnalyze = () => {
    if (idealCustomer.trim().length < 8) {
      setError("Cuéntanos a qué tipo de cliente le vendes.");
      return;
    }

    if (painPoints.trim().length < 8) {
      setError("Cuéntanos qué problema le ayudas a resolver.");
      return;
    }

    if (primaryCallToAction.trim().length < 3) {
      setError("Cuéntanos qué quieres que haga la persona interesada.");
      return;
    }

    setError("");
    setStage("scanning");

    startTransition(async () => {
      const result = await analyzeMarketingBusinessLinksAction({
        businessName,
        whatSells,
        websiteUrl: normalizeUrl(websiteUrl),
        instagramUrl: normalizeUrl(instagramUrl),
        facebookUrl: normalizeUrl(facebookUrl),
        existingIdealCustomer: idealCustomer,
        existingPainPoints: painPoints,
        existingPrimaryCallToAction: primaryCallToAction,
        existingAudiences: context.targetAudiences,
      });

      if (!result.ok) {
        setError(result.error || "No pudimos revisar la informacion del negocio.");
        setStage("customer");
        return;
      }

      setScanResult(result);
      setStage("summary");
    });
  };

  const handleImproveWhatSells = () => {
    setError("");
    setIsImprovingWhatSells(true);

    startTransition(async () => {
      const result = await improveMarketingBusinessDescriptionAction({
        field: "whatSells",
        businessName,
        value: whatSells,
      });

      setIsImprovingWhatSells(false);

      if (!result.ok) {
        const fallback = improveWhatSells(whatSells, businessName);
        if (fallback && fallback !== whatSells) {
          setWhatSells(fallback);
        }

        setError(result.error || "No pudimos mejorar el texto en este momento.");
        return;
      }

      setWhatSells(result.value);
    });
  };

  const handleImproveIdealCustomer = () => {
    setError("");
    setIsImprovingIdealCustomer(true);

    startTransition(async () => {
      const result = await improveMarketingBusinessDescriptionAction({
        field: "idealCustomer",
        businessName,
        value: idealCustomer,
        whatSells,
      });

      setIsImprovingIdealCustomer(false);

      if (!result.ok) {
        setError(result.error || "No pudimos mejorar el texto en este momento.");
        return;
      }

      setIdealCustomer(result.value);
    });
  };

  const handleImprovePainPoints = () => {
    setError("");
    setIsImprovingPainPoints(true);

    startTransition(async () => {
      const result = await improveMarketingBusinessDescriptionAction({
        field: "painPoints",
        businessName,
        value: painPoints,
        whatSells,
        idealCustomer,
      });

      setIsImprovingPainPoints(false);

      if (!result.ok) {
        setError(result.error || "No pudimos mejorar el texto en este momento.");
        return;
      }

      setPainPoints(result.value);
    });
  };

  return (
    <>
      <Button type="button" size="lg" className="rounded-2xl" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        Completar contexto
      </Button>

      {canPortal && open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Completar contexto del negocio"
            >
              <div className="flex h-full w-full max-w-[1040px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]">
                <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
                  <div className="relative flex items-start justify-center gap-4">
                    <div className="space-y-2 text-center">
                      <div className="flex flex-wrap justify-center gap-2">
                        {[0, 1, 2, 3].map((item) => (
                          <StageDot key={item} active={item === stageIndex} done={item < stageIndex} />
                        ))}
                      </div>
                      <div className="space-y-2">
                        <h2 className="text-[1.8rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2rem]">
                          {stage === "basics" && "Cuéntale a la IA sobre tu negocio"}
                          {stage === "customer" && "Ahora cuéntanos del cliente"}
                          {stage === "scanning" && "Buscando tu negocio"}
                          {stage === "summary" && "Esto entendió la IA"}
                        </h2>
                        <p className="text-sm leading-6 text-slate-600">
                          {stage === "basics" &&
                            "Solo responde lo básico. La IA organizará internamente la información para marketing."}
                          {stage === "customer" &&
                            "Estas respuestas ayudan al agente a entender a quién venderle y cómo comunicar."}
                          {stage === "scanning" &&
                            "Estamos revisando tu negocio y tus links para armar una base comercial inicial."}
                          {stage === "summary" &&
                            "Revisa este resumen. Con esto el agente ya puede empezar a pensar mejor el marketing."}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={closeModal}
                      className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50"
                      aria-label="Cerrar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <form
                  action={updateMarketingBusinessContextAction}
                  className="flex min-h-0 flex-1 flex-col"
                  onKeyDownCapture={(event) => {
                    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="businessName" value={businessName} />
                  <input type="hidden" name="mainOffer" value={whatSells} />
                  <input type="hidden" name="idealCustomer" value={idealCustomer} />
                  <input type="hidden" name="painPoints" value={painPoints} />
                  <input type="hidden" name="primaryCallToAction" value={primaryCallToAction} />
                  <input
                    type="hidden"
                    name="valueProposition"
                    value={scanResult?.generated.valueProposition || `${businessName} ofrece ${whatSells}`.trim()}
                  />
                  <input type="hidden" name="websiteUrl" value={normalizeUrl(websiteUrl)} />
                  <input type="hidden" name="instagramUrl" value={normalizeUrl(instagramUrl)} />
                  <input type="hidden" name="facebookUrl" value={normalizeUrl(facebookUrl)} />
                  <input type="hidden" name="tiktokUrl" value={context.tiktokUrl ?? ""} />

                  <div
                    className={
                      stage === "scanning"
                        ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                        : "flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4"
                    }
                  >
                    {stage === "basics" ? (
                      <div className="mx-auto w-full max-w-[760px]">
                        <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] md:p-6">
                          <div className="grid gap-5 md:grid-cols-2">
                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-slate-950">¿Cómo se llama tu negocio?</span>
                              <Input
                                value={businessName}
                                onChange={(event) => setBusinessName(event.target.value)}
                                placeholder="Ej. Magilus"
                                className="h-14 rounded-[22px] bg-white px-5"
                              />
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-slate-950">
                                ¿Qué vendes o qué servicio ofreces?
                              </span>
                              <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white px-5 py-3 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.14)]">
                                <textarea
                                  value={whatSells}
                                  onChange={(event) => setWhatSells(event.target.value)}
                                  rows={4}
                                  className="flex min-h-[72px] w-full resize-none bg-white py-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
                                  placeholder="Ej. Vendemos mobiliario premium para barberías y salones."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-slate-500">
                                  Puedes escribirlo simple. La IA te ayuda a dejarlo mas claro.
                                </p>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="rounded-full"
                                  disabled={isImprovingWhatSells}
                                  onClick={handleImproveWhatSells}
                                >
                                  {isImprovingWhatSells ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  {isImprovingWhatSells ? "Mejorando..." : "Mejorar respuesta"}
                                </Button>
                              </div>
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {stage === "customer" ? (
                      <div className="mx-auto w-full max-w-[760px] space-y-4">
                        <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] md:p-6">
                          <div className="grid gap-5 md:grid-cols-2">
                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-slate-950">
                                ¿A qué tipo de cliente le vendes?
                              </span>
                              <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white px-5 py-3 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.14)]">
                                <textarea
                                  value={idealCustomer}
                                  onChange={(event) => setIdealCustomer(event.target.value)}
                                  rows={3}
                                  className="flex min-h-[64px] w-full resize-none bg-white py-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
                                  placeholder="Ej. Dueños de barberías, salones y negocios que quieren verse más profesionales."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-slate-500">
                                  La IA usa lo que vendes para dejar este perfil de cliente más claro.
                                </p>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="rounded-full"
                                  disabled={isImprovingIdealCustomer}
                                  onClick={handleImproveIdealCustomer}
                                >
                                  {isImprovingIdealCustomer ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  {isImprovingIdealCustomer ? "Mejorando..." : "Mejorar respuesta"}
                                </Button>
                              </div>
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-slate-950">
                                ¿Qué problema le ayudas a resolver?
                              </span>
                              <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white px-5 py-3 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.14)]">
                                <textarea
                                  value={painPoints}
                                  onChange={(event) => setPainPoints(event.target.value)}
                                  rows={3}
                                  className="flex min-h-[64px] w-full resize-none bg-white py-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
                                  placeholder="Ej. Les ayudamos a montar un espacio funcional, atractivo y listo para vender mejor."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-slate-500">
                                  La IA usa lo que vendes y tu cliente ideal para mejorar este problema principal.
                                </p>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="rounded-full"
                                  disabled={isImprovingPainPoints}
                                  onClick={handleImprovePainPoints}
                                >
                                  {isImprovingPainPoints ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  {isImprovingPainPoints ? "Mejorando..." : "Mejorar respuesta"}
                                </Button>
                              </div>
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-slate-950">
                                ¿Qué quieres que haga la persona interesada?
                              </span>
                              <Input
                                value={primaryCallToAction}
                                onChange={(event) => setPrimaryCallToAction(event.target.value)}
                                placeholder="Ej. Escribirme por WhatsApp"
                                className="h-14 rounded-[22px] bg-white px-5"
                              />
                            </label>

                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-slate-950">Página web (opcional)</span>
                              <Input
                                value={websiteUrl}
                                onChange={(event) => setWebsiteUrl(event.target.value)}
                                placeholder="tusitio.com"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-[22px] bg-white px-5"
                              />
                            </label>

                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-slate-950">Instagram (opcional)</span>
                              <Input
                                value={instagramUrl}
                                onChange={(event) => setInstagramUrl(event.target.value)}
                                placeholder="instagram.com/tumarca"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-[22px] bg-white px-5"
                              />
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-slate-950">Facebook (opcional)</span>
                              <Input
                                value={facebookUrl}
                                onChange={(event) => setFacebookUrl(event.target.value)}
                                placeholder="facebook.com/tumarca"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-[22px] bg-white px-5"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {stage === "scanning" ? (
                      <div className="mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center">
                        <div className="relative flex h-28 w-28 items-center justify-center">
                          <div className="absolute inset-0 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]" />
                          <div className="absolute inset-[10px] rounded-full border border-[color-mix(in_srgb,var(--primary)_20%,white)]" />
                          <LoaderCircle className="absolute h-24 w-24 animate-spin text-[color-mix(in_srgb,var(--primary)_42%,white)]" />
                          <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_14%,white)] text-[var(--primary)] shadow-[0_18px_40px_-24px_color-mix(in_srgb,var(--primary)_45%,black)]">
                            <Search className="h-8 w-8" />
                          </div>
                        </div>

                        <div className="mt-7 space-y-3">
                          <h3 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950">
                            Buscando tu negocio
                          </h3>
                          <p className="text-base leading-7 text-slate-600">
                            Estamos revisando lo que escribiste y los links públicos para armar una base comercial útil.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {stage === "summary" && scanResult?.ok ? (
                      <div className="mx-auto w-full max-w-[860px] space-y-5">
                        <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-6 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)]">
                          <div className="flex items-start gap-4">
                            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                              <Bot className="h-5 w-5" />
                            </span>
                            <div className="space-y-3">
                              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Resumen del negocio
                              </p>
                              <p className="text-[1.05rem] leading-7 text-slate-800">{scanResult.summary}</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)]">
                            <div className="mb-4 flex items-center gap-2">
                              <Store className="h-4.5 w-4.5 text-[var(--primary)]" />
                              <p className="text-sm font-semibold text-slate-950">Lo que entendió la IA</p>
                            </div>
                            <div className="space-y-3">
                              {scanResult.found.map((item) => (
                                <div
                                  key={item}
                                  className="rounded-[18px] border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700"
                                >
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)]">
                            <div className="mb-4 flex items-center gap-2">
                              <Target className="h-4.5 w-4.5 text-[var(--primary)]" />
                              <p className="text-sm font-semibold text-slate-950">Base interna para marketing</p>
                            </div>
                            <div className="space-y-3">
                              <SummaryBlock title="Cliente" value={idealCustomer} />
                              <SummaryBlock title="Problema que resuelve" value={painPoints} />
                              <SummaryBlock title="CTA principal" value={primaryCallToAction} />
                              <SummaryBlock
                                title="Propuesta que generará la IA"
                                value={scanResult.generated.valueProposition}
                              />
                            </div>

                            {scanResult.sources.length > 0 ? (
                              <div className="mt-4 rounded-[18px] border border-[var(--line)] bg-slate-50 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Fuentes revisadas
                                </p>
                                <div className="mt-2 space-y-1.5 text-sm text-slate-600">
                                  {scanResult.sources.map((source) => (
                                    <p key={source} className="break-all">
                                      {source}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {error ? (
                    <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-600 md:px-8">
                      {error}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.9)] px-5 py-4 backdrop-blur md:px-8">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => {
                        if (stage === "customer") {
                          setStage("basics");
                          return;
                        }

                        if (stage === "summary") {
                          setStage("customer");
                          return;
                        }

                        closeModal();
                      }}
                      disabled={stage === "scanning"}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {stage === "basics" ? "Cerrar" : "Volver"}
                    </Button>

                    {stage === "basics" ? (
                      <Button type="button" className="rounded-2xl" onClick={handleContinueBasics}>
                        Continuar
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    ) : null}

                    {stage === "customer" ? (
                      <Button type="button" className="rounded-2xl" onClick={handleAnalyze}>
                        Analizar negocio
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    ) : null}

                    {stage === "summary" ? (
                      <Button type="submit" className="rounded-2xl">
                        <Globe className="h-4 w-4" />
                        Guardar contexto
                      </Button>
                    ) : null}
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function SummaryBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}





