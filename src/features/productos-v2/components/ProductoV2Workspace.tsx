"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Banknote,
  BookOpen,
  ChevronRight,
  FileText,
  MessageCircleQuestion,
  Package,
  Plus,
  ShoppingCart,
  Split,
  Tag,
} from "lucide-react";

import { useSetBreadcrumbLabel } from "@/components/breadcrumb-label-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import type { ProductoV2Item } from "../types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductBasicsForm } from "./ProductBasicsForm";
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
  /**
   * Que se esta viendo sale de la DIRECCION, no de un estado del componente.
   *
   * Con el estado en memoria, tocar "Producto V2" en el menu no volvia a la lista —la ruta no
   * cambia, el componente no se vuelve a montar— y sin el boton de atras se quedaba uno
   * encerrado en el producto. En la direccion tambien funciona el boton del celular y el enlace
   * a un producto se puede guardar.
   */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const productoEnLaUrl = searchParams.get("producto")?.trim() || "";

  const view: View =
    productoEnLaUrl === "nuevo"
      ? { mode: "editor", productId: null }
      : productoEnLaUrl
        ? { mode: "editor", productId: productoEnLaUrl }
        : { mode: "list" };

  const setView = (siguiente: View) => {
    if (siguiente.mode === "list") {
      router.push(pathname);
      return;
    }
    router.push(`${pathname}?producto=${siguiente.productId ?? "nuevo"}`);
  };

  const selected =
    view.mode === "editor" && view.productId
      ? products.find((product) => product.id === view.productId) ?? null
      : null;
  const isNew = view.mode === "editor" && view.productId === null;

  /**
   * El nombre del producto va en la barra de la app, no en la pagina.
   *
   * Abajo ya esta el campo "Nombre" con lo mismo escrito, y en las otras tres pestañas ese campo
   * no se ve: sin esto, estando en Embudo u Objeciones no habria forma de saber de que producto
   * es lo que se esta editando.
   */
  useSetBreadcrumbLabel(
    view.mode === "editor" ? (isNew ? "Nuevo producto" : selected?.name ?? "Producto") : null,
  );

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
                  // min-w-0: un elemento de grilla NO se achica por debajo de su contenido salvo
                  // que se lo permitas. "Combo Lavacabezas+Silla Neumatica" no tiene espacios
                  // alrededor del "+", asi que cuenta como una palabra larguisima: estiraba la
                  // tarjeta mas alla de la pantalla y el truncate de adentro nunca llegaba a
                  // actuar, porque ya habia lugar de sobra.
                  className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 transition hover:bg-muted"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {product.sells ? <ShoppingCart className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{product.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={product.sells ? "default" : "secondary"} className="font-normal">
                        {product.sells ? "Vende" : "Catálogo"}
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
      {/*
        Nombre y precio juntos y nada mas. Antes esto eran TRES tarjetas —Identidad, Tipo y
        Precio— para dos datos: la "palabra distintiva" sale sola del nombre y el "tipo"
        (vende / solo catalogo) sale solo de si hay precio. Eran la misma informacion escrita
        de tres formas, y empujaban el playbook —lo unico que se edita— hasta el fondo.
      */}
      {/*
        Cuatro pestañas y no una pagina larga: el producto casi no se toca, el embudo cada tanto y
        las objeciones todo el tiempo.

        Solo icono y nombre: los contadores (5/5, 1, 2) eran tres numeros distintos con tres
        significados distintos en la misma fila, y para leerlos habia que acordarse de cual era
        cual.

        OJO con el estado activo: este componente lo marca con `data-active`, NO con
        `data-selected`. Escrito mal, la pastilla no se pinta y no falla nada —simplemente no pasa
        nada—. Y sin `variant="line"` a proposito: esa variante fuerza fondo transparente en la
        activa y le agrega un subrayado, o sea pelea contra el relleno.
      */}
      <Tabs defaultValue="producto">
        {/*
          En el celular las cuatro pestañas van en rejilla de 2x2.

          Antes la fila se deslizaba de lado: las cuatro con sus numeros no entran en 360px, asi
          que SIEMPRE se veian palabras cortadas por la mitad en los dos bordes ("...ducto",
          "Objec...") y nada indicaba que hubiera mas. Deslizar arregla el desborde pero no la
          lectura. En dos filas entran completas, sin cortar y sin deslizar.

          En escritorio siguen en una sola fila, que ahi sobra ancho.
        */}
        {/* Sin boton de atras: se vuelve desde "Producto V2" en el menu o con el boton del
            celular, porque la vista ahora vive en la direccion. */}
        <div className="flex items-center">
        {/* Control segmentado: caja gris con la pestaña activa en blanco. Es el estilo que ya
            trae el componente; las pastillas azules con contorno gritaban mas que el contenido
            de la pantalla. */}
        <TabsList
          // La barra de desplazamiento se oculta: la fila se desliza igual con el dedo, y una
          // barra gris debajo de las pestañas se lee como si algo estuviera cortado.
          className="w-full max-w-full justify-start overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsTrigger value="producto" className="shrink-0 whitespace-nowrap px-3 data-active:bg-background data-active:text-foreground">
            <ShoppingCart className="size-4" />
            Producto
          </TabsTrigger>
          <TabsTrigger value="embudo" className="shrink-0 whitespace-nowrap px-3 data-active:bg-background data-active:text-foreground">
            <Split className="size-4" />
            Embudo
          </TabsTrigger>
          <TabsTrigger value="playbook" className="shrink-0 whitespace-nowrap px-3 data-active:bg-background data-active:text-foreground">
            <BookOpen className="size-4" />
            Playbook
          </TabsTrigger>
          <TabsTrigger value="objeciones" className="shrink-0 whitespace-nowrap px-3 data-active:bg-background data-active:text-foreground">
            <MessageCircleQuestion className="size-4" />
            Objeciones
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="producto" className="pt-4 space-y-4">
          <ProductBasicsForm
            productId={selected?.id ?? ""}
            name={selected?.name ?? ""}
            description={selected?.description ?? ""}
            price={selected?.price ?? null}
            sells={Boolean(selected?.sells)}
          />

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
                resumen={
                  selected.insights ?? {
                    leidas: 0,
                    pendientes: 0,
                    porMotivo: [],
                    porUltimaFrase: [],
                    ejemplos: [],
                  }
                }
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
