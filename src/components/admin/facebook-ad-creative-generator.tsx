"use client";

import { useActionState, useEffect, useState } from "react";
import { Download, LoaderCircle, Megaphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  generateProductFacebookAdsAction,
  type ProductAdCreativeActionState,
} from "@/app/actions/product-ad-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const initialState: ProductAdCreativeActionState = {
  ok: false,
  message: "",
  creatives: [],
};

type FacebookAdCreativeGeneratorProps = {
  productId: string;
  productName: string;
  imageUrls: string[];
  hasPendingUploads?: boolean;
};

export function FacebookAdCreativeGenerator({
  productId,
  productName,
  imageUrls,
  hasPendingUploads = false,
}: FacebookAdCreativeGeneratorProps) {
  const [state, formAction, pending] = useActionState(
    generateProductFacebookAdsAction,
    initialState,
  );
  const [selectedSourceImage, setSelectedSourceImage] = useState(imageUrls[0] ?? "");
  const [brief, setBrief] = useState("");

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

  const hasSavedImages = imageUrls.length > 0;
  const activeSourceImage = imageUrls.includes(selectedSourceImage)
    ? selectedSourceImage
    : imageUrls[0] ?? "";

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border bg-muted px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              <Megaphone className="h-3.5 w-3.5" />
              Meta Ads
            </p>
            <div>
              <h2 className="text-base font-semibold text-foreground sm:text-lg">
                Generador de creativos con IA
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Parte de la foto real del producto, la mejora levemente y crea 3
                opciones cuadradas con texto comercial listo para anuncio.
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            3 opciones listas para publicar
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:p-5">
        <div className="space-y-4">
          {hasSavedImages ? (
            <>
              <div className="overflow-hidden rounded-2xl border border-border bg-muted">
                <div className="flex aspect-square items-center justify-center bg-card">
                  <img
                    src={activeSourceImage}
                    alt={`Imagen base de ${productName}`}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="border-t border-border px-3 py-2">
                  <p className="text-xs font-medium text-foreground">
                    Imagen base seleccionada
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    El sistema conserva este producto y solo lo mejora de forma
                    sutil para el anuncio.
                  </p>
                </div>
              </div>

              <form action={formAction} className="space-y-4">
                <input type="hidden" name="productId" value={productId} />
                <input
                  type="hidden"
                  name="sourceImageUrl"
                  value={activeSourceImage}
                />

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fotos guardadas
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {imageUrls.map((imageUrl, index) => {
                      const isSelected = activeSourceImage === imageUrl;

                      return (
                        <button
                          key={`${imageUrl}-${index}`}
                          type="button"
                          onClick={() => setSelectedSourceImage(imageUrl)}
                          className={`relative overflow-hidden rounded-xl border transition ${
                            isSelected
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border hover:border-border"
                          }`}
                          aria-label={`Usar imagen ${index + 1} como base`}
                        >
                          <img
                            src={imageUrl}
                            alt={`Imagen guardada ${index + 1}`}
                            className="h-20 w-full object-cover"
                          />
                          <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[10px] font-medium text-white">
                            {isSelected ? "Seleccionada" : `Foto ${index + 1}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Instrucciones extra
                  </span>
                  <textarea
                    name="brief"
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                    maxLength={240}
                    rows={4}
                    placeholder="Ej. resaltar envio gratis, promo de lanzamiento, tono elegante, publico femenino..."
                    className="field-textarea min-h-24"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Opcional. Sirve para orientar el copy del anuncio.
                  </p>
                </label>

                {hasPendingUploads ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Las imagenes nuevas que agregaste aun no se usan aqui. Si
                    quieres generar anuncios con una foto recien subida, guarda el
                    producto primero.
                  </div>
                ) : null}

                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Generando 3 anuncios...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generar 3 creativos
                    </>
                  )}
                </Button>
              </form>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-muted/70 px-4 py-5 text-sm text-muted-foreground">
              Guarda el producto con al menos una imagen real para activar este
              generador.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Resultado esperado
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada opcion sale en formato cuadrado, con el producto reconocible y
              copy corto integrado en la composicion.
            </p>
          </div>

          {state.creatives.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-3">
              {state.creatives.map((creative, index) => (
                <article
                  key={creative.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="relative aspect-square bg-muted">
                    <img
                      src={creative.imageUrl}
                      alt={`Creativo ${index + 1} de ${productName}`}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-3 top-3 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-sm">
                      Opcion {index + 1}
                    </span>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {creative.angle}
                      </p>
                      <div className="space-y-1">
                        <p className="text-lg font-semibold tracking-tight text-foreground">
                          {creative.headline}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {creative.supportLine}
                        </p>
                      </div>
                      <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                        {creative.cta}
                      </span>
                    </div>

                    <a
                      href={creative.imageUrl}
                      download={`facebook-ad-${productId}-${index + 1}.png`}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition hover:bg-muted"
                    >
                      <Download className="h-4 w-4" />
                      Descargar imagen
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-border bg-muted px-6 py-10 text-center">
              <div className="max-w-md space-y-3">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-base font-semibold text-foreground">
                    Aqui apareceran tus 3 anuncios
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Genera primero los creativos y te dejaremos cada opcion con su
                    imagen lista para descargar y publicar.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
