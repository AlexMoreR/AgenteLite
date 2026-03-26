"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import {
  generateFacebookAdsFromImageAction,
  type FacebookAdsGeneratorState,
} from "@/app/actions/marketing-actions";
import { FormSubmitButton } from "@/components/marketing/form-submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initialState: FacebookAdsGeneratorState = {
  ok: false,
  message: "",
  creatives: [],
};

export function SimpleMarketingForm() {
  const [state, formAction] = useActionState(
    generateFacebookAdsFromImageAction,
    initialState,
  );
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!state.message) {
      return;
    }

    if (state.ok) {
      toast.success(state.message);
      return;
    }

    toast.error(state.message);
  }, [state]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const creatives = useMemo(() => state.creatives, [state.creatives]);

  return (
    <div className="grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Crea tu anuncio desde una foto
          </h2>
        </div>

        <form action={formAction} className="space-y-4">
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
            <span className="text-sm font-medium text-slate-700">Foto del producto</span>
            <div className="overflow-hidden rounded-2xl border border-dashed border-[var(--line-strong)] bg-slate-50">
              <div className="flex min-h-56 items-center justify-center bg-white p-4">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Vista previa del producto"
                    className="max-h-52 w-full object-contain"
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

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Instrucciones extra</span>
            <textarea
              name="brief"
              rows={4}
              className="field-textarea min-h-24"
              placeholder="Ej. resaltar lujo, oferta por tiempo limitado, tono femenino, envio gratis..."
            />
          </label>

          <FormSubmitButton />
        </form>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-2 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-slate-900">Resultado</h3>
          <p className="text-sm text-slate-600">
            Generaremos 3 opciones con texto comercial dentro de la imagen, listas
            para descargar y usar en tu anuncio.
          </p>
        </Card>

        {creatives.length > 0 ? (
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
        ) : (
          <Card className="flex min-h-80 items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-2">
              <p className="text-base font-semibold text-slate-900">
                Aqui apareceran tus 3 anuncios
              </p>
              <p className="text-sm leading-6 text-slate-600">
                Sube una foto del producto, completa el formulario y te devolvemos
                tres creativos con texto comercial integrado.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
