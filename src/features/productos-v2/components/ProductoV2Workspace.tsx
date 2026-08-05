"use client";

import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FileText,
  MessageCircleQuestion,
  Plus,
  ShoppingCart,
  Split,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { ProductoV2Item } from "../types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductFunnelEditor } from "./ProductFunnelEditor";
import { ProductInsightsCard } from "./ProductInsightsCard";
import { ProductMatchForm } from "./ProductMatchForm";
import { ProductObjectionsEditor } from "./ProductObjectionsEditor";
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

  const etapasEscritas = (selected?.funnelStages ?? []).filter(
    (etapa) => etapa.goal || etapa.script,
  ).length;
  const reglasPlaybook = (selected?.playbookRules ?? []).filter(
    (regla) => regla.kind !== "OBJECION",
  ).length;
  const objeciones = (selected?.playbookRules ?? []).filter((regla) => regla.kind === "OBJECION").length;

  if (view.mode === "list") {
    return (
      <div className="space-y-4 p-4 sm:p-6">
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
                      {reglas > 0 || product.playbookIdealCustomer || product.playbookCustomerPain ? (
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
    <div className="space-y-4 p-4 sm:p-6">
      {/* Volver y nombre en la misma linea: la palabra "Productos" arriba del titulo era un
          renglon entero para decir lo que la flecha ya dice. */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-2 h-8 w-8 shrink-0"
          aria-label="Volver a productos"
          title="Volver a productos"
          onClick={() => setView({ mode: "list" })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader icon={ShoppingCart} title={isNew ? "Nuevo producto" : selected?.name ?? "Producto"} />
      </div>

      {/*
        Nombre y precio juntos y nada mas. Antes esto eran TRES tarjetas —Identidad, Tipo y
        Precio— para dos datos: la "palabra distintiva" sale sola del nombre y el "tipo"
        (vende / solo catalogo) sale solo de si hay precio. Eran la misma informacion escrita
        de tres formas, y empujaban el playbook —lo unico que se edita— hasta el fondo.
      */}
      {/*
        Cuatro pestañas y no una pagina larga: el producto casi no se toca, el embudo cada tanto y
        las objeciones todo el tiempo. Cada una lleva su numero porque con pestañas lo que no se
        ve deja de existir, y "sin escribir" es justo lo que hay que ver.
      */}
      <Tabs defaultValue="embudo">
        <TabsList variant="line">
          <TabsTrigger value="producto">
            <ShoppingCart className="size-4" />
            Producto
          </TabsTrigger>
          <TabsTrigger value="embudo">
            <Split className="size-4" />
            Embudo
            <span className={etapasEscritas === 5 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
              {etapasEscritas}/5
            </span>
          </TabsTrigger>
          <TabsTrigger value="playbook">
            <BookOpen className="size-4" />
            Playbook
            {reglasPlaybook > 0 ? (
              <span className="text-muted-foreground">{reglasPlaybook}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="objeciones">
            <MessageCircleQuestion className="size-4" />
            Objeciones
            {objeciones > 0 ? <span className="text-muted-foreground">{objeciones}</span> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="producto" className="pt-4 space-y-4">
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

              {/* Vende / Solo catalogo: en fila tambien en el celular, porque son dos palabras. */}
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
            <ProductMatchForm
              productId={selected.id}
              keywords={selected.matchKeywords}
              adTitles={selected.matchAdTitles}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="embudo" className="pt-4">
          {selected ? (
            <div className="space-y-4">
              <ProductFunnelEditor
                productId={selected.id}
                stages={selected.funnelStages}
                vienenDelAgente={selected.funnelFromAgent}
                avance={selected.leadProgress}
              />
              <ProductInsightsCard
                productId={selected.id}
                resumen={selected.insights ?? { leidas: 0, pendientes: 0, porMotivo: [], ejemplos: [] }}
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="playbook" className="pt-4">
          {selected ? (
            <ProductPlaybookEditor
              productId={selected.id}
              idealCustomer={selected.playbookIdealCustomer}
              customerPain={selected.playbookCustomerPain}
              rules={selected.playbookRules}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="objeciones" className="pt-4">
          {selected ? (
            <ProductObjectionsEditor productId={selected.id} rules={selected.playbookRules} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
