"use client";

import { useMemo, useState } from "react";
import { Boxes, FileText, Plus, Trash2, UserRound } from "lucide-react";
import { adminUpdateQuoteFullAction } from "@/app/actions/quote-actions";
import { Input } from "@/components/ui/input";
import type { SupportedCurrencyCode } from "@/lib/currency";
import { calculateQuoteLineTotal } from "@/lib/quote-item-meta";

type ClientOption = {
  id: string;
  name: string;
  email: string;
  document: string;
  phone: string;
  address: string;
  neighborhood: string;
  department: string;
  city: string;
};

type ProductOption = {
  id: string;
  name: string;
  code: string | null;
  retailPrice: number;
  thumbnailUrl?: string | null;
};

type InitialLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  description: string;
  color: string;
  additionalCost: number;
  discount: number;
};

type EditQuoteData = {
  id: string;
  code: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  validUntil: string;
  notes: string;
  client: {
    id: string;
    name: string;
    email: string;
    document: string;
    phone: string;
    address: string;
    neighborhood: string;
    department: string;
    city: string;
  };
  items: InitialLine[];
};

type QuoteLine = {
  uid: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  description: string;
  color: string;
  additionalCost: number;
  discount: number;
};

type EditQuoteWorkspaceProps = {
  quote: EditQuoteData;
  clients: ClientOption[];
  products: ProductOption[];
  currency: SupportedCurrencyCode;
};

export function EditQuoteWorkspace({ quote, clients, products, currency }: EditQuoteWorkspaceProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientId, setClientId] = useState(quote.client.id);
  const [clientName, setClientName] = useState(quote.client.name);
  const [clientDocument, setClientDocument] = useState(quote.client.document);
  const [clientEmail, setClientEmail] = useState(quote.client.email);
  const [clientPhone, setClientPhone] = useState(quote.client.phone);
  const [clientAddress, setClientAddress] = useState(quote.client.address);
  const [clientNeighborhood, setClientNeighborhood] = useState(quote.client.neighborhood);
  const [clientDepartment, setClientDepartment] = useState(quote.client.department);
  const [clientCity, setClientCity] = useState(quote.client.city);
  const [status, setStatus] = useState(quote.status);
  const [validUntil, setValidUntil] = useState(quote.validUntil);
  const [notes, setNotes] = useState(quote.notes);
  const [lines, setLines] = useState<QuoteLine[]>(
    quote.items.map((item) => ({
      uid: crypto.randomUUID(),
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      description: item.description,
      color: item.color,
      additionalCost: item.additionalCost,
      discount: item.discount,
    })),
  );

  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("1");
  const [draftColor, setDraftColor] = useState("");
  const [draftUnitPrice, setDraftUnitPrice] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAdditionalCost, setDraftAdditionalCost] = useState("0");
  const [draftDiscount, setDraftDiscount] = useState("0");
  const [productFormError, setProductFormError] = useState("");

  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        ...client,
        displayName: client.name.replace(client.email, "").trim() || client.name,
      })),
    [clients],
  );

  const linesWithMeta = useMemo(
    () =>
      lines.map((line) => ({
        line,
        product: products.find((product) => product.id === line.productId),
        lineTotal: calculateQuoteLineTotal(line.quantity, line.unitPrice, line.additionalCost, line.discount),
      })),
    [lines, products],
  );

  const quoteTotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + calculateQuoteLineTotal(line.quantity, line.unitPrice, line.additionalCost, line.discount),
        0,
      ),
    [lines],
  );

  const quoteSubtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [lines],
  );

  const quoteDiscountTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.discount, 0),
    [lines],
  );

  const quoteAdditionalCostTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.additionalCost, 0),
    [lines],
  );

  const onSelectClient = (id: string) => {
    const selected = clientOptions.find((client) => client.id === id);
    if (!selected) {
      setClientId("");
      return;
    }
    setClientId(selected.id);
    setClientName(selected.displayName);
    setClientDocument(selected.document);
    setClientEmail(selected.email);
    setClientPhone(selected.phone);
    setClientAddress(selected.address);
    setClientNeighborhood(selected.neighborhood);
    setClientDepartment(selected.department);
    setClientCity(selected.city);
  };

  const addDraftProduct = () => {
    if (!draftProductId) {
      setProductFormError("Selecciona un producto.");
      return;
    }
    const quantity = Number(draftQuantity || 0);
    const unitPrice = Number(draftUnitPrice || 0);
    const additionalCost = Number(draftAdditionalCost || 0);
    const discount = Number(draftDiscount || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setProductFormError("La cantidad debe ser mayor a 0.");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setProductFormError("El precio debe ser mayor a 0.");
      return;
    }
    if (!Number.isFinite(additionalCost) || additionalCost < 0) {
      setProductFormError("El costo adicional no puede ser negativo.");
      return;
    }
    if (!Number.isFinite(discount) || discount < 0) {
      setProductFormError("El descuento no puede ser negativo.");
      return;
    }
    setLines((current) => [
      ...current,
      {
        uid: crypto.randomUUID(),
        productId: draftProductId,
        quantity,
        unitPrice,
        description: draftDescription.trim(),
        color: draftColor.trim(),
        additionalCost,
        discount,
      },
    ]);
    setDraftProductId("");
    setDraftQuantity("1");
    setDraftColor("");
    setDraftUnitPrice("");
    setDraftDescription("");
    setDraftAdditionalCost("0");
    setDraftDiscount("0");
    setProductFormError("");
  };

  const serializedItems = JSON.stringify(
    lines.map((line) => ({
      productId: line.productId,
      supplierId: null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      color: line.color || null,
      additionalCost: line.additionalCost,
      discount: line.discount,
      notes: line.description || null,
    })),
  );

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-slate-500" />
          Editar cotizacion {quote.code}
        </h1>
      </div>

      <form action={adminUpdateQuoteFullAction} className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4">
        <input type="hidden" name="quoteId" value={quote.id} />
        <input type="hidden" name="returnTo" value={`/admin/cotizaciones/${quote.id}`} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="name" value={clientName} />
        <input type="hidden" name="document" value={clientDocument} />
        <input type="hidden" name="email" value={clientEmail} />
        <input type="hidden" name="phone" value={clientPhone} />
        <input type="hidden" name="address" value={clientAddress} />
        <input type="hidden" name="neighborhood" value={clientNeighborhood} />
        <input type="hidden" name="department" value={clientDepartment} />
        <input type="hidden" name="city" value={clientCity} />
        <input type="hidden" name="items" value={serializedItems} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="validUntil" value={validUntil} />
        <input type="hidden" name="notes" value={notes} />

        <div className="grid gap-1.5 md:grid-cols-3">
          <button type="button" onClick={() => setStep(1)} className={`rounded-lg border p-2 text-left ${step === 1 ? "border-[var(--primary)]/40 bg-[var(--primary)]/5" : "border-slate-200"}`}>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800"><UserRound className="h-3.5 w-3.5" />Cliente</span>
          </button>
          <button type="button" onClick={() => setStep(2)} className={`rounded-lg border p-2 text-left ${step === 2 ? "border-[var(--primary)]/40 bg-[var(--primary)]/5" : "border-slate-200"}`}>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800"><Boxes className="h-3.5 w-3.5" />Productos</span>
          </button>
          <button type="button" onClick={() => setStep(3)} className={`rounded-lg border p-2 text-left ${step === 3 ? "border-[var(--primary)]/40 bg-[var(--primary)]/5" : "border-slate-200"}`}>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800"><FileText className="h-3.5 w-3.5" />Finalizar</span>
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-slate-700">Cliente existente</span>
              <select className="field-select" value={clientId} onChange={(event) => onSelectClient(event.target.value)}>
                <option value="">Seleccionar cliente</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.displayName} - {client.document}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Nombre</span><Input value={clientName} onChange={(e) => setClientName(e.target.value)} /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">NIT / C.C</span><Input value={clientDocument} onChange={(e) => setClientDocument(e.target.value)} /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Correo</span><Input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Telefono</span><Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></label>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1.5 block md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">Producto</span>
                  <select className="field-select" value={draftProductId} onChange={(e) => {
                  setDraftProductId(e.target.value);
                  const product = products.find((p) => p.id === e.target.value);
                  if (product) setDraftUnitPrice(String(product.retailPrice));
                }}>
                  <option value="">Seleccionar producto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.code || "SIN-CODIGO"} - {product.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Cantidad</span><Input type="number" min={1} value={draftQuantity} onChange={(e) => setDraftQuantity(e.target.value)} /></label>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Color</span><Input value={draftColor} onChange={(e) => setDraftColor(e.target.value)} placeholder="Color" /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Precio</span><Input type="number" min={0} step="0.01" value={draftUnitPrice} onChange={(e) => setDraftUnitPrice(e.target.value)} /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Costo adicional</span><Input type="number" min={0} step="0.01" value={draftAdditionalCost} onChange={(e) => setDraftAdditionalCost(e.target.value)} /></label>
              <label className="space-y-1.5 block"><span className="text-sm font-medium text-slate-700">Descuento</span><Input type="number" min={0} step="0.01" value={draftDiscount} onChange={(e) => setDraftDiscount(e.target.value)} /></label>
              </div>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-slate-700">Descripcion</span>
              <Input value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
            </label>
            <button type="button" onClick={addDraftProduct} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-sm font-medium text-white">
              <Plus className="h-4 w-4" />Agregar producto
            </button>
            {productFormError ? <p className="text-xs font-medium text-red-600">{productFormError}</p> : null}

            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-left">Descripcion</th>
                    <th className="px-3 py-2 text-left">Cant</th>
                    <th className="px-3 py-2 text-left">Color</th>
                    <th className="px-3 py-2 text-left">Precio</th>
                    <th className="px-3 py-2 text-left">Total</th>
                    <th className="px-3 py-2 text-left">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {linesWithMeta.map(({ line, product, lineTotal }) => (
                    <tr key={line.uid} className="border-t border-[var(--line)]">
                      <td className="px-3 py-2 text-slate-900">{product?.name || "Producto"}</td>
                      <td className="px-3 py-2 text-slate-700">{line.description || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{line.quantity}</td>
                      <td className="px-3 py-2 text-slate-700">{line.color || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{line.unitPrice.toLocaleString("es-CO", { style: "currency", currency })}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{lineTotal.toLocaleString("es-CO", { style: "currency", currency })}</td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setLines((current) => current.filter((item) => item.uid !== line.uid))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1.5 block">
                <span className="text-sm font-medium text-slate-700">Estado</span>
                <select className="field-select" value={status} onChange={(e) => setStatus(e.target.value as EditQuoteData["status"])}>
                  <option value="DRAFT">Borrador</option>
                  <option value="SENT">Enviada</option>
                  <option value="ACCEPTED">Aceptada</option>
                  <option value="REJECTED">Rechazada</option>
                  <option value="EXPIRED">Expirada</option>
                </select>
              </label>
              <label className="space-y-1.5 block">
                <span className="text-sm font-medium text-slate-700">Valida hasta</span>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </label>
              <label className="space-y-1.5 block">
                <span className="text-sm font-medium text-slate-700">Total</span>
                <Input value={quoteTotal.toLocaleString("es-CO", { style: "currency", currency })} readOnly />
              </label>
            </div>
            <div className="grid gap-2 rounded-lg border border-[var(--line)] bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                <span className="text-sm font-medium text-slate-700">Subtotal</span>
                <p className="mt-1 text-lg font-medium text-slate-700">
                  {quoteSubtotal.toLocaleString("es-CO", { style: "currency", currency })}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                <span className="text-sm font-medium text-slate-700">Descuento</span>
                <p className="mt-1 text-lg font-medium text-slate-700">
                  {quoteDiscountTotal.toLocaleString("es-CO", { style: "currency", currency })}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                <span className="text-sm font-medium text-slate-700">Valor adicional</span>
                <p className="mt-1 text-lg font-medium text-slate-700">
                  {quoteAdditionalCostTotal.toLocaleString("es-CO", { style: "currency", currency })}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                <span className="text-sm font-medium text-slate-700">Total</span>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {quoteTotal.toLocaleString("es-CO", { style: "currency", currency })}
                </p>
              </div>
            </div>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-slate-700">Notas</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[var(--line-strong)]"
              />
            </label>
            <div className="flex justify-end">
              <button type="submit" className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white hover:bg-[var(--primary-strong)]">
                Guardar cambios
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
