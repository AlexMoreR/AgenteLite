"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Plus, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { ProductoV2Item } from "../types";
import { ProductFunnelEditor } from "./ProductFunnelEditor";
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
export function ProductoV2Workspace({ products }: { products: ProductoV2Item[] }) {
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
              const etapas = product.funnelStages.filter((etapa) => etapa.goal || etapa.script).length;
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
                      {/* Embudo y playbook: las dos cosas que hay que mantener vivas. */}
                      {etapas > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          embudo · {etapas}/5
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">sin embudo</span>
                      )}
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

      {/*
        Nombre y precio juntos y nada mas. Antes esto eran TRES tarjetas —Identidad, Tipo y
        Precio— para dos datos: la "palabra distintiva" sale sola del nombre y el "tipo"
        (vende / solo catalogo) sale solo de si hay precio. Eran la misma informacion escrita
        de tres formas, y empujaban el playbook —lo unico que se edita— hasta el fondo.
      */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Nombre del producto y precio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-1.5">
              <Label htmlFor="pv2-nombre">Nombre</Label>
              <Input id="pv2-nombre" value={selected?.name ?? ""} placeholder="Ej. Combo de camillas" readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv2-precio">Precio</Label>
              <Input
                id="pv2-precio"
                value={selected?.sells ? formatPrice(selected.price) : ""}
                placeholder="Sin precio"
                readOnly
              />
            </div>
          </div>

          {/* Vende / Solo catalogo: en fila tambien en el celular, porque son dos palabras.
              Apiladas ocupaban media pantalla para decir una sola cosa. */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { activo: Boolean(selected?.sells), titulo: "Vende", icono: ShoppingCart },
                { activo: Boolean(selected && !selected.sells), titulo: "Solo catálogo", icono: FileText },
              ].map((opcion) => (
                <div
                  key={opcion.titulo}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    opcion.activo
                      ? "border-primary bg-primary/5 font-medium text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <opcion.icono className="h-4 w-4 shrink-0" />
                  <span className="truncate">{opcion.titulo}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <ProductFunnelEditor
          productId={selected.id}
          stages={selected.funnelStages}
          vienenDelAgente={selected.funnelFromAgent}
        />
      ) : null}

      {selected ? (
        <ProductPlaybookEditor
          productId={selected.id}
          idealCustomer={selected.playbookIdealCustomer}
          customerPain={selected.playbookCustomerPain}
          pitch={selected.playbookPitch}
          rules={selected.playbookRules}
        />
      ) : null}
    </div>
  );
}
