"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Paperclip, Plus, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { ProductoV2Flow, ProductoV2Item } from "../types";
import { ProductPlaybookEditor } from "./ProductPlaybookEditor";

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "";
  return `$ ${price.toLocaleString("es-CO")}`;
}

type View = { mode: "list" } | { mode: "editor"; productId: string | null };

/**
 * Producto V2: cada producto como contenedor de su venta —flujos, precio y playbook.
 *
 * De todo lo que se ve aca, el PLAYBOOK es lo unico que ya guarda. El resto (nombre, tipo,
 * flujos, precio) todavia se lee de lo que existe y se muestra en solo lectura; por eso cada
 * seccion dice si se puede tocar o no, en vez de aparentar que si y no guardar nada.
 */
export function ProductoV2Workspace({
  products,
  allFlows,
}: {
  products: ProductoV2Item[];
  allFlows: ProductoV2Flow[];
}) {
  const [view, setView] = useState<View>({ mode: "list" });

  const selected =
    view.mode === "editor" && view.productId
      ? products.find((product) => product.id === view.productId) ?? null
      : null;
  const isNew = view.mode === "editor" && view.productId === null;

  if (view.mode === "list") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PageHeader icon={ShoppingCart} title="Productos" />
            <Badge variant="secondary">{products.length}</Badge>
          </div>
          <Button type="button" size="sm" onClick={() => setView({ mode: "editor", productId: null })}>
            <Plus className="h-4 w-4" />
            Nuevo producto
          </Button>
        </div>

        {products.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Todavía no hay productos.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {products.map((product) => {
              const reglas = product.playbookRules.length;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setView({ mode: "editor", productId: product.id })}
                  className="flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 transition hover:bg-muted"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {product.sells ? <ShoppingCart className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{product.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={product.sells ? "default" : "secondary"} className="font-normal">
                        {product.sells ? "Vende" : "Solo catálogo"}
                      </Badge>
                      {product.price ? (
                        <span className="tabular-nums text-foreground">{formatPrice(product.price)}</span>
                      ) : null}
                      {product.anchoredFlowTitle ? (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Paperclip className="h-3 w-3 shrink-0" />
                          {product.anchoredFlowTitle}
                        </span>
                      ) : (
                        <span className="truncate">sin flujo anclado</span>
                      )}
                      {/* El playbook a la vista desde la lista: es lo que hay que mantener vivo. */}
                      {reglas > 0 || product.playbookPitch ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          playbook{reglas > 0 ? ` · ${reglas} ${reglas === 1 ? "regla" : "reglas"}` : ""}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">sin playbook</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setView({ mode: "list" })}>
        <ArrowLeft className="h-4 w-4" />
        Productos
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <PageHeader icon={ShoppingCart} title={isNew ? "Nuevo producto" : selected?.name ?? "Producto"} />
      </div>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Identidad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pv2-nombre">Nombre del producto</Label>
            <Input id="pv2-nombre" value={selected?.name ?? ""} placeholder="Ej. Combo de camillas" readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>Palabra distintiva</Label>
            <p className="-mt-1 text-xs text-muted-foreground">
              La usa el candado para no confundir este producto con otro.
            </p>
            {selected ? (
              <Badge variant="secondary" className="font-mono font-normal">
                #{selected.distinctiveWord}
              </Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Se saca sola del nombre al escribirlo.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Tipo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {[
            {
              activo: Boolean(selected?.sells),
              titulo: "Vende",
              detalle: "Tiene precio y cierre. Es lo que se ancla desde el anuncio.",
              icono: ShoppingCart,
            },
            {
              activo: Boolean(selected && !selected.sells),
              titulo: "Solo catálogo",
              detalle: "Solo muestra opciones, sin precio.",
              icono: FileText,
            },
          ].map((opcion) => (
            <div
              key={opcion.titulo}
              className={`rounded-lg border p-3 ${
                opcion.activo ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <opcion.icono className="h-4 w-4" />
                {opcion.titulo}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{opcion.detalle}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Flujos anclados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {selected?.anchoredFlowTitle ? (
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{selected.anchoredFlowTitle}</p>
                <p className="text-xs text-muted-foreground">se ejecuta cuando el cliente lo pide</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no hay un flujo anclado.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Hay {allFlows.length} flujos disponibles para anclar. Un mismo flujo se puede anclar a
            varios productos.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Precio y cierre</CardTitle>
        </CardHeader>
        <CardContent>
          {selected?.sells ? (
            <div className="space-y-1.5">
              <Label htmlFor="pv2-precio">Precio</Label>
              <Input id="pv2-precio" value={formatPrice(selected.price)} readOnly />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {selected ? "Este producto es «solo catálogo»: no tiene precio." : "Solo si el producto vende."}
            </p>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <ProductPlaybookEditor
          productId={selected.id}
          productName={selected.name}
          idealCustomer={selected.playbookIdealCustomer}
          pitch={selected.playbookPitch}
          rules={selected.playbookRules}
        />
      ) : null}
    </div>
  );
}
