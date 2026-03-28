"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

function splitMultilineValue(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

type AdsGeneratorFormProps = {
  pending: boolean;
  initialValues?: Partial<AdProductInput>;
  onSubmit: (input: AdProductInput) => void;
};

export function AdsGeneratorForm({ pending, initialValues, onSubmit }: AdsGeneratorFormProps) {
  const defaultObjective = initialValues?.objective ?? "sales";
  const defaultTone = initialValues?.tone ?? "persuasive";
  const defaultImageSource = initialValues?.image?.source ?? "creativos";
  const defaultImageUrl = initialValues?.image?.url ?? "";
  const hasExistingCreative = Boolean(defaultImageUrl);

  return (
    <Card className="rounded-[32px] border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] p-0 shadow-[0_24px_58px_-40px_rgba(15,23,42,0.18)]">
      <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] shadow-[0_16px_30px_-24px_color-mix(in_srgb,var(--primary)_35%,black)]">
          <Sparkles className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.35rem]">
              Datos del producto
            </h2>
            <p className="max-w-[62ch] text-sm leading-6 text-slate-600">
              Completa la base del anuncio. Por ahora esta pantalla usa el flujo mock del modulo
              `ads-generator`.
            </p>
            {defaultImageUrl ? (
              <p className="text-xs leading-5 text-[var(--primary)]">
                Detectamos una imagen precargada desde el flujo anterior. Puedes usarla tal como esta o reemplazarla.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <form
        className="space-y-5 px-5 py-5 sm:px-7 sm:py-6"
        onSubmit={(event) => {
          event.preventDefault();

          const formData = new FormData(event.currentTarget);
          const productName = String(formData.get("productName") ?? "").trim();
          const productDescription = String(formData.get("productDescription") ?? "").trim();
          const imageMode = String(formData.get("imageMode") ?? (hasExistingCreative ? "existing" : "none")).trim();
          const priceRaw = String(formData.get("price") ?? "").trim();

          const input: AdProductInput = {
            productName,
            productDescription,
            brandName: String(formData.get("brandName") ?? "").trim() || undefined,
            categoryName: String(formData.get("categoryName") ?? "").trim() || undefined,
            price: priceRaw ? Number(priceRaw) : undefined,
            currency: String(formData.get("currency") ?? "").trim() || undefined,
            landingPageUrl: String(formData.get("landingPageUrl") ?? "").trim() || undefined,
            objective: String(formData.get("objective") ?? "").trim() as AdProductInput["objective"],
            audienceSummary: String(formData.get("audienceSummary") ?? "").trim() || undefined,
            tone: String(formData.get("tone") ?? "").trim() as AdProductInput["tone"],
            keyBenefits: splitMultilineValue(String(formData.get("keyBenefits") ?? "")),
            painPoints: splitMultilineValue(String(formData.get("painPoints") ?? "")),
            callToAction: String(formData.get("callToAction") ?? "").trim() || undefined,
            image: imageMode === "existing" && defaultImageUrl
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
                className="field-textarea min-h-32"
                placeholder="Resume que vende el producto, que lo hace atractivo y por que alguien deberia hacer clic."
                defaultValue={initialValues?.productDescription ?? ""}
                required
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Categoria</span>
              <Input name="categoryName" placeholder="Ej. Belleza" defaultValue={initialValues?.categoryName ?? ""} />
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Landing page</span>
              <Input
                name="landingPageUrl"
                type="url"
                placeholder="https://tu-sitio.com/producto"
                defaultValue={initialValues?.landingPageUrl ?? ""}
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
          </div>
        </div>

        <div className="rounded-[30px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] sm:p-6">
          <div className="grid gap-4">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Audiencia</span>
              <textarea
                name="audienceSummary"
                rows={3}
                className="field-textarea min-h-24"
                placeholder="Ej. Mujeres de 25 a 40 interesadas en cuidado facial premium y rutinas practicas."
                defaultValue={initialValues?.audienceSummary ?? ""}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Beneficios clave</span>
              <textarea
                name="keyBenefits"
                rows={4}
                className="field-textarea min-h-32"
                placeholder={"Escribe un beneficio por linea.\nReduce lineas de expresion.\nTextura ligera.\nIdeal para uso diario."}
                defaultValue={initialValues?.keyBenefits?.join("\n") ?? ""}
                required
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Pain points</span>
              <textarea
                name="painPoints"
                rows={3}
                className="field-textarea min-h-24"
                placeholder={"Opcional, uno por linea.\nPoco tiempo para una rutina larga.\nPiel opaca y sin hidratacion."}
                defaultValue={initialValues?.painPoints?.join("\n") ?? ""}
              />
            </label>

            <label className="space-y-1.5 md:max-w-sm">
              <span className="text-sm font-medium text-slate-700">Call to action</span>
              <Input
                name="callToAction"
                defaultValue={initialValues?.callToAction ?? "Compra ahora"}
                placeholder="Compra ahora"
              />
            </label>
          </div>
        </div>

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

        <div className="flex justify-end border-t border-[rgba(148,163,184,0.14)] px-1 pt-5">
          <Button type="submit" size="lg" disabled={pending} className="h-12 rounded-2xl px-6">
            {pending ? "Generando..." : "Generar anuncio"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
