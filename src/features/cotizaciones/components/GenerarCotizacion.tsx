"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, FileText, LoaderCircle, Minus, Plus, Search, Send, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  generarCotizacionEnGestionAction,
  listarProductosParaCotizarAction,
} from "@/app/actions/generar-cotizacion-actions";
import {
  esCantidadValida,
  faltantesDelCliente,
  faltantesDeProductos,
  formatearPesos,
  interpretarProductos,
  normalizar,
  textoParaElCliente,
  type DatosDeLaFicha,
  type Faltante,
  type LineaElegida,
  type ProductoDelCatalogo,
} from "../services/generar-cotizacion";

type Generada = { codigo: string; total: number; shareUrl: string; reutilizada: boolean };

/**
 * Pie de la pestaña Cotizaciones: productos + cantidad, lo que falta y "Generar cotización".
 * Crea la cotización en Gestión (con el precio de Gestión). Al cliente no sale nada hasta que la
 * asesora toca "Enviar al cliente".
 */
export function GenerarCotizacion({
  contactId,
  conversationId,
  ficha,
  enviarAlChat,
}: {
  contactId: string;
  conversationId?: string;
  ficha: DatosDeLaFicha;
  /** Manda un texto al chat abierto por el camino normal del composer. false = no se pudo. */
  enviarAlChat?: (texto: string) => boolean;
}) {
  const [catalogo, setCatalogo] = useState<ProductoDelCatalogo[] | null>(null);
  const [lineas, setLineas] = useState<LineaElegida[]>([]);
  const [sinReconocer, setSinReconocer] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [faltanGestion, setFaltanGestion] = useState<Faltante[]>([]);
  const [mostrarFaltantes, setMostrarFaltantes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generada, setGenerada] = useState<Generada | null>(null);
  const [enviadaAlCliente, setEnviadaAlCliente] = useState(false);
  const textoLeido = useRef<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarProductosParaCotizarAction()
      .then((respuesta) => {
        if (vigente) setCatalogo(respuesta.productos ?? []);
      })
      .catch(() => {
        if (vigente) setCatalogo([]);
      });
    return () => {
      vigente = false;
    };
  }, []);

  // "Productos" de la ficha -> lineas, una vez por texto (si la asesora ya eligio, no se pisa).
  useEffect(() => {
    if (!catalogo || textoLeido.current === ficha.products) return;
    textoLeido.current = ficha.products;
    const leido = interpretarProductos(ficha.products, catalogo);
    setLineas((actuales) => (actuales.length > 0 ? actuales : leido.lineas));
    setSinReconocer(leido.sinReconocer);
  }, [catalogo, ficha.products]);

  const porId = useMemo(() => new Map((catalogo ?? []).map((producto) => [producto.id, producto])), [catalogo]);

  const resultados = useMemo(() => {
    const termino = normalizar(busqueda);
    if (!catalogo || !termino) return [];
    return catalogo
      .filter((producto) => normalizar(`${producto.nombre} ${producto.codigo ?? ""}`).includes(termino))
      .slice(0, 8);
  }, [busqueda, catalogo]);

  const faltanLocal = useMemo(
    () => [...faltantesDelCliente(ficha, undefined), ...faltantesDeProductos(lineas, catalogo ?? [])],
    [ficha, lineas, catalogo],
  );
  const faltantes = faltanGestion.length > 0 ? faltanGestion : faltanLocal;

  const limpiarResultado = () => {
    setGenerada(null);
    setEnviadaAlCliente(false);
    setFaltanGestion([]);
    setError(null);
  };

  const agregar = (producto: ProductoDelCatalogo) => {
    setLineas((actuales) =>
      actuales.some((linea) => linea.productId === producto.id)
        ? actuales.map((linea) => (linea.productId === producto.id ? { ...linea, cantidad: linea.cantidad + 1 } : linea))
        : [...actuales, { productId: producto.id, cantidad: 1 }],
    );
    setBusqueda("");
    limpiarResultado();
  };

  const cambiarCantidad = (productId: string, cantidad: number) => {
    setLineas((actuales) => actuales.map((linea) => (linea.productId === productId ? { ...linea, cantidad } : linea)));
    limpiarResultado();
  };

  const quitar = (productId: string) => {
    setLineas((actuales) => actuales.filter((linea) => linea.productId !== productId));
    limpiarResultado();
  };

  const generar = async () => {
    setError(null);
    setFaltanGestion([]);
    if (faltanLocal.length > 0) {
      setMostrarFaltantes(true);
      return;
    }
    setEnviando(true);
    try {
      const respuesta = await generarCotizacionEnGestionAction({ contactId, conversationId, lineas });
      if (respuesta.ok) {
        setGenerada({
          codigo: respuesta.codigo,
          total: respuesta.total,
          shareUrl: respuesta.shareUrl,
          reutilizada: respuesta.reutilizada,
        });
        setEnviadaAlCliente(false);
        setMostrarFaltantes(false);
        return;
      }
      if (respuesta.faltantes?.length) {
        setFaltanGestion(respuesta.faltantes);
        setMostrarFaltantes(true);
        return;
      }
      setError(respuesta.error ?? "No se pudo generar la cotización.");
    } catch {
      setError("No se pudo conectar. Prueba de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  const enviarAlCliente = () => {
    if (!generada || !enviarAlChat) return;
    const salio = enviarAlChat(
      textoParaElCliente({ nombre: ficha.fullName, codigo: generada.codigo, total: generada.total, shareUrl: generada.shareUrl }),
    );
    if (salio) {
      setEnviadaAlCliente(true);
    } else {
      setError("Hay un mensaje en camino o el chat aún carga. Prueba en un momento.");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cotizar en Gestión</p>

      {/* Productos elegidos */}
      <div className="mt-2 flex flex-col gap-2">
        {catalogo === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Cargando productos…
          </p>
        ) : lineas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Busca y elige los productos.</p>
        ) : (
          lineas.map((linea) => {
            const producto = porId.get(linea.productId);
            return (
              <div key={linea.productId} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{producto?.nombre ?? "Producto no disponible"}</p>
                  {producto ? (
                    <p className="text-[11px] text-muted-foreground">
                      {producto.codigo} · {formatearPesos(producto.precio)} c/u
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Una menos"
                  onClick={() => cambiarCantidad(linea.productId, Math.max(1, linea.cantidad - 1))}
                >
                  <Minus className="size-3.5" />
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={Number.isFinite(linea.cantidad) ? linea.cantidad : ""}
                  onChange={(evento) => cambiarCantidad(linea.productId, Math.trunc(Number(evento.target.value)))}
                  aria-label="Cantidad"
                  className={`h-7 w-14 px-1 text-center text-sm ${esCantidadValida(linea.cantidad) ? "" : "border-destructive"}`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Una más"
                  onClick={() => cambiarCantidad(linea.productId, (linea.cantidad || 0) + 1)}
                >
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Quitar producto"
                  onClick={() => quitar(linea.productId)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })
        )}

        {sinReconocer.length > 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            No reconocí en el catálogo: «{sinReconocer.join("», «")}». Búscalos abajo.
          </p>
        ) : null}

        {catalogo && catalogo.length > 0 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar producto por nombre o código"
              className="h-9 pl-8 text-sm"
            />
            {resultados.length > 0 ? (
              <ul className="absolute inset-x-0 top-10 z-10 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                {resultados.map((producto) => (
                  <li key={producto.id}>
                    <button
                      type="button"
                      onClick={() => agregar(producto)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">{producto.nombre}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {producto.codigo} · {formatearPesos(producto.precio)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : catalogo ? (
          <p className="text-xs text-muted-foreground">No hay productos de Gestión sincronizados.</p>
        ) : null}
      </div>

      {/* Lo que falta */}
      {faltantes.length > 0 && (mostrarFaltantes || faltanGestion.length > 0 || !generada) ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 ${
            mostrarFaltantes ? "border-amber-500/50 bg-amber-500/10" : "border-dashed border-border"
          }`}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <TriangleAlert className="size-3.5 text-amber-600" />
            Falta para generar
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {faltantes.map((faltante, indice) => (
              <li key={`${faltante.campo}-${indice}`}>{faltante.mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {generada ? (
        <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Check className="size-4 text-emerald-600" />
            {generada.codigo} · {formatearPesos(generada.total)}
          </p>
          {generada.reutilizada ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Ya estaba generada hace un momento: es la misma.</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <a href={generada.shareUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                Ver cotización
              </a>
            </Button>
            {enviarAlChat ? (
              <Button type="button" size="sm" onClick={enviarAlCliente} disabled={enviadaAlCliente} className="gap-1.5">
                {enviadaAlCliente ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
                {enviadaAlCliente ? "Enviada" : "Enviar al cliente"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Button type="button" onClick={generar} disabled={enviando} className="mt-3 w-full gap-1.5">
        {enviando ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
        {enviando ? "Generando…" : "Generar cotización"}
      </Button>
    </section>
  );
}
