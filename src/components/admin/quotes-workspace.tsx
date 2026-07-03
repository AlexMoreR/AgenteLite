"use client";

import { useMemo, useState, useTransition } from "react";
import { Boxes, FileText, Link2, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { adminCreateQuoteAction, adminResolveClientAction } from "@/app/actions/quote-actions";
import { QuotesDataTable } from "@/components/admin/quotes-data-table";
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

type ProductSupplierOption = {
  id: string;
  name: string;
};

type ProductOption = {
  id: string;
  name: string;
  code: string | null;
  retailPrice: number;
  thumbnailUrl?: string | null;
  suppliers: ProductSupplierOption[];
};

type QuoteRow = {
  id: string;
  code: string;
  clientName: string;
  itemsCount: number;
  total: number;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  createdAt: string;
  shareToken: string;
};

type QuoteLine = {
  uid: string;
  productId: string;
  quantity: number;
  color: string;
  unitPrice: number;
  description: string;
  additionalCost: number;
  discount: number;
};

type QuotesWorkspaceProps = {
  quotes: QuoteRow[];
  clients: ClientOption[];
  products: ProductOption[];
  currency: SupportedCurrencyCode;
};

export function QuotesWorkspace({ quotes, clients, products, currency }: QuotesWorkspaceProps) {
  const [openModal, setOpenModal] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showClientResults, setShowClientResults] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientDocument, setClientDocument] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientNeighborhood, setClientNeighborhood] = useState("");
  const [clientDepartment, setClientDepartment] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientFormError, setClientFormError] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [isResolvingClient, startResolvingClient] = useTransition();

  const [openProductModal, setOpenProductModal] = useState(false);
  const [showProductResults, setShowProductResults] = useState(false);
  const [productLookup, setProductLookup] = useState("");
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("1");
  const [draftColor, setDraftColor] = useState("");
  const [draftUnitPrice, setDraftUnitPrice] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAdditionalCost, setDraftAdditionalCost] = useState("0");
  const [draftDiscount, setDraftDiscount] = useState("0");
  const [productFormError, setProductFormError] = useState("");
  const [isManualQuoteSubmit, setIsManualQuoteSubmit] = useState(false);

  const filteredClients = useMemo(() => {
    const q = clientName.trim().toLowerCase();
    if (!q) {
      return clients.slice(0, 8);
    }
    return clients
      .filter((client) =>
        `${client.name} ${client.email} ${client.document} ${client.phone}`.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [clients, clientName]);

  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId), [clients, clientId]);

  const getClientDisplayName = (client: ClientOption): string => {
    const byExactEmail = client.name.replace(client.email, "").trim();
    if (byExactEmail) {
      return byExactEmail;
    }
    const byRegex = client.name.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").trim();
    return byRegex || client.name;
  };

  const filteredProducts = useMemo(() => {
    const q = productLookup.trim().toLowerCase();
    if (!q) {
      return products.slice(0, 8);
    }
    return products
      .filter((product) => `${product.code ?? ""} ${product.name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, productLookup]);

  const draftProduct = useMemo(
    () => products.find((product) => product.id === draftProductId) ?? null,
    [products, draftProductId],
  );

  const linesWithMeta = useMemo(
    () =>
      lines.map((line) => {
        const product = products.find((item) => item.id === line.productId);
        return {
          line,
          product,
          lineTotal: calculateQuoteLineTotal(line.quantity, line.unitPrice, line.additionalCost, line.discount),
        };
      }),
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

  const removeLine = (uid: string) => {
    setLines((current) => current.filter((line) => line.uid !== uid));
  };

  const resetDraftProduct = () => {
    setDraftProductId("");
    setProductLookup("");
    setDraftQuantity("1");
    setDraftColor("");
    setDraftUnitPrice("");
    setDraftDescription("");
    setDraftAdditionalCost("0");
    setDraftDiscount("0");
    setProductFormError("");
    setShowProductResults(false);
  };

  const openAddProductModal = () => {
    resetDraftProduct();
    setOpenProductModal(true);
  };

  const applyProductSelection = (product: ProductOption) => {
    setDraftProductId(product.id);
    setProductLookup(product.code || product.name);
    setDraftUnitPrice(String(product.retailPrice));
    setShowProductResults(false);
    setProductFormError("");
  };

  const addDraftProduct = () => {
    if (!draftProductId) {
      setProductFormError("Selecciona un producto por codigo.");
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
        color: draftColor.trim(),
        unitPrice,
        description: draftDescription.trim(),
        additionalCost,
        discount,
      },
    ]);

    setOpenProductModal(false);
    resetDraftProduct();
  };

  const draftLineTotal = useMemo(() => {
    const quantity = Number(draftQuantity || 0);
    const unitPrice = Number(draftUnitPrice || 0);
    const additionalCost = Number(draftAdditionalCost || 0);
    const discount = Number(draftDiscount || 0);
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(additionalCost) ||
      !Number.isFinite(discount)
    ) {
      return 0;
    }
    return calculateQuoteLineTotal(quantity, unitPrice, additionalCost, discount);
  }, [draftAdditionalCost, draftDiscount, draftQuantity, draftUnitPrice]);

  const openQuoteModal = () => {
    setStep(1);
    setOpenModal(true);
  };

  const isClientDraftComplete = useMemo(
    () =>
      Boolean(
        clientName.trim() &&
          clientDocument.trim() &&
          clientEmail.trim() &&
          clientPhone.trim() &&
          clientAddress.trim() &&
          clientNeighborhood.trim() &&
          clientDepartment.trim() &&
          clientCity.trim(),
      ),
    [
      clientAddress,
      clientCity,
      clientDepartment,
      clientDocument,
      clientEmail,
      clientName,
      clientNeighborhood,
      clientPhone,
    ],
  );

  const isClientResolved = Boolean(clientId) || isClientDraftComplete;

  const handleClientInputChange = (setter: (value: string) => void, value: string) => {
    setter(value);
    if (clientId) {
      setClientId("");
    }
    if (clientFormError) {
      setClientFormError("");
    }
  };

  const applyClientSelection = (client: ClientOption) => {
    const displayName = getClientDisplayName(client);
    setClientId(client.id);
    setClientName(displayName);
    setClientDocument(client.document);
    setClientEmail(client.email);
    setClientPhone(client.phone);
    setClientAddress(client.address);
    setClientNeighborhood(client.neighborhood);
    setClientDepartment(client.department);
    setClientCity(client.city);
    setShowClientResults(false);
    setClientFormError("");
  };

  const goToProductsStep = () => {
    if (clientId) {
      setClientFormError("");
      setStep(2);
      return;
    }

    if (!isClientDraftComplete) {
      setClientFormError("Selecciona un cliente del buscador o completa todos los campos.");
      return;
    }

    startResolvingClient(async () => {
      const result = await adminResolveClientAction({
        name: clientName,
        document: clientDocument,
        email: clientEmail,
        phone: clientPhone,
        address: clientAddress,
        neighborhood: clientNeighborhood,
        department: clientDepartment,
        city: clientCity,
      });

      if (!result.ok) {
        setClientFormError(result.error);
        return;
      }

      setClientId(result.clientId);
      setClientFormError("");
      setStep(2);
    });
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
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-foreground md:text-xl">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>Cotizaciones</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Crea cotizaciones con cliente, productos y link compartible.
          </p>
        </div>
        <button
          type="button"
          onClick={openQuoteModal}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nueva cotizacion
        </button>
      </div>

      <QuotesDataTable quotes={quotes} currency={currency} />

      {openModal ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:items-start sm:p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Nueva cotizacion"
          onClick={() => setOpenModal(false)}
        >
          <div
            className="h-full w-full max-w-6xl overflow-y-auto overflow-x-hidden rounded-none border border-border bg-card p-3 sm:max-h-[92vh] sm:rounded-xl sm:p-4 md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>Nueva cotizacion</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              action={adminCreateQuoteAction}
              className="space-y-4"
              onSubmit={(event) => {
                if (step !== 3 || !isManualQuoteSubmit) {
                  event.preventDefault();
                  return;
                }
                setIsManualQuoteSubmit(false);
              }}
            >
              <input type="hidden" name="returnTo" value="/admin/cotizaciones" />
              <input type="hidden" name="items" value={serializedItems} />
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="name" value={clientName} />
              <input type="hidden" name="document" value={clientDocument} />
              <input type="hidden" name="email" value={clientEmail} />
              <input type="hidden" name="phone" value={clientPhone} />
              <input type="hidden" name="address" value={clientAddress} />
              <input type="hidden" name="neighborhood" value={clientNeighborhood} />
              <input type="hidden" name="department" value={clientDepartment} />
              <input type="hidden" name="city" value={clientCity} />

              <div>
                <div className="grid gap-1.5 md:grid-cols-3">
                  <div className={`rounded-lg border p-2 transition ${step >= 1 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
                    <div className="flex items-center gap-2">
                      <div className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${step === 1 ? "border-primary bg-primary text-primary-foreground" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                        <UserRound className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paso 1</p>
                        <p className="text-xs font-semibold text-foreground">Cliente</p>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-lg border p-2 transition ${step >= 2 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
                    <div className="flex items-center gap-2">
                      <div className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${step === 2 ? "border-primary bg-primary text-primary-foreground" : step > 2 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-card text-muted-foreground"}`}>
                        <Boxes className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paso 2</p>
                        <p className="text-xs font-semibold text-foreground">Productos</p>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-lg border p-2 transition ${step >= 3 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
                    <div className="flex items-center gap-2">
                      <div className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${step === 3 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
                        <Link2 className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paso 3</p>
                        <p className="text-xs font-semibold text-foreground">Generar</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full bg-primary transition-all duration-300 ${step === 1 ? "w-1/3" : step === 2 ? "w-2/3" : "w-full"}`}
                  />
                </div>
              </div>

              {step === 1 ? (
                <div className="space-y-4 rounded-xl border border-border p-3">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="relative block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Nombre y apellido</span>
                        <Input
                          value={clientName}
                          onChange={(event) => handleClientInputChange(setClientName, event.target.value)}
                          onFocus={() => setShowClientResults(true)}
                          onBlur={() => {
                            setTimeout(() => setShowClientResults(false), 120);
                          }}
                          placeholder="Ej: Ana Perez"
                        />

                        {showClientResults ? (
                          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                            <p className="px-3 py-2 text-xs text-muted-foreground">Clientes</p>
                            <div className="max-h-52 overflow-y-auto p-1.5">
                              {filteredClients.length > 0 ? (
                                filteredClients.map((client) => (
                                  <button
                                    key={client.id}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => applyClientSelection(client)}
                                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-muted"
                                  >
                                    <span className="inline-flex items-center gap-2 text-foreground">
                                      <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                                      {getClientDisplayName(client)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{client.phone || "Sin telefono"}</span>
                                  </button>
                                ))
                              ) : (
                                <p className="px-2.5 py-2 text-xs text-muted-foreground">Sin resultados. Completa los campos para crear cliente.</p>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Nit o cedula</span>
                        <Input
                          value={clientDocument}
                          onChange={(event) => handleClientInputChange(setClientDocument, event.target.value)}
                          placeholder="Ej: 123456789"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Correo Electronico</span>
                        <Input
                          type="email"
                          value={clientEmail}
                          onChange={(event) => handleClientInputChange(setClientEmail, event.target.value)}
                          placeholder="cliente@correo.com"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Telefono</span>
                        <Input
                          value={clientPhone}
                          onChange={(event) => handleClientInputChange(setClientPhone, event.target.value)}
                          placeholder="Ej: 3001234567"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Direccion</span>
                        <Input
                          value={clientAddress}
                          onChange={(event) => handleClientInputChange(setClientAddress, event.target.value)}
                          placeholder="Calle 00 # 00 - 00"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Barrio</span>
                        <Input
                          value={clientNeighborhood}
                          onChange={(event) => handleClientInputChange(setClientNeighborhood, event.target.value)}
                          placeholder="Barrio"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Departamento</span>
                        <Input
                          value={clientDepartment}
                          onChange={(event) => handleClientInputChange(setClientDepartment, event.target.value)}
                          placeholder="Departamento"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Ciudad</span>
                        <Input
                          value={clientCity}
                          onChange={(event) => handleClientInputChange(setClientCity, event.target.value)}
                          placeholder="Ciudad"
                        />
                      </label>
                    </div>
                  </div>

                  {clientFormError ? <p className="text-xs font-medium text-destructive">{clientFormError}</p> : null}

                  <button
                    type="button"
                    onClick={goToProductsStep}
                    disabled={!isClientResolved || isResolvingClient}
                    className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResolvingClient ? "Guardando cliente..." : "Siguiente"}
                  </button>
                </div>
              ) : step === 2 ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Imagen</th>
                          <th className="px-3 py-2 text-left">Codigo</th>
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
                        {linesWithMeta.length === 0 ? (
                          <tr>
                              <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                              <div className="flex flex-col items-center gap-3">
                                <div className="rounded-full border border-border bg-muted p-2">
                                  <Boxes className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <p>No hay productos agregados.</p>
                                <button
                                  type="button"
                                  onClick={openAddProductModal}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                                >
                                  <Plus className="h-4 w-4" />
                                  Agregar producto
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          linesWithMeta.map(({ line, product, lineTotal }) => (
                            <tr key={line.uid} className="border-t border-border bg-card transition hover:bg-muted/50">
                              <td className="px-3 py-2">
                                {product?.thumbnailUrl ? (
                                  <img
                                    src={product.thumbnailUrl}
                                    alt={product.name}
                                    className="h-11 w-11 rounded-md border border-border object-cover"
                                  />
                                ) : (
                                  <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
                                    Sin img
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-foreground">{product?.code || "-"}</td>
                              <td className="px-3 py-2 text-foreground">{product?.name || "Producto"}</td>
                              <td className="px-3 py-2 text-foreground">{line.description || "-"}</td>
                              <td className="px-3 py-2 text-foreground">{line.quantity}</td>
                              <td className="px-3 py-2 text-foreground">{line.color || "-"}</td>
                              <td className="px-3 py-2 text-foreground">
                                {line.unitPrice.toLocaleString("es-CO", { style: "currency", currency })}
                              </td>
                              <td className="px-3 py-2 font-semibold text-foreground">
                                {lineTotal.toLocaleString("es-CO", { style: "currency", currency })}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => removeLine(line.uid)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-destructive/30 text-destructive transition hover:bg-destructive/10"
                                  aria-label="Quitar producto"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {linesWithMeta.length > 0 ? (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={openAddProductModal}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                      >
                        <Plus className="h-4 w-4" />
                        Agregar producto
                      </button>
                    </div>
                  ) : null}

                  <div className="grid gap-2 rounded-xl border bg-muted p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-border bg-card/80 px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Subtotal</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteSubtotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/80 px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Descuento</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteDiscountTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/80 px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Valor adicional</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteAdditionalCostTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/80 px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Total</span>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {quoteTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-muted"
                    >
                      Atras
                    </button>
                     <button
                       type="button"
                       onClick={() => {
                         setIsManualQuoteSubmit(false);
                         setStep(3);
                       }}
                        className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 sm:w-auto"
                        disabled={lines.length === 0}
                      >
                       Siguiente
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-sm font-semibold text-foreground">Datos del cliente</p>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Nombre</p>
                        <p className="font-medium text-foreground">{clientId ? selectedClient?.name ?? clientName : clientName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">NIT</p>
                        <p className="font-medium text-foreground">{clientDocument || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Correo</p>
                        <p className="font-medium text-foreground">{clientEmail || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Telefono</p>
                        <p className="font-medium text-foreground">{clientPhone || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Direccion</p>
                        <p className="font-medium text-foreground">{clientAddress || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Barrio</p>
                        <p className="font-medium text-foreground">{clientNeighborhood || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Departamento</p>
                        <p className="font-medium text-foreground">{clientDepartment || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Ciudad</p>
                        <p className="font-medium text-foreground">{clientCity || "-"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="border-b border-border bg-muted px-3 py-2">
                      <p className="text-sm font-semibold text-foreground">Productos</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Imagen</th>
                          <th className="px-3 py-2 text-left">Codigo</th>
                          <th className="px-3 py-2 text-left">Producto</th>
                          <th className="px-3 py-2 text-left">Descripcion</th>
                          <th className="px-3 py-2 text-left">Cant</th>
                          <th className="px-3 py-2 text-left">Color</th>
                          <th className="px-3 py-2 text-left">Precio</th>
                          <th className="px-3 py-2 text-left">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linesWithMeta.map(({ line, product, lineTotal }) => (
                          <tr key={line.uid} className="border-t border-border">
                            <td className="px-3 py-2">
                              {product?.thumbnailUrl ? (
                                <img
                                  src={product.thumbnailUrl}
                                  alt={product.name}
                                  className="h-10 w-10 rounded-md border border-border object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
                                  Sin img
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-foreground">{product?.code || "-"}</td>
                            <td className="px-3 py-2 text-foreground">{product?.name || "Producto"}</td>
                            <td className="px-3 py-2 text-foreground">{line.description || "-"}</td>
                            <td className="px-3 py-2 text-foreground">{line.quantity}</td>
                            <td className="px-3 py-2 text-foreground">{line.color || "-"}</td>
                            <td className="px-3 py-2 text-foreground">
                              {line.unitPrice.toLocaleString("es-CO", { style: "currency", currency })}
                            </td>
                            <td className="px-3 py-2 font-semibold text-foreground">
                              {lineTotal.toLocaleString("es-CO", { style: "currency", currency })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-2 rounded-lg border border-border bg-muted p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-border bg-card px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Subtotal</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteSubtotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Descuento</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteDiscountTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Valor adicional</span>
                      <p className="mt-1 text-lg font-medium text-foreground">
                        {quoteAdditionalCostTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card px-3 py-2">
                      <span className="text-sm font-medium text-foreground">Total</span>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {quoteTotal.toLocaleString("es-CO", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-muted"
                    >
                      Atras
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        setIsManualQuoteSubmit(true);
                        event.currentTarget.form?.requestSubmit();
                      }}
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 sm:w-auto"
                      disabled={!isClientResolved || lines.length === 0}
                    >
                      Generar cotizacion
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      ) : null}

      {openProductModal ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Agregar producto"
          onClick={() => setOpenProductModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <span>Agregar producto</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Selecciona un item, ajusta precio y agrega descripcion.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenProductModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                aria-label="Cerrar modal de producto"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/70 p-3 md:grid-cols-2">
              <label className="relative space-y-1.5">
                <span className="text-sm font-medium text-foreground">Codigo</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productLookup}
                    onChange={(event) => {
                      setProductLookup(event.target.value);
                      setShowProductResults(true);
                      setDraftProductId("");
                      setProductFormError("");
                    }}
                    onFocus={() => setShowProductResults(true)}
                    onBlur={() => setTimeout(() => setShowProductResults(false), 120)}
                    className="pl-9"
                    placeholder="Buscar codigo o producto"
                  />
                </div>

                {showProductResults ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                    <p className="px-3 py-2 text-xs text-muted-foreground">Productos</p>
                    <div className="max-h-52 overflow-y-auto p-1.5">
                      {filteredProducts.length > 0 ? (
                        filteredProducts.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyProductSelection(product)}
                            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-muted"
                          >
                            <span className="font-medium text-foreground">{product.code || "Sin codigo"}</span>
                            <span className="truncate pl-2 text-xs text-muted-foreground">{product.name}</span>
                          </button>
                        ))
                      ) : (
                        <p className="px-2.5 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Producto</span>
                <Input value={draftProduct?.name || ""} readOnly placeholder="Selecciona codigo" />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Cantidad</span>
                <Input
                  type="number"
                  min={1}
                  value={draftQuantity}
                  onChange={(event) => setDraftQuantity(event.target.value)}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Color</span>
                <Input value={draftColor} onChange={(event) => setDraftColor(event.target.value)} placeholder="Color" />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Precio</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draftUnitPrice}
                  onChange={(event) => setDraftUnitPrice(event.target.value)}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Costo adicional</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draftAdditionalCost}
                  onChange={(event) => setDraftAdditionalCost(event.target.value)}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Descuento</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draftDiscount}
                  onChange={(event) => setDraftDiscount(event.target.value)}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Total</span>
                <Input value={draftLineTotal.toLocaleString("es-CO", { style: "currency", currency })} readOnly />
              </label>

              <div className="grid gap-3 rounded-xl border border-border bg-card p-3 md:col-span-2 md:grid-cols-[7.5rem_minmax(0,1fr)] md:items-start">
                <div className="flex items-start justify-start">
                  {draftProduct?.thumbnailUrl ? (
                    <img
                      src={draftProduct.thumbnailUrl}
                      alt={draftProduct.name}
                      className="h-28 w-28 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-border bg-muted text-[11px] text-muted-foreground">
                      Sin imagen
                    </div>
                  )}
                </div>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Descripcion</span>
                  <textarea
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
                    placeholder="Descripcion del item"
                  />
                </label>
              </div>
            </div>

            {productFormError ? (
              <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                {productFormError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpenProductModal(false)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={addDraftProduct}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Agregar producto
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
