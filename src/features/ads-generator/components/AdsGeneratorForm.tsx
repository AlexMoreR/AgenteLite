"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AdImageSource, AdProductInput } from "../types/ad-input";

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

const imageSourceOptions: Array<{ value: AdImageSource; label: string }> = [
  { value: "creativos", label: "Creativos" },
  { value: "upload", label: "Subida manual" },
  { value: "external", label: "URL externa" },
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

  return (
    <Card className="rounded-[28px] border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,255,0.94))] p-5 sm:p-6">
      <div className="mb-6 flex items-start gap-4">
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
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

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();

          const formData = new FormData(event.currentTarget);
          const productName = String(formData.get("productName") ?? "").trim();
          const productDescription = String(formData.get("productDescription") ?? "").trim();
          const imageUrl = String(formData.get("imageUrl") ?? "").trim();
          const imageSource = String(formData.get("imageSource") ?? "creativos") as AdImageSource;
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
            image: imageUrl
              ? {
                  url: imageUrl,
                  alt: productName || "Imagen del producto",
                  source: imageSource,
                  isPrimary: true,
                }
              : null,
          };

          onSubmit(input);
        }}
      >
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
              className="field-textarea min-h-28"
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

          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Audiencia</span>
            <textarea
              name="audienceSummary"
              rows={3}
              className="field-textarea min-h-24"
              placeholder="Ej. Mujeres de 25 a 40 interesadas en cuidado facial premium y rutinas practicas."
              defaultValue={initialValues?.audienceSummary ?? ""}
            />
          </label>

          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Beneficios clave</span>
            <textarea
              name="keyBenefits"
              rows={4}
              className="field-textarea min-h-28"
              placeholder={"Escribe un beneficio por linea.\nReduce lineas de expresion.\nTextura ligera.\nIdeal para uso diario."}
              defaultValue={initialValues?.keyBenefits?.join("\n") ?? ""}
              required
            />
          </label>

          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Pain points</span>
            <textarea
              name="painPoints"
              rows={3}
              className="field-textarea min-h-24"
              placeholder={"Opcional, uno por linea.\nPoco tiempo para una rutina larga.\nPiel opaca y sin hidratacion."}
              defaultValue={initialValues?.painPoints?.join("\n") ?? ""}
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Call to action</span>
            <Input
              name="callToAction"
              defaultValue={initialValues?.callToAction ?? "Compra ahora"}
              placeholder="Compra ahora"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Origen de la imagen</span>
            <select name="imageSource" className="field-select" defaultValue={defaultImageSource}>
              {imageSourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">URL de imagen o creativo</span>
            <Input
              name="imageUrl"
              type="url"
              placeholder="https://..."
              defaultValue={defaultImageUrl}
            />
            <p className="text-xs leading-5 text-slate-500">
              En la siguiente fase esto podra venir directamente del modulo Creativos.
            </p>
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending} className="rounded-2xl px-6">
            {pending ? "Generando..." : "Generar anuncio"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
