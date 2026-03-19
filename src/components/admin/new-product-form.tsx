"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
} from "lucide-react";
import { adminCreateProductAction } from "@/app/actions/product-actions";
import { ProductFormStepper } from "@/components/admin/product-form-stepper";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney, type SupportedCurrencyCode } from "@/lib/currency";
import { calculateProfit, calculateRetailPrice, calculateWholesalePrice } from "@/lib/pricing";

type CategoryOption = {
  id: string;
  name: string;
};

type SupplierOption = {
  id: string;
  name: string;
};

type NewProductFormProps = {
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  currency: SupportedCurrencyCode;
};

type NewProductDraft = {
  name: string;
  code: string;
  description: string;
  baseCost: string;
  retailMarginPct: string;
  retailPriceInput: string;
  wholesaleMarginPct: string;
  wholesalePriceInput: string;
  minWholesaleQty: string;
  wholesaleEnabled: boolean;
  retailPriceDirty: boolean;
  wholesalePriceDirty: boolean;
  categoryId: string;
  supplierId: string;
};

export const NEW_PRODUCT_DRAFT_KEY = "admin:new-product-draft:v1";

export function NewProductForm({ categories, suppliers, currency }: NewProductFormProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [baseCost, setBaseCost] = useState("0");
  const [retailMarginPct, setRetailMarginPct] = useState("35");
  const [retailPriceInput, setRetailPriceInput] = useState("0");
  const [wholesaleMarginPct, setWholesaleMarginPct] = useState("20");
  const [wholesalePriceInput, setWholesalePriceInput] = useState("0");
  const [minWholesaleQty, setMinWholesaleQty] = useState("6");
  const [wholesaleEnabled, setWholesaleEnabled] = useState(false);
  const [retailPriceDirty, setRetailPriceDirty] = useState(false);
  const [wholesalePriceDirty, setWholesalePriceDirty] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [mainImageUrls, setMainImageUrls] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      mainImageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [mainImageUrls]);

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(NEW_PRODUCT_DRAFT_KEY);
      if (!rawDraft) {
        setDraftReady(true);
        return;
      }

      const draft = JSON.parse(rawDraft) as Partial<NewProductDraft>;
      setName(draft.name ?? "");
      setCode(draft.code ?? "");
      setDescription(draft.description ?? "");
      setBaseCost(draft.baseCost ?? "0");
      setRetailMarginPct(draft.retailMarginPct ?? "35");
      setRetailPriceInput(draft.retailPriceInput ?? "0");
      setWholesaleMarginPct(draft.wholesaleMarginPct ?? "20");
      setWholesalePriceInput(draft.wholesalePriceInput ?? "0");
      setMinWholesaleQty(draft.minWholesaleQty ?? "6");
      setWholesaleEnabled(draft.wholesaleEnabled ?? false);
      setRetailPriceDirty(draft.retailPriceDirty ?? false);
      setWholesalePriceDirty(draft.wholesalePriceDirty ?? false);
      setCategoryId(draft.categoryId ?? "");
      setSupplierId(draft.supplierId ?? "");
      setDraftRestored(true);
    } catch {
      window.localStorage.removeItem(NEW_PRODUCT_DRAFT_KEY);
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    const draft: NewProductDraft = {
      name,
      code,
      description,
      baseCost,
      retailMarginPct,
      retailPriceInput,
      wholesaleMarginPct,
      wholesalePriceInput,
      minWholesaleQty,
      wholesaleEnabled,
      retailPriceDirty,
      wholesalePriceDirty,
      categoryId,
      supplierId,
    };

    window.localStorage.setItem(NEW_PRODUCT_DRAFT_KEY, JSON.stringify(draft));
  }, [
    draftReady,
    name,
    code,
    description,
    baseCost,
    retailMarginPct,
    retailPriceInput,
    wholesaleMarginPct,
    wholesalePriceInput,
    minWholesaleQty,
    wholesaleEnabled,
    retailPriceDirty,
    wholesalePriceDirty,
    categoryId,
    supplierId,
  ]);

  const pricing = useMemo(() => {
    const cost = Number(baseCost) || 0;
    const retailMargin = Number(retailMarginPct) || 0;
    const wholesaleMargin = wholesaleEnabled ? Number(wholesaleMarginPct) || 0 : 0;
    const suggestedRetail = calculateRetailPrice(cost, retailMargin);
    const finalRetail = retailPriceDirty ? Number(retailPriceInput) || 0 : suggestedRetail;
    const suggestedWholesale = calculateWholesalePrice(cost, wholesaleMargin);
    const finalWholesale = wholesaleEnabled
      ? wholesalePriceDirty
        ? Number(wholesalePriceInput) || 0
        : suggestedWholesale
      : 0;
    const profit = calculateProfit(cost, finalRetail);
    const wholesaleProfit = calculateProfit(cost, finalWholesale);

    return {
      suggestedRetail,
      finalRetail,
      profit,
      suggestedWholesale,
      finalWholesale,
      wholesaleProfit,
      retail: formatMoney(finalRetail, currency),
      suggestedRetailLabel: formatMoney(suggestedRetail, currency),
      wholesale: formatMoney(finalWholesale, currency),
      suggestedWholesaleLabel: formatMoney(suggestedWholesale, currency),
      wholesaleProfitLabel: formatMoney(wholesaleProfit, currency),
      profitLabel: formatMoney(profit, currency),
      cost: formatMoney(cost, currency),
    };
  }, [baseCost, retailMarginPct, retailPriceInput, retailPriceDirty, wholesaleMarginPct, wholesalePriceInput, wholesalePriceDirty, currency, wholesaleEnabled]);

  const retailPriceFieldValue = retailPriceDirty ? retailPriceInput : pricing.suggestedRetail.toFixed(2);
  const wholesalePriceFieldValue = wholesalePriceDirty ? wholesalePriceInput : pricing.suggestedWholesale.toFixed(2);

  const allImageUrls = useMemo(() => mainImageUrls, [mainImageUrls]);

  const previewImageUrl = allImageUrls[0] ?? null;
  const step1Ready = name.trim().length >= 2 && allImageUrls.length > 0;
  const step2Ready =
    Number(baseCost) > 0 &&
    Number(retailMarginPct) >= 0 &&
    pricing.finalRetail > 0 &&
    (!wholesaleEnabled || (Number(wholesaleMarginPct) >= 0 && pricing.finalWholesale > 0 && Number(minWholesaleQty) >= 1));
  const activeStep = !step1Ready ? 1 : !step2Ready ? 2 : 3;
  const steps = [
    { id: 1, label: "Producto" },
    { id: 2, label: "Precios" },
    { id: 3, label: "Inventario" },
  ] as const;

  const syncSelectedFiles = (files: File[]) => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }

    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    setSelectedFiles(files);

    mainImageUrls.forEach((url) => URL.revokeObjectURL(url));
    setMainImageUrls(files.map((file) => URL.createObjectURL(file)));
  };

  const removeImageAt = (index: number) => {
    const nextFiles = selectedFiles.filter((_, i) => i !== index);
    syncSelectedFiles(nextFiles);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)] xl:gap-8">
      <aside className="space-y-4 xl:sticky xl:top-8 xl:h-fit xl:space-y-5">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-white">
              <div className="relative flex h-52 items-center justify-center bg-slate-100">
                {previewImageUrl ? (
                  <img src={previewImageUrl} alt="Vista previa" className="h-full w-full object-contain" />
                ) : (
                  <p className="text-xs text-slate-500">Primera imagen del producto</p>
                )}
              <span className="absolute right-2 top-2 rounded-full border border-[var(--line)] bg-white/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {code.trim() || "SKU"}
              </span>
            </div>
            <div className="space-y-1.5 border-t border-[var(--line)] bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">{name.trim() || "Nuevo producto"}</p>
              {description.trim() ? (
                <p className="line-clamp-2 text-xs text-slate-500">{description.trim()}</p>
              ) : (
                <p className="text-xs text-slate-400">Agrega descripcion para completar la ficha.</p>
              )}
              <p className="text-lg font-semibold tracking-tight text-slate-900">{pricing.retail}</p>
              {wholesaleEnabled ? (
                <p className="text-xs text-slate-600">
                  Mayorista: {pricing.wholesale} (min {minWholesaleQty || "1"} uds)
                </p>
              ) : null}
            </div>
          </div>
          <ProductFormStepper steps={steps} activeStep={activeStep} />
        </div>

      </aside>

      <Card className="space-y-6 overflow-hidden px-4 pb-4 pt-0 sm:space-y-7 sm:px-6 sm:pb-6">
        <form action={adminCreateProductAction} className="space-y-7">
          {draftRestored ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Se restauro el ultimo borrador. Las imagenes deben seleccionarse de nuevo.
            </div>
          ) : null}
          <section className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)] sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">📦 Nombre</span>
                <Input name="name" placeholder="Ej. Camisa Oxford" required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">📝 Descripcion</span>
                <Input
                  name="description"
                  placeholder="Descripcion del producto"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div className="block space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">🖼️ Multimedia</span>
                <div
                  className={`space-y-3 rounded-xl border border-dashed p-4 transition ${
                    dragActive
                      ? "border-slate-400 bg-slate-100/80"
                      : "border-[var(--line-strong)] bg-slate-50/60"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const dropped = Array.from(e.dataTransfer.files).filter((file) =>
                      file.type.startsWith("image/"),
                    );
                    if (dropped.length === 0) {
                      return;
                    }

                    syncSelectedFiles([...selectedFiles, ...dropped]);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    name="images"
                    type="file"
                    accept="image/*"
                    multiple
                    required
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length === 0) {
                        return;
                      }
                      syncSelectedFiles([...selectedFiles, ...files]);
                    }}
                  />
                  {allImageUrls.length === 0 ? (
                    <button
                      type="button"
                      className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-[var(--line)] bg-white px-4 py-8 text-center transition hover:bg-slate-50"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="text-2xl">⬆️</span>
                      <span className="text-sm font-medium text-slate-700">Subir imagen</span>
                      <span className="mt-1 text-xs text-slate-500">
                        Arrastra y suelta o haz clic para seleccionar varias.
                      </span>
                    </button>
                  ) : (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        ➕ Agregar imagenes
                      </button>
                    </div>
                  )}
                  {allImageUrls.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {allImageUrls.map((url, index) => (
                        <div
                          key={`${url}-${index}`}
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-slate-100"
                        >
                          <img src={url} alt={`Imagen ${index + 1}`} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImageAt(index);
                            }}
                            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black"
                            aria-label={`Eliminar imagen ${index + 1}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)] sm:p-5">
            <div className="space-y-1 border-b border-[var(--line)] pb-3">
              <h2 className="text-sm font-semibold text-slate-900">Precios</h2>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-slate-900"
                checked={wholesaleEnabled}
                onChange={(e) => setWholesaleEnabled(e.target.checked)}
              />
              Habilitar venta por mayor
            </label>
            <div className="grid gap-4 md:grid-cols-12">
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">📈 % Detal</span>
                <Input
                  name="retailMarginPct"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="35"
                  required
                  value={retailMarginPct}
                  onChange={(e) => setRetailMarginPct(e.target.value)}
                />
              </label>
              <label className="space-y-1.5 md:col-span-4">
                <span className="text-sm font-medium text-slate-700">💸 Costo compra ({currency})</span>
                <Input
                  name="baseCost"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  required
                  value={baseCost}
                  onChange={(e) => setBaseCost(e.target.value)}
                />
              </label>
              <label className="space-y-1.5 md:col-span-6">
                <span className="text-sm font-medium text-slate-700">🏷️ Precio final</span>
                <Input
                  name="retailPrice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  required
                  value={retailPriceFieldValue}
                  onChange={(e) => {
                    setRetailPriceInput(e.target.value);
                    setRetailPriceDirty(true);
                  }}
                />
              </label>
              <label className="space-y-1.5 md:col-span-6">
                <span className="text-sm font-medium text-slate-700">💡 Precio sugerido</span>
                <Input
                  value={pricing.suggestedRetailLabel}
                  readOnly
                  className="bg-slate-100 text-slate-600"
                />
              </label>
              <label className="space-y-1.5 md:col-span-6">
                <span className="text-sm font-medium text-slate-700">💰 Ganancia</span>
                <Input
                  value={pricing.profitLabel}
                  readOnly
                  className="bg-slate-100 text-slate-600"
                />
              </label>
              {wholesaleEnabled ? (
                <>
                  <div className="md:col-span-12 border-t border-[var(--line)] pt-1" />
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">📦 % Mayor</span>
                    <Input
                      name="wholesaleMarginPct"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="20"
                      required
                      value={wholesaleMarginPct}
                      onChange={(e) => setWholesaleMarginPct(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1.5 md:col-span-4">
                    <span className="text-sm font-medium text-slate-700">💸 Costo compra ({currency})</span>
                    <Input value={baseCost} readOnly className="bg-slate-100 text-slate-600" />
                  </label>
                  <label className="space-y-1.5 md:col-span-6">
                    <span className="text-sm font-medium text-slate-700">🏷️ Precio final</span>
                    <Input
                      name="wholesalePrice"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={wholesalePriceFieldValue}
                      onChange={(e) => {
                        setWholesalePriceInput(e.target.value);
                        setWholesalePriceDirty(true);
                      }}
                    />
                  </label>
                  <label className="space-y-1.5 md:col-span-6">
                    <span className="text-sm font-medium text-slate-700">💡 Precio sugerido</span>
                    <Input value={pricing.suggestedWholesaleLabel} readOnly className="bg-slate-100 text-slate-600" />
                  </label>
                  <label className="space-y-1.5 md:col-span-6">
                    <span className="text-sm font-medium text-slate-700">💰 Ganancia</span>
                    <Input value={pricing.wholesaleProfitLabel} readOnly className="bg-slate-100 text-slate-600" />
                  </label>
                  <label className="space-y-1.5 md:col-span-12">
                    <span className="text-sm font-medium text-slate-700">🔢 Min. unidades mayor</span>
                    <Input
                      name="minWholesaleQty"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="6"
                      required
                      value={minWholesaleQty}
                      onChange={(e) => setMinWholesaleQty(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
              {!wholesaleEnabled ? (
                <>
                  <input type="hidden" name="wholesaleMarginPct" value="0" />
                  <input type="hidden" name="wholesalePrice" value="0" />
                  <input type="hidden" name="minWholesaleQty" value="1" />
                </>
              ) : null}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)] sm:p-5">
            <div className="space-y-1 border-b border-[var(--line)] pb-3">
              <h2 className="text-sm font-semibold text-slate-900">Inventario</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">🔤 Codigo</span>
                <Input
                  name="code"
                  placeholder="Ej. CAM-001"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">🏷️ Categoria</span>
                <select name="categoryId" className="field-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Sin categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">🚚 Proveedor principal</span>
                <select name="supplierId" className="field-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <div className="mt-1 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] pt-5">
            <Link
              href="/admin/productos"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--line)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
            >
              Guardar producto
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
