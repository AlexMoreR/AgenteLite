"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdProductInput } from "../types/ad-input";

const objectiveOptions: Array<{ value: NonNullable<AdProductInput["objective"]>; label: string }> = [
  { value: "sales", label: "Ventas" },
  { value: "traffic", label: "Trafico" },
  { value: "leads", label: "Leads" },
  { value: "engagement", label: "Interaccion" },
];

const toneOptions: Array<{ value: NonNullable<AdProductInput["tone"]>; label: string }> = [
  { value: "persuasive", label: "Persuasivo" },
  { value: "direct", label: "Directo" },
  { value: "premium", label: "Premium" },
  { value: "friendly", label: "Cercano" },
];

const steps = [
  {
    title: "Producto",
    subtitle: "Define la base comercial del producto o servicio.",
  },
  {
    title: "Estrategia",
    subtitle: "Organiza audiencia, beneficios y tono del anuncio.",
  },
  {
    title: "Apoyo visual",
    subtitle: "Decide si usaras un creativo existente o si seguiras sin imagen.",
  },
] as const;

function splitMultilineValue(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function inferBenefits(productName: string, description: string, categoryName: string) {
  const firstSentence = description
    .split(/[.!?]/)
    .map((item) => item.trim())
    .find(Boolean);

  const inferred = [
    firstSentence ? sentenceCase(firstSentence) : "",
    categoryName ? `${sentenceCase(productName)} dentro de ${categoryName.trim().toLowerCase()}.` : "",
    "Propuesta clara y facil de comunicar en un anuncio.",
  ].filter(Boolean);

  return Array.from(new Set(inferred)).slice(0, 3);
}

function inferPainPoints(description: string) {
  const normalized = description.toLowerCase();
  const suggestions = [
    /(ahorra|rapido|facil|practico|simple)/.test(normalized)
      ? "Personas que buscan una solucion practica y rapida."
      : "",
    /(premium|calidad|duradero|resistente|seguro)/.test(normalized)
      ? "Clientes que quieren una opcion confiable y de calidad."
      : "",
    /(hidrata|mejora|reduce|alivia|comodidad|bienestar)/.test(normalized)
      ? "Personas que quieren resolver una necesidad concreta con mejores resultados."
      : "",
  ].filter(Boolean);

  return Array.from(new Set(suggestions)).slice(0, 2);
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
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

type AdsGeneratorFormProps = {
  pending: boolean;
  initialValues?: Partial<AdProductInput>;
  onSubmit: (input: AdProductInput) => void;
};

export function AdsGeneratorForm({ pending, initialValues, onSubmit }: AdsGeneratorFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [showProductAdvanced, setShowProductAdvanced] = useState(false);
  const [showStrategyAdvanced, setShowStrategyAdvanced] = useState(false);
  const defaultObjective = initialValues?.objective ?? "sales";
  const defaultTone = initialValues?.tone ?? "persuasive";
  const defaultImageSource = initialValues?.image?.source ?? "creativos";
  const defaultImageUrl = initialValues?.image?.url ?? "";
  const defaultProductName = initialValues?.productName ?? "";
  const defaultProductDescription = initialValues?.productDescription ?? "";
  const defaultCategoryName = initialValues?.categoryName ?? "";
  const defaultKeyBenefits =
    initialValues?.keyBenefits?.length
      ? initialValues.keyBenefits.join("\n")
      : inferBenefits(defaultProductName, defaultProductDescription, defaultCategoryName).join("\n");
  const defaultPainPoints =
    initialValues?.painPoints?.length
      ? initialValues.painPoints.join("\n")
      : inferPainPoints(defaultProductDescription).join("\n");
  const hasExistingCreative = Boolean(defaultImageUrl);
  const activeStep = pending ? steps.length - 1 : step;

  const handleNext = () => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    const formData = new FormData(form);

    if (step === 0) {
      const productName = String(formData.get("productName") ?? "").trim();
      const productDescription = String(formData.get("productDescription") ?? "").trim();

      if (productName.length < 2) {
        form.querySelector<HTMLInputElement>("[name='productName']")?.reportValidity();
        return;
      }

      if (productDescription.length < 8) {
        form.querySelector<HTMLTextAreaElement>("[name='productDescription']")?.reportValidity();
        return;
      }
    }

    if (step === 1) {
      setStep((current) => Math.min(current + 1, steps.length - 1));
      return;
    }

    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  return (
    <form
      ref={formRef}
      className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();

          const formData = new FormData(event.currentTarget);
          const productName = String(formData.get("productName") ?? "").trim();
          const productDescription = String(formData.get("productDescription") ?? "").trim();
          const categoryName = String(formData.get("categoryName") ?? "").trim();
          const imageMode = String(formData.get("imageMode") ?? (hasExistingCreative ? "existing" : "none")).trim();
          const priceRaw = String(formData.get("price") ?? "").trim();
          const keyBenefits = splitMultilineValue(String(formData.get("keyBenefits") ?? ""));
          const painPoints = splitMultilineValue(String(formData.get("painPoints") ?? ""));

          const input: AdProductInput = {
            productName,
            productDescription,
            brandName: String(formData.get("brandName") ?? "").trim() || undefined,
            categoryName: categoryName || undefined,
            price: priceRaw ? Number(priceRaw) : undefined,
            currency: String(formData.get("currency") ?? "").trim() || undefined,
            landingPageUrl: String(formData.get("landingPageUrl") ?? "").trim() || undefined,
            objective: String(formData.get("objective") ?? "").trim() as AdProductInput["objective"],
            audienceSummary: String(formData.get("audienceSummary") ?? "").trim() || undefined,
            tone: String(formData.get("tone") ?? "").trim() as AdProductInput["tone"],
            keyBenefits:
              keyBenefits.length > 0
                ? keyBenefits
                : inferBenefits(productName, productDescription, categoryName),
            painPoints:
              painPoints.length > 0
                ? painPoints
                : inferPainPoints(productDescription),
            callToAction: String(formData.get("callToAction") ?? "").trim() || undefined,
            image:
              imageMode === "existing" && defaultImageUrl
                ? {
                    url: defaultImageUrl,
                    alt: productName || "Imagen del producto",
                    source: defaultImageSource,
                    isPrimary: true,
                  }
                : null,
          };

          onSubmit(input);
        }}
      >
      <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
        <div className="space-y-2 text-center">
          <div className="flex flex-wrap justify-center gap-2">
            {steps.map((item, index) => (
              <StepDot key={item.title} active={index === activeStep} done={index < activeStep} />
            ))}
          </div>
          <div className="space-y-2">
            <h2 className="text-[1.8rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2rem]">
              {pending ? "Generando la propuesta base" : steps[activeStep].title}
            </h2>
            <p className="mx-auto max-w-[62ch] text-sm leading-6 text-slate-600">
              {pending
                ? "Estamos organizando la informacion del producto para dejar una base lista para adaptar en Meta Ads Manager."
                : steps[activeStep].subtitle}
            </p>
            {defaultImageUrl && !pending ? (
              <p className="text-xs leading-5 text-[var(--primary)]">
                Detectamos un creativo precargado desde el flujo anterior.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4">
        <div className="mx-auto w-full max-w-[760px] space-y-5">
          <div className={step === 0 ? "block" : "hidden"}>
            <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Nombre del producto</span>
                <Input
                  name="productName"
                  placeholder="Ej. Serum facial antioxidante"
                  defaultValue={initialValues?.productName ?? ""}
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Marca</span>
                <Input name="brandName" placeholder="Ej. Aura Skin" defaultValue={initialValues?.brandName ?? ""} />
              </label>

              <label className="space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">Descripcion</span>
                <textarea
                  name="productDescription"
                  rows={4}
                  minLength={8}
                  className="field-textarea min-h-32"
                  placeholder="Resume que vende el producto, que lo hace atractivo y por que alguien deberia hacer clic."
                  defaultValue={initialValues?.productDescription ?? ""}
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Precio</span>
                <Input
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="199900"
                  defaultValue={initialValues?.price?.toString() ?? ""}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Moneda</span>
                <Input name="currency" defaultValue={initialValues?.currency ?? "COP"} placeholder="COP" />
              </label>

              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowProductAdvanced((current) => !current)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]"
                >
                  {showProductAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showProductAdvanced ? "Ocultar detalles avanzados" : "Mostrar detalles avanzados"}
                </button>
              </div>

              <div className={`${showProductAdvanced ? "grid" : "hidden"} gap-4 md:col-span-2 md:grid-cols-2`}>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Categoria</span>
                  <Input
                    name="categoryName"
                    placeholder="Ej. Belleza"
                    defaultValue={initialValues?.categoryName ?? ""}
                  />
                  {initialValues?.categoryName ? (
                    <p className="text-xs leading-5 text-slate-500">
                      Precargado desde el contexto del negocio.
                    </p>
                  ) : null}
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Landing page</span>
                  <Input
                    name="landingPageUrl"
                    type="url"
                    placeholder="https://tu-sitio.com/producto"
                    defaultValue={initialValues?.landingPageUrl ?? ""}
                  />
                  {initialValues?.landingPageUrl ? (
                    <p className="text-xs leading-5 text-slate-500">
                      Tomada de la web configurada en tu negocio.
                    </p>
                  ) : null}
                </label>
              </div>
            </div>
            </div>
          </div>

          <div className={step === 1 ? "block" : "hidden"}>
            <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
              <div className="space-y-4">
                <div className="rounded-[24px] border border-[var(--line)] bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">La IA armara esta parte por ti</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Usaremos el contexto del negocio, la descripcion del producto y la imagen para proponer audiencia, beneficios, necesidad y CTA.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowStrategyAdvanced((current) => !current)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]"
                >
                  {showStrategyAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showStrategyAdvanced ? "Ocultar ajustes avanzados" : "Mostrar ajustes avanzados"}
                </button>

                <div className={`${showStrategyAdvanced ? "space-y-5" : "hidden"}`}>
                  <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">Objetivo</span>
                      <select name="objective" className="field-select" defaultValue={defaultObjective}>
                        {objectiveOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">Tono</span>
                      <select name="tone" className="field-select" defaultValue={defaultTone}>
                        {toneOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-sm font-medium text-slate-700">Audiencia</span>
                      <textarea
                        name="audienceSummary"
                        rows={3}
                        className="field-textarea min-h-24"
                        placeholder="Ej. Mujeres de 25 a 40 interesadas en cuidado facial premium y rutinas practicas."
                        defaultValue={initialValues?.audienceSummary ?? ""}
                      />
                      {initialValues?.audienceSummary ? (
                        <p className="text-xs leading-5 text-slate-500">
                          Base sugerida desde el contexto comercial.
                        </p>
                      ) : null}
                    </label>
                  </div>
                  </div>

                  <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
                    <div className="grid gap-4">
                      <label className="space-y-1.5">
                        <span className="text-sm font-medium text-slate-700">Beneficios clave</span>
                        <textarea
                          name="keyBenefits"
                          rows={4}
                          className="field-textarea min-h-32"
                          placeholder="Beneficios clave del producto o servicio."
                          defaultValue={defaultKeyBenefits}
                        />
                        <p className="text-xs leading-5 text-slate-500">
                          Dejamos una base sugerida para que solo la ajustes si hace falta.
                        </p>
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-sm font-medium text-slate-700">Que necesidad ayuda a resolver</span>
                        <textarea
                          name="painPoints"
                          rows={3}
                          className="field-textarea min-h-24"
                          placeholder="Ej. Ahorrar tiempo, verse mejor, vender mas, sentirse mas comodo."
                          defaultValue={defaultPainPoints}
                        />
                        <p className="text-xs leading-5 text-slate-500">
                          Dejamos una sugerencia base para que la ajustes solo si quieres.
                        </p>
                      </label>

                      <label className="space-y-1.5 md:max-w-sm">
                        <span className="text-sm font-medium text-slate-700">Call to action</span>
                        <Input
                          name="callToAction"
                          defaultValue={initialValues?.callToAction ?? "Compra ahora"}
                          placeholder="Compra ahora"
                        />
                        {initialValues?.callToAction ? (
                          <p className="text-xs leading-5 text-slate-500">
                            CTA sugerido desde tu contexto del negocio.
                          </p>
                        ) : null}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={step === 2 ? "block" : "hidden"}>
            <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Apoyo visual</span>
                  <p className="text-xs leading-5 text-slate-500">
                    El anuncio puede salir sin imagen por ahora. Si quieres apoyarte en un recurso visual,
                    usa un creativo ya generado o entra al modulo Creativos.
                  </p>
                </div>

                {hasExistingCreative ? (
                  <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
                    <label className="flex cursor-pointer items-start gap-3 rounded-[24px] border border-[var(--line)] bg-slate-50 p-4">
                      <input
                        type="radio"
                        name="imageMode"
                        value="existing"
                        defaultChecked
                        className="mt-1"
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">Usar creativo existente</p>
                        <p className="text-xs leading-5 text-slate-500">
                          Aprovecha la imagen que ya viene precargada desde el flujo anterior.
                        </p>
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-start gap-3 rounded-[24px] border border-[var(--line)] bg-white p-4">
                      <input
                        type="radio"
                        name="imageMode"
                        value="none"
                        className="mt-1"
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">Seguir sin imagen por ahora</p>
                        <p className="text-xs leading-5 text-slate-500">
                          Genera primero la estrategia y el copy; luego puedes volver por el creativo.
                        </p>
                      </div>
                    </label>

                    <div className="rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-4 lg:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-900">Creative detectado</p>
                          <p className="text-xs leading-5 text-slate-500">
                            Si prefieres otro recurso visual, vuelve a Creativos y genera una nueva opcion.
                          </p>
                        </div>
                        <Button asChild type="button" variant="outline" className="rounded-2xl">
                          <Link href="/cliente/marketing-ia/creativos">
                            Ir a Creativos
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-4">
                    <input type="hidden" name="imageMode" value="none" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">Sin creativo conectado</p>
                        <p className="text-xs leading-5 text-slate-500">
                          Puedes continuar sin imagen o entrar a Creativos si quieres reforzar el anuncio con una pieza visual.
                        </p>
                      </div>
                      <Button asChild type="button" variant="outline" className="rounded-2xl">
                        <Link href="/cliente/marketing-ia/creativos">
                          Abrir Creativos
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-4 md:px-8">
        <div className="mx-auto flex w-full max-w-[760px] flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-2xl px-5 sm:w-auto"
            disabled={pending || step === 0}
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
          >
            Volver
          </Button>

          {step < steps.length - 1 ? (
            <Button type="button" size="lg" className="h-12 w-full rounded-2xl px-6 sm:w-auto" onClick={handleNext}>
              Continuar
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={pending} className="h-12 w-full rounded-2xl px-6 sm:w-auto">
              {pending ? "Generando..." : "Generar anuncio"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
