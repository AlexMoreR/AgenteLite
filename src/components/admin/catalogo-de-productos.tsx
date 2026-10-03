"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, GitBranch, ImageOff, Lock, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FiltroDeNegocio } from "@/components/admin/selector-de-negocio";
import { guardarDescripcionDeVentaAction, sincronizarCatalogoAction } from "@/app/actions/catalogo-actions";
import { formatMoney, type SupportedCurrencyCode } from "@/lib/currency";
import type { NegocioDelAdmin } from "@/lib/negocios-del-admin";
import type { ResumenDeSincronizacion } from "@/lib/sincronizacion-gestion";

export type ProductoDelCatalogo = {
  id: string;
  nombre: string;
  codigo: string | null;
  negocio: string;
  categoria: string | null;
  precio: number;
  precioMayorista: number;
  cantidadMinimaMayorista: number;
  descripcion: string;
  /** Solo las que cargan: las rotas se descartan al sincronizar. */
  fotos: string[];
  origen: "GESTION" | "MANUAL";
  activo: boolean;
  estadoEnGestion: string | null;
  pasos: Array<{ etiqueta: string; objetivo: string | null; seguimientos: string[] }>;
};

/** Con menos que esto la descripción no le alcanza al agente para contestar material y medidas. */
const LARGO_MINIMO_DE_LA_DESCRIPCION = 40;

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

type Estado = "activos" | "inactivos" | "todos";

function tieneDescripcion(producto: ProductoDelCatalogo) {
  return producto.descripcion.trim().length >= LARGO_MINIMO_DE_LA_DESCRIPCION;
}

function textoDelEstado(producto: ProductoDelCatalogo) {
  if (producto.origen === "MANUAL") {
    return "Manual (no viene de Gestión)";
  }
  if (producto.estadoEnGestion === "oculto") return "Oculto en Gestión";
  if (producto.estadoEnGestion === "no_existe") return "Ya no existe en Gestión";
  return "Activo en Gestión";
}

/**
 * Una foto que no carga no se muestra. Las de Gestión ya llegan revisadas, pero una puede romperse
 * entre una sincronización y otra: si falla, desaparece en vez de dejar el ícono roto.
 */
function Foto({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [rota, setRota] = useState(false);
  if (rota) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} loading="lazy" onError={() => setRota(true)} />
  );
}

function Miniatura({ producto }: { producto: ProductoDelCatalogo }) {
  const [rota, setRota] = useState(false);
  const foto = producto.fotos[0];
  if (!foto || rota) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <ImageOff className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={foto}
      alt=""
      loading="lazy"
      onError={() => setRota(true)}
      className="size-10 shrink-0 rounded-lg border border-border bg-muted object-cover"
    />
  );
}

export function CatalogoDeProductos({
  productos,
  negocios,
  negocioFiltrado,
  currency,
  conectadoAGestion,
  ultimaSincronizacion,
  crearEnGestionHref,
}: {
  productos: ProductoDelCatalogo[];
  negocios: NegocioDelAdmin[];
  negocioFiltrado: string | null;
  currency: SupportedCurrencyCode;
  conectadoAGestion: boolean;
  ultimaSincronizacion: ResumenDeSincronizacion | null;
  crearEnGestionHref: string;
}) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState("");
  const [estado, setEstado] = useState<Estado>("activos");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [sincronizando, startSincronizar] = useTransition();

  const categorias = useMemo(
    () => [...new Set(productos.map((producto) => producto.categoria).filter((c): c is string => Boolean(c)))].sort(),
    [productos],
  );

  const visibles = useMemo(() => {
    const termino = buscar.trim().toLowerCase();
    return productos.filter((producto) => {
      if (estado === "activos" && !producto.activo) return false;
      if (estado === "inactivos" && producto.activo) return false;
      if (categoria && producto.categoria !== categoria) return false;
      if (!termino) return true;
      return producto.nombre.toLowerCase().includes(termino) || (producto.codigo ?? "").toLowerCase().includes(termino);
    });
  }, [productos, buscar, categoria, estado]);

  const sinDescripcion = visibles.filter((producto) => !tieneDescripcion(producto)).length;
  const sinFoto = visibles.filter((producto) => producto.fotos.length === 0).length;
  const activo = productos.find((producto) => producto.id === seleccionado) ?? null;
  const variosNegocios = negocios.length > 1;

  const sincronizar = () => {
    if (!negocioFiltrado) {
      toast.error("Elige el negocio que quieres sincronizar.");
      return;
    }
    startSincronizar(async () => {
      const resultado = await sincronizarCatalogoAction({ workspaceId: negocioFiltrado }).catch(() => ({
        error: "No se pudo sincronizar",
      }));
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      const { creados, actualizados, inactivados, imagenesDescartadas } = resultado.resumen;
      toast.success(
        `Sincronizado: ${actualizados} actualizados, ${creados} nuevos, ${inactivados} inactivos` +
          (imagenesDescartadas ? `, ${imagenesDescartadas} fotos que no cargan descartadas` : ""),
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Sin título: la barra de arriba ya dice "Admin > Productos" y se leía dos veces. */}
        <div className="space-y-1.5">
          {conectadoAGestion ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                ultimaSincronizacion?.error
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              }`}
              title={ultimaSincronizacion?.error ?? undefined}
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              {ultimaSincronizacion
                ? ultimaSincronizacion.error
                  ? `No se pudo sincronizar (${CUANDO.format(new Date(ultimaSincronizacion.en))})`
                  : `Sincronizado desde Gestión · ${CUANDO.format(new Date(ultimaSincronizacion.en))}`
                : "Conectado a Gestión · todavía sin sincronizar"}
            </span>
          ) : negocioFiltrado ? (
            <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Este negocio no está conectado a Gestión
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {variosNegocios ? <FiltroDeNegocio negocios={negocios} seleccionado={negocioFiltrado} /> : null}
          <Button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando || !conectadoAGestion || !negocioFiltrado}
            className="gap-1.5"
          >
            <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} aria-hidden="true" />
            {sincronizando ? "Sincronizando…" : "Sincronizar con Gestión"}
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.open(crearEnGestionHref, "_blank", "noopener")}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Crear producto en Gestión
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={buscar}
            onChange={(evento) => setBuscar(evento.target.value)}
            placeholder="Buscar por nombre o código"
            className="h-9 pl-8"
            aria-label="Buscar productos"
          />
        </div>
        <NativeSelect value={categoria} onChange={(evento) => setCategoria(evento.target.value)} className="h-9 sm:w-56" aria-label="Categoría">
          <NativeSelectOption value="">Todas las categorías</NativeSelectOption>
          {categorias.map((nombre) => (
            <NativeSelectOption key={nombre} value={nombre}>
              {nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect value={estado} onChange={(evento) => setEstado(evento.target.value as Estado)} className="h-9 sm:w-52" aria-label="Estado">
          <NativeSelectOption value="activos">Activos</NativeSelectOption>
          <NativeSelectOption value="inactivos">Inactivos en Gestión</NativeSelectOption>
          <NativeSelectOption value="todos">Todos</NativeSelectOption>
        </NativeSelect>
      </div>

      {/* Contadores */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span>
          <b className="tabular-nums text-foreground">{visibles.length}</b> productos
        </span>
        <span>
          <b className={`tabular-nums ${sinDescripcion ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>{sinDescripcion}</b> sin
          descripción para el agente
        </span>
        <span>
          <b className={`tabular-nums ${sinFoto ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>{sinFoto}</b> sin foto
        </span>
      </div>

      {/* Tabla + panel. En el celular el panel baja debajo y la tabla se desliza de lado. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 text-right font-medium">Precio detal</th>
                <th className="px-3 py-2 text-right font-medium">Mayorista</th>
                <th className="px-3 py-2 font-medium">Agente</th>
                <th className="px-3 py-2 font-medium">Embudo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No hay productos con esos filtros.
                  </td>
                </tr>
              ) : (
                visibles.map((producto) => {
                  const marcado = producto.id === seleccionado;
                  return (
                    <tr
                      key={producto.id}
                      onClick={() => setSeleccionado(marcado ? null : producto.id)}
                      className={`cursor-pointer border-b border-border/60 transition last:border-0 ${
                        marcado
                          ? "bg-sky-50 shadow-[inset_3px_0_0_0_rgb(14,165,233)] dark:bg-sky-500/10"
                          : "hover:bg-muted/50"
                      } ${producto.activo ? "" : "opacity-60"}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <Miniatura producto={producto} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{producto.nombre}</p>
                            <p className="truncate text-xs tabular-nums text-muted-foreground">
                              {producto.codigo ?? "Sin código"}
                              {variosNegocios && !negocioFiltrado ? ` · ${producto.negocio}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{producto.categoria ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(producto.precio, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {producto.precioMayorista > 0 ? formatMoney(producto.precioMayorista, currency) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {tieneDescripcion(producto) ? (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                            Listo
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                            Falta descripción
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {producto.pasos.length > 0
                          ? `${producto.pasos.length} ${producto.pasos.length === 1 ? "paso" : "pasos"} · ${producto.activo ? "activo" : "inactivo"}`
                          : "Sin embudo"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {activo ? (
          <PanelDelProducto
            key={activo.id}
            producto={activo}
            currency={currency}
            onCerrar={() => setSeleccionado(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PanelDelProducto({
  producto,
  currency,
  onCerrar,
}: {
  producto: ProductoDelCatalogo;
  currency: SupportedCurrencyCode;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState(producto.descripcion);
  const [guardando, startGuardar] = useTransition();
  const cambio = descripcion.trim() !== producto.descripcion.trim();

  // Si la página se refresca con datos nuevos y no hay cambios sin guardar, se toma lo nuevo.
  useEffect(() => {
    if (!cambio) setDescripcion(producto.descripcion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.descripcion]);

  const guardar = () => {
    startGuardar(async () => {
      const resultado = await guardarDescripcionDeVentaAction({ productId: producto.id, descripcion }).catch(() => ({
        error: "No se pudo guardar",
      }));
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Cambios guardados");
      router.refresh();
    });
  };

  const embudoHref = `/cliente/productos-v2/embudo?producto=${encodeURIComponent(producto.id)}&volver=productos`;

  return (
    <aside className="w-full shrink-0 space-y-4 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:w-[380px]">
      {/* Cabecera */}
      <div className="flex items-start gap-3">
        <Miniatura producto={producto} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-foreground">{producto.nombre}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{producto.codigo ?? "Sin código"}</p>
          <p
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              producto.activo
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {textoDelEstado(producto)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Desde Gestión: solo lectura */}
      <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {producto.origen === "GESTION" ? "Desde Gestión · solo lectura" : "Datos del producto · solo lectura"}
        </h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Precio detal</dt>
          <dd className="text-right tabular-nums text-foreground">{formatMoney(producto.precio, currency)}</dd>
          <dt className="text-muted-foreground">Mayorista</dt>
          <dd className="text-right tabular-nums text-foreground">
            {producto.precioMayorista > 0
              ? `${formatMoney(producto.precioMayorista, currency)} desde ${producto.cantidadMinimaMayorista}`
              : "—"}
          </dd>
          <dt className="text-muted-foreground">Categoría</dt>
          <dd className="text-right text-foreground">{producto.categoria ?? "—"}</dd>
          <dt className="text-muted-foreground">Código</dt>
          <dd className="text-right tabular-nums text-foreground">{producto.codigo ?? "—"}</dd>
        </dl>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Fotos que el agente puede enviar</p>
          {producto.fotos.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">Sin fotos que carguen.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {producto.fotos.map((foto) => (
                <a key={foto} href={foto} target="_blank" rel="noopener noreferrer">
                  <Foto src={foto} alt={producto.nombre} className="size-16 rounded-md border border-border object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
        {producto.origen === "GESTION" ? (
          <p className="text-[11px] text-muted-foreground">Estos datos se cambian en Gestión y llegan al sincronizar.</p>
        ) : null}
      </section>

      {/* Para el agente: editable */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Para el agente</h2>
        <div className="space-y-1">
          <label htmlFor="descripcion-de-venta" className="text-xs font-medium text-foreground">
            Descripción de venta
          </label>
          <Textarea
            id="descripcion-de-venta"
            rows={7}
            value={descripcion}
            onChange={(evento) => setDescripcion(evento.target.value)}
            placeholder="Material, medidas, qué incluye, cuánto peso soporta. Es lo que el agente lee para contestar."
          />
          {descripcion.trim().length < LARGO_MINIMO_DE_LA_DESCRIPCION ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Muy corta: el agente no va a poder contestar material, medidas ni qué incluye.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <GitBranch className="size-3.5" aria-hidden="true" />
            Embudo
          </p>
          {producto.pasos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Este producto todavía no tiene embudo.</p>
          ) : (
            <ol className="space-y-1">
              {producto.pasos.map((paso) => (
                <li key={paso.etiqueta} className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                  <span className="font-medium text-foreground">{paso.etiqueta}</span>
                  {paso.objetivo ? <span className="text-muted-foreground"> · {paso.objetivo}</span> : null}
                  <span className="block text-muted-foreground">
                    {paso.seguimientos.length === 0
                      ? "Sin seguimientos"
                      : `${paso.seguimientos.length} ${paso.seguimientos.length === 1 ? "seguimiento" : "seguimientos"}: ${paso.seguimientos.join(", ")}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link
            href={embudoHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            {producto.pasos.length > 0 ? "Abrir embudo" : "Crear embudo"}
          </Link>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={guardar} disabled={!cambio || guardando}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </section>
    </aside>
  );
}
