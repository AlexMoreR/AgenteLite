"use client";

import type { ReactNode } from "react";
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
          ? "w-10 bg-primary shadow-sm"
          : done
            ? "w-4 bg-primary/40"
            : "w-4 bg-muted"
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
              className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 md:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Completar contexto del negocio"
            >
              <div className="flex h-full w-full max-w-[1040px] flex-col overflow-hidden rounded-none border border-border bg-card md:max-h-[92vh] md:rounded-2xl md:shadow-lg">
                <div className="border-b border-border bg-card px-5 py-5 md:px-8 md:py-4">
                  <div className="relative flex items-start justify-center gap-4">
                    <div className="space-y-2 text-center">
                      <div className="flex flex-wrap justify-center gap-2">
                        {[0, 1, 2, 3].map((item) => (
                          <StageDot key={item} active={item === stageIndex} done={item < stageIndex} />
                        ))}
                      </div>
                      <div className="space-y-2">
                        <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                          {stage === "basics" && "Cuéntale a la IA sobre tu negocio"}
                          {stage === "customer" && "Ahora cuéntanos del cliente"}
                          {stage === "scanning" && "Buscando tu negocio"}
                          {stage === "summary" && "Esto entendió la IA"}
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
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
                      className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted"
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
                    value={
                      scanResult?.strategicBase.preliminaryValueProposition ||
                      `${businessName} ofrece ${whatSells}`.trim()
                    }
                  />
                  <input type="hidden" name="websiteUrl" value={normalizeUrl(websiteUrl)} />
                  <input type="hidden" name="instagramUrl" value={normalizeUrl(instagramUrl)} />
                  <input type="hidden" name="facebookUrl" value={normalizeUrl(facebookUrl)} />
                  <input type="hidden" name="tiktokUrl" value={context.tiktokUrl ?? ""} />

                  <div
                    className={
                      stage === "scanning"
                        ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                        : "flex-1 overflow-y-auto bg-muted px-5 py-6 md:px-8 md:py-4"
                    }
                  >
                    {stage === "basics" ? (
                      <div className="mx-auto w-full max-w-[760px]">
                        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
                          <div className="grid gap-5 md:grid-cols-2">
                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-foreground">¿Cómo se llama tu negocio?</span>
                              <Input
                                value={businessName}
                                onChange={(event) => setBusinessName(event.target.value)}
                                placeholder="Ej. Magilus"
                                className="h-14 rounded-2xl bg-background px-5"
                              />
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-foreground">
                                ¿Qué vendes o qué servicio ofreces?
                              </span>
                              <div className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
                                <textarea
                                  value={whatSells}
                                  onChange={(event) => setWhatSells(event.target.value)}
                                  rows={4}
                                  className="flex min-h-[72px] w-full resize-none bg-card py-1 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                                  placeholder="Ej. Vendemos mobiliario premium para barberías y salones."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-muted-foreground">
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
                        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
                          <div className="grid gap-5 md:grid-cols-2">
                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-foreground">
                                ¿A qué tipo de cliente le vendes?
                              </span>
                              <div className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
                                <textarea
                                  value={idealCustomer}
                                  onChange={(event) => setIdealCustomer(event.target.value)}
                                  rows={3}
                                  className="flex min-h-[64px] w-full resize-none bg-card py-1 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                                  placeholder="Ej. Dueños de barberías, salones y negocios que quieren verse más profesionales."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-muted-foreground">
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
                              <span className="text-sm font-semibold text-foreground">
                                ¿Qué problema le ayudas a resolver?
                              </span>
                              <div className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
                                <textarea
                                  value={painPoints}
                                  onChange={(event) => setPainPoints(event.target.value)}
                                  rows={3}
                                  className="flex min-h-[64px] w-full resize-none bg-card py-1 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                                  placeholder="Ej. Les ayudamos a montar un espacio funcional, atractivo y listo para vender mejor."
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-5 text-muted-foreground">
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
                              <span className="text-sm font-semibold text-foreground">
                                ¿Qué quieres que haga la persona interesada?
                              </span>
                              <Input
                                value={primaryCallToAction}
                                onChange={(event) => setPrimaryCallToAction(event.target.value)}
                                placeholder="Ej. Escribirme por WhatsApp"
                                className="h-14 rounded-2xl bg-background px-5"
                              />
                            </label>

                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-foreground">Página web (opcional)</span>
                              <Input
                                value={websiteUrl}
                                onChange={(event) => setWebsiteUrl(event.target.value)}
                                placeholder="tusitio.com"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-2xl bg-background px-5"
                              />
                            </label>

                            <label className="block space-y-2.5">
                              <span className="text-sm font-semibold text-foreground">Instagram (opcional)</span>
                              <Input
                                value={instagramUrl}
                                onChange={(event) => setInstagramUrl(event.target.value)}
                                placeholder="instagram.com/tumarca"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-2xl bg-background px-5"
                              />
                            </label>

                            <label className="block space-y-2.5 md:col-span-2">
                              <span className="text-sm font-semibold text-foreground">Facebook (opcional)</span>
                              <Input
                                value={facebookUrl}
                                onChange={(event) => setFacebookUrl(event.target.value)}
                                placeholder="facebook.com/tumarca"
                                inputMode="url"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="h-14 rounded-2xl bg-background px-5"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {stage === "scanning" ? (
                      <div className="mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center">
                        <div className="relative flex h-28 w-28 items-center justify-center">
                          <div className="absolute inset-0 animate-pulse rounded-full bg-primary/10" />
                          <div className="absolute inset-[10px] rounded-full border border-primary/20" />
                          <LoaderCircle className="absolute h-24 w-24 animate-spin text-primary/40" />
                          <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-lg">
                            <Search className="h-8 w-8" />
                          </div>
                        </div>

                        <div className="mt-7 space-y-3">
                          <h3 className="text-3xl font-semibold tracking-tight text-foreground">
                            Buscando tu negocio
                          </h3>
                          <p className="text-base leading-7 text-muted-foreground">
                            Estamos revisando lo que escribiste y los links públicos para armar una base comercial útil.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {stage === "summary" && scanResult?.ok ? (
                      <div className="mx-auto w-full max-w-[860px] space-y-5">
                        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                          <div className="flex items-start gap-4">
                            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Bot className="h-5 w-5" />
                            </span>
                            <div className="space-y-3">
                              <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                                Resumen del negocio
                              </p>
                              <p className="text-base leading-7 text-foreground">{scanResult.summary}</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <SummarySectionCard title="Información confirmada por el cliente" icon={<Store className="h-4.5 w-4.5 text-primary" />}>
                            <SummaryBlock title="Nombre del negocio" value={scanResult.clientInputs.businessName} />
                            <SummaryBlock title="Oferta" value={scanResult.clientInputs.offer} />
                            <SummaryBlock title="Cliente objetivo" value={scanResult.clientInputs.idealCustomer} />
                            <SummaryBlock title="Problema que resuelve" value={scanResult.clientInputs.painPoints} />
                            <SummaryBlock title="CTA deseado" value={scanResult.clientInputs.primaryCallToAction} />
                            <SummaryListBlock title="Enlaces compartidos" values={scanResult.clientInputs.sharedLinks} />
                          </SummarySectionCard>

                          <SummarySectionCard title="Hallazgos públicos" icon={<Globe className="h-4.5 w-4.5 text-primary" />}>
                            <SummaryBlock
                              title="Sitio web encontrado"
                              value={scanResult.publicFindings.websiteFound || "No se confirmó un sitio web público."}
                            />
                            <SummaryListBlock title="Redes encontradas" values={scanResult.publicFindings.socialLinksFound} />
                            <SummaryBlock
                              title="Descripción pública observada"
                              value={scanResult.publicFindings.publicDescription}
                            />
                            <SummaryListBlock
                              title="Productos o servicios visibles"
                              values={scanResult.publicFindings.visibleProductsOrServices}
                            />
                            <SummaryListBlock
                              title="Mensajes o posicionamiento detectado"
                              values={scanResult.publicFindings.detectedMessages}
                            />
                          </SummarySectionCard>
                        </div>

                        <SummarySectionCard title="Base estratégica para marketing" icon={<Target className="h-4.5 w-4.5 text-primary" />}>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <SummaryBlock title="Cliente ideal" value={scanResult.strategicBase.idealCustomer} />
                            <SummaryBlock title="Problema principal" value={scanResult.strategicBase.mainProblem} />
                            <SummaryBlock title="Deseo principal" value={scanResult.strategicBase.mainDesire} />
                            <SummaryBlock
                              title="Propuesta de valor preliminar"
                              value={scanResult.strategicBase.preliminaryValueProposition}
                            />
                            <SummaryBlock title="CTA principal" value={scanResult.strategicBase.primaryCallToAction} />
                            <SummaryBlock title="Tono sugerido" value={scanResult.strategicBase.suggestedTone} />
                            <SummaryListBlock
                              title="Objeciones probables"
                              values={scanResult.strategicBase.probableObjections}
                            />
                            <SummaryListBlock
                              title="Ventajas visibles"
                              values={scanResult.strategicBase.visibleAdvantages}
                            />
                            <SummaryListBlock
                              title="Canales recomendados"
                              values={scanResult.strategicBase.recommendedChannels}
                            />
                          </div>
                        </SummarySectionCard>

                        <SummarySectionCard title="Fuentes revisadas" icon={<Bot className="h-4.5 w-4.5 text-primary" />}>
                          <SummaryListBlock title="URLs revisadas" values={scanResult.sources} />
                        </SummarySectionCard>

                        {scanResult.missing.length > 0 ? (
                          <SummarySectionCard title="Información que todavía conviene afinar" icon={<Search className="h-4.5 w-4.5 text-primary" />}>
                            <div className="space-y-3">
                              {scanResult.missing.map((item) => (
                                <SummaryBlock key={item.id} title={item.title} value={item.prompt} />
                              ))}
                            </div>
                          </SummarySectionCard>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {error ? (
                    <div className="border-t border-destructive/30 bg-destructive/10 px-5 py-3 text-sm text-destructive md:px-8">
                      {error}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between border-t border-border bg-card/90 px-5 py-4 backdrop-blur md:px-8">
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
    <div className="rounded-xl border border-border bg-muted px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function SummaryListBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-muted px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      {values.length > 0 ? (
        <div className="mt-2 space-y-1.5 text-sm leading-6 text-foreground">
          {values.map((value) => (
            <p key={value} className="break-words">
              {value}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">No hay suficiente información confirmada todavía.</p>
      )}
    </div>
  );
}

function SummarySectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}





