"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Bell, Boxes, CirclePause, Flag, Search, Send, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import {
  NOMBRE_DEL_CARRIL,
  NOMBRE_DEL_DISPARADOR,
  conectadosA,
  construirMapa,
  idDeRegla,
  resaltarBusqueda,
  type DatosCarril,
  type DatosDestino,
  type DatosPaso,
  type DatosRegla,
  type TipoDeArista,
  type TipoDeDisparador,
} from "../domain/mapa";
import type { Accion, LibroDeReglas, ReglaV3 } from "../domain/reglas";

/**
 * El mapa del libro de reglas: SOLO para mirar cómo está cableado el bot (Alex, 13-oct-2026).
 *
 * Carriles por paso del embudo, una caja por regla coloreada por su disparador, y flechas a lo que
 * hace: a qué paso lleva, qué producto activa, qué flujo manda, si avisa a una asesora o pausa la
 * IA. Tocar una regla abre su detalle; tocar un paso, un producto o un flujo ilumina las reglas que
 * llegan ahí. Nada se arrastra ni se edita: el acomodo lo decide `domain/mapa.ts`.
 */

const COLOR_DISPARADOR: Record<TipoDeDisparador, { caja: string; punto: string }> = {
  frase: { caja: "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/60", punto: "bg-sky-500" },
  intencion: { caja: "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/60", punto: "bg-violet-500" },
  paso: { caja: "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/60", punto: "bg-emerald-500" },
  sin_respuesta: { caja: "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60", punto: "bg-amber-500" },
  siempre: { caja: "border-slate-400 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/70", punto: "bg-slate-500" },
};

const COLOR_ARISTA: Record<TipoDeArista, string> = {
  paso: "#10b981",
  producto: "#0ea5e9",
  flujo: "#8b5cf6",
  asesora: "#f59e0b",
  pausa: "#ef4444",
  entrada: "#64748b",
};

const ESTILO_DESTINO: Record<DatosDestino["tipo"], { clase: string; Icono: typeof Boxes }> = {
  producto: { clase: "border-sky-500 bg-sky-100 text-sky-950 dark:bg-sky-900 dark:text-sky-50", Icono: Boxes },
  flujo: { clase: "border-violet-500 bg-violet-100 text-violet-950 dark:bg-violet-900 dark:text-violet-50", Icono: Send },
  asesora: { clase: "border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50", Icono: Bell },
  pausa: { clase: "border-red-500 bg-red-100 text-red-950 dark:bg-red-900 dark:text-red-50", Icono: CirclePause },
  entrada: { clase: "border-slate-500 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900", Icono: Flag },
};

type ConAtenuado<T> = T & { atenuado?: boolean; resaltado?: boolean };

const asas = (
  <>
    <Handle type="target" position={Position.Left} isConnectable={false} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    <Handle type="source" position={Position.Right} isConnectable={false} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
  </>
);

const NodoRegla = memo(function NodoRegla({ data }: NodeProps<Node<ConAtenuado<DatosRegla>>>) {
  const color = COLOR_DISPARADOR[data.disparador] ?? COLOR_DISPARADOR.siempre;
  return (
    <div
      className={cn(
        "flex h-full w-full cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm transition-opacity",
        color.caja,
        !data.activa && "border-dashed opacity-60",
        data.atenuado && "opacity-15",
        data.resaltado && "ring-2 ring-primary",
      )}
      title={data.nombre}
    >
      {asas}
      <div className="flex items-center gap-1">
        <span className="shrink-0 rounded bg-background/70 px-1 text-[9px] font-semibold tabular-nums text-muted-foreground">#{data.prioridad}</span>
        <p className="truncate text-[11px] font-semibold leading-tight text-foreground">{data.nombre}</p>
      </div>
      <p className="truncate text-[10px] leading-tight text-muted-foreground">{data.resumen}</p>
      {data.chips.length > 0 ? (
        <div className="flex gap-1 overflow-hidden">
          {data.chips.map((chip) => (
            <span key={chip.id} className="truncate rounded-full bg-background/80 px-1.5 text-[9px] font-medium text-foreground">
              {chip.texto}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const NodoPaso = memo(function NodoPaso({ data }: NodeProps<Node<ConAtenuado<DatosPaso>>>) {
  return (
    <div
      className={cn(
        "flex h-full w-full cursor-pointer items-center justify-between rounded-lg border-2 border-emerald-500 bg-emerald-600 px-3 text-white shadow transition-opacity",
        data.atenuado && "opacity-25",
        data.resaltado && "ring-2 ring-primary ring-offset-2",
      )}
    >
      {asas}
      <span className="text-xs font-bold uppercase tracking-wide">{data.nombre}</span>
      <span className="text-[10px] opacity-80">{data.reglas} reglas</span>
    </div>
  );
});

const NodoCarril = memo(function NodoCarril({ data }: NodeProps<Node<DatosCarril>>) {
  return (
    <div className="h-full w-full rounded-2xl border border-dashed border-border bg-muted/30">
      {data.carril === "CUALQUIERA" ? (
        <p className="px-4 pt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{data.nombre}</p>
      ) : null}
    </div>
  );
});

const NodoDestino = memo(function NodoDestino({ data }: NodeProps<Node<ConAtenuado<DatosDestino>>>) {
  const { clase, Icono } = ESTILO_DESTINO[data.tipo];
  return (
    <div
      className={cn(
        "flex h-full w-full cursor-pointer items-center gap-2 rounded-full border-2 px-3 shadow-sm transition-opacity",
        clase,
        data.atenuado && "opacity-20",
        data.resaltado && "ring-2 ring-primary ring-offset-2",
      )}
      title={data.nombre}
    >
      {asas}
      <Icono className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{data.nombre}</span>
      <span className="shrink-0 text-[10px] opacity-70">{data.reglas}</span>
    </div>
  );
});

const TIPOS_DE_NODO = { regla: NodoRegla, paso: NodoPaso, carril: NodoCarril, destino: NodoDestino };

/* ------------------------------------------------------------------ detalle */

function textoDeLaAccion(accion: Accion, titulos: Record<string, string>, productos: Record<string, string>): string {
  switch (accion.tipo) {
    case "mensaje":
      return `Responde: «${accion.texto}»`;
    case "flujo":
      return `Envía el flujo «${titulos[accion.flujoId] ?? accion.titulo ?? accion.flujoId}»`;
    case "responder_con_ia":
      return `Contesta con IA, guiada por: ${accion.guia}`;
    case "activar_producto":
      return `Activa el producto ${productos[accion.productoId] ?? accion.nombre ?? accion.productoId}`;
    case "ir_al_paso":
      return `Pasa al paso ${NOMBRE_DEL_CARRIL[accion.paso] ?? accion.paso}`;
    case "cambiar_etapa_crm":
      return `Mueve la etapa del CRM a ${accion.etapa}`;
    case "avisar_asesor":
      return `Avisa a una asesora: ${accion.motivo}`;
    default:
      return "Pausa la IA";
  }
}

function condiciones(regla: ReglaV3, productos: Record<string, string>): string[] {
  const s = regla.soloSi;
  if (!s) return [];
  const lineas: string[] = [];
  if (s.productoActivo === "ninguno") lineas.push("Todavía no eligió producto");
  else if (s.productoActivo === "cualquiera") lineas.push("Ya habla de algún producto");
  else if (s.productoActivo) lineas.push(`Habla de ${productos[s.productoActivo] ?? s.productoActivo}`);
  if (s.pasoActual) lineas.push(`Está en el paso ${NOMBRE_DEL_CARRIL[s.pasoActual] ?? s.pasoActual}`);
  if (s.noSiYaSeEnvio) lineas.push(`No se le ha enviado ${s.noSiYaSeEnvio}`);
  if (s.esPrimerMensaje === true) lineas.push("Es su primer mensaje");
  if (s.esPrimerMensaje === false) lineas.push("No es su primer mensaje");
  return lineas;
}

function DetalleDeLaRegla({
  regla,
  prioridad,
  titulos,
  productos,
}: {
  regla: ReglaV3;
  prioridad: number;
  titulos: Record<string, string>;
  productos: Record<string, string>;
}) {
  const cuando = regla.cuando;
  const color = COLOR_DISPARADOR[cuando.tipo] ?? COLOR_DISPARADOR.siempre;
  const lineasDeCondicion = condiciones(regla, productos);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
          <span className={cn("size-2 rounded-full", color.punto)} />
          {NOMBRE_DEL_DISPARADOR[cuando.tipo]}
        </span>
        <span>Prioridad #{prioridad}</span>
        {regla.activa ? null : <span className="font-medium text-amber-700 dark:text-amber-300">Apagada</span>}
      </div>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cuándo</h3>
        {cuando.tipo === "frase" ? (
          <>
            <p className="text-[13px]">Si el cliente dice{cuando.exacta ? " exactamente" : ""}:</p>
            <div className="flex flex-wrap gap-1">
              {(cuando.frases ?? []).map((frase) => (
                <span key={frase} className="rounded-md bg-muted px-1.5 py-0.5 text-[12px]">
                  {frase}
                </span>
              ))}
            </div>
          </>
        ) : cuando.tipo === "intencion" ? (
          <p className="text-[13px]">Si lo que pide encaja con: {cuando.descripcion}</p>
        ) : cuando.tipo === "paso" ? (
          <p className="text-[13px]">
            Al entrar al paso {NOMBRE_DEL_CARRIL[cuando.paso] ?? cuando.paso} de {productos[cuando.producto] ?? cuando.producto}
          </p>
        ) : cuando.tipo === "sin_respuesta" ? (
          <p className="text-[13px]">Si pasan {cuando.minutos} minutos sin que conteste</p>
        ) : (
          <p className="text-[13px]">Siempre</p>
        )}
      </section>

      {lineasDeCondicion.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Solo si</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
            {lineasDeCondicion.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entonces</h3>
        <ol className="space-y-1.5">
          {regla.entonces.map((accion, indice) => (
            <li key={indice} className="flex items-start gap-1.5 text-[13px]">
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 whitespace-pre-wrap break-words">{textoDeLaAccion(accion, titulos, productos)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ el mapa */

export function MapaDelLibro({
  libro,
  nombresDeProductos,
  titulosDeFlujos,
}: {
  libro: LibroDeReglas;
  nombresDeProductos: Record<string, string>;
  titulosDeFlujos: Record<string, string>;
}) {
  const esCelular = useIsMobile();
  const [verInactivas, setVerInactivas] = useState(false);
  const [producto, setProducto] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [reglaAbierta, setReglaAbierta] = useState<string | null>(null);

  const mapa = useMemo(
    () => construirMapa(libro, { nombresDeProductos, titulosDeFlujos, verInactivas, producto }),
    [libro, nombresDeProductos, titulosDeFlujos, verInactivas, producto],
  );

  const resaltado = useMemo(() => {
    if (seleccion && mapa.nodos.some((nodo) => nodo.id === seleccion)) return conectadosA(mapa, seleccion);
    return resaltarBusqueda(libro, mapa, busqueda);
  }, [libro, mapa, seleccion, busqueda]);

  const nodes = useMemo<Node[]>(
    () =>
      mapa.nodos.map((nodo) => {
        const tipo = nodo.datos.tipo === "regla" || nodo.datos.tipo === "paso" || nodo.datos.tipo === "carril" ? nodo.datos.tipo : "destino";
        return {
          id: nodo.id,
          type: tipo,
          position: { x: nodo.x, y: nodo.y },
          width: nodo.ancho,
          height: nodo.alto,
          style: { width: nodo.ancho, height: nodo.alto },
          zIndex: tipo === "carril" ? -1 : 1,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: tipo !== "carril",
          data: {
            ...nodo.datos,
            atenuado: resaltado ? !resaltado.nodos.has(nodo.id) : false,
            resaltado: seleccion === nodo.id,
          },
        };
      }),
    [mapa, resaltado, seleccion],
  );

  const edges = useMemo<Edge[]>(
    () =>
      mapa.aristas.map((arista) => {
        const encendida = resaltado?.aristas.has(arista.id) ?? false;
        return {
          id: arista.id,
          source: arista.desde,
          target: arista.hasta,
          focusable: false,
          selectable: false,
          animated: encendida,
          style: {
            stroke: COLOR_ARISTA[arista.tipo],
            strokeWidth: encendida ? 2 : 1,
            opacity: resaltado ? (encendida ? 0.95 : 0.04) : 0.3,
          },
        };
      }),
    [mapa, resaltado],
  );

  const alTocarNodo = useCallback((_: unknown, nodo: Node) => {
    if (nodo.type === "carril") {
      setSeleccion(null);
      return;
    }
    if (nodo.type === "regla") {
      setSeleccion(nodo.id);
      setReglaAbierta((nodo.data as DatosRegla).reglaId);
      return;
    }
    setReglaAbierta(null);
    setSeleccion((actual) => (actual === nodo.id ? null : nodo.id));
  }, []);

  const prioridadPorRegla = useMemo(() => {
    const mapaDePrioridad = new Map<string, number>();
    for (const nodo of mapa.nodos) if (nodo.datos.tipo === "regla") mapaDePrioridad.set(nodo.datos.reglaId, nodo.datos.prioridad);
    return mapaDePrioridad;
  }, [mapa]);

  const regla = reglaAbierta ? libro.reglas.find((r) => r.id === reglaAbierta) ?? null : null;
  const cerrarDetalle = () => {
    setReglaAbierta(null);
    if (regla && seleccion === idDeRegla(regla.id)) setSeleccion(null);
  };

  const detalle = regla ? (
    <DetalleDeLaRegla
      regla={regla}
      prioridad={prioridadPorRegla.get(regla.id) ?? 0}
      titulos={titulosDeFlujos}
      productos={nombresDeProductos}
    />
  ) : null;

  if (libro.reglas.length === 0) {
    return (
      <div className="mx-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        El libro está vacío: no hay nada que dibujar todavía.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(evento) => {
              setBusqueda(evento.target.value);
              setSeleccion(null);
            }}
            placeholder="Buscar regla, frase o texto"
            className="h-9 pl-8"
            aria-label="Buscar en el mapa"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={verInactivas} onCheckedChange={(valor) => setVerInactivas(Boolean(valor))} />
          Ver inactivas{mapa.totales.inactivas ? ` (${mapa.totales.inactivas})` : ""}
        </label>
        <span className="text-[12px] text-muted-foreground">
          {mapa.totales.visibles} de {mapa.totales.reglas} reglas
        </span>
      </div>

      {mapa.productos.length > 0 ? (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {[{ id: null as string | null, texto: "Todos" }, ...mapa.productos].map((chip) => (
            <button
              key={chip.id ?? "todos"}
              type="button"
              onClick={() => {
                setProducto(chip.id);
                setSeleccion(null);
              }}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[12px] transition",
                producto === chip.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {chip.texto}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative h-[calc(100dvh-13rem)] min-h-[420px] overflow-hidden rounded-2xl border border-border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={TIPOS_DE_NODO}
          onNodeClick={alTocarNodo}
          onPaneClick={() => setSeleccion(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          minZoom={0.05}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          proOptions={{ hideAttribution: true }}
          style={{ backgroundColor: "var(--card)" }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          {esCelular ? null : <MiniMap pannable zoomable bgColor="var(--card)" nodeColor={colorDelMinimapa} className="!bottom-2 !right-2" />}
        </ReactFlow>

        <Leyenda />

        {!esCelular && regla ? (
          <aside className="absolute inset-y-2 right-2 z-10 flex w-96 max-w-[calc(100%-1rem)] flex-col rounded-xl border border-border bg-popover shadow-lg">
            <div className="flex items-start gap-2 border-b border-border p-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{regla.nombre}</p>
              <button type="button" onClick={cerrarDetalle} aria-label="Cerrar detalle" className="rounded p-1 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{detalle}</div>
          </aside>
        ) : null}
      </div>

      {esCelular ? (
        <Sheet open={Boolean(regla)} onOpenChange={(abierto) => (abierto ? null : cerrarDetalle())}>
          <SheetContent side="bottom" className="max-h-[80dvh] gap-2 rounded-t-2xl">
            <SheetHeader className="pb-0">
              <SheetTitle className="pr-8">{regla?.nombre}</SheetTitle>
              <SheetDescription className="sr-only">Detalle de la regla, solo lectura</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-6">{detalle}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function colorDelMinimapa(nodo: Node): string {
  const datos = nodo.data as { tipo?: string; disparador?: TipoDeDisparador };
  if (datos.tipo === "carril") return "transparent";
  if (datos.tipo === "paso") return "#059669";
  if (datos.tipo === "regla") {
    return { frase: "#0ea5e9", intencion: "#8b5cf6", paso: "#10b981", sin_respuesta: "#f59e0b", siempre: "#64748b" }[datos.disparador ?? "siempre"];
  }
  return "#94a3b8";
}

function Leyenda() {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border bg-popover/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm">
      {(Object.keys(NOMBRE_DEL_DISPARADOR) as TipoDeDisparador[]).map((tipo) => (
        <span key={tipo} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-full", COLOR_DISPARADOR[tipo].punto)} />
          {NOMBRE_DEL_DISPARADOR[tipo]}
        </span>
      ))}
    </div>
  );
}
