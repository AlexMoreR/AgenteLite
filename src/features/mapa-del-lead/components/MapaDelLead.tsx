"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  ALTO_NODO,
  ANCHO_NODO,
  LEYENDA,
  TIPOS,
  armarMapaDelLead,
  type DatosDelLead,
  type EstadoDeNodo,
  type NodoDelMapa,
  type TipoFiltrable,
} from "../dominio/mapa";

/**
 * El dibujo del MAPA DEL LEAD (solo lectura). Las posiciones salen de dominio/mapa.ts; acá solo se
 * pinta, se filtra por tipo y se abre el detalle de un nodo (panel a la derecha; abajo en el celular).
 */

type DatoDelNodo = { nodo: NodoDelMapa };
type NodoFlow = Node<DatoDelNodo, "mapa">;

const COLOR_DE_ESTADO: Partial<Record<EstadoDeNodo, string>> = {
  hecho: "#16a34a",
  actual: "#ea580c",
  pendiente: "#9ca3af",
};

function colorDelNodo(nodo: NodoDelMapa): string {
  if (nodo.tipo === "cliente") return "#0f172a";
  if (nodo.tipo === "mas") return "#64748b";
  if (nodo.tipo === "etapa") return COLOR_DE_ESTADO[nodo.estado] ?? LEYENDA.etapa.color;
  if (nodo.estado === "fallo" || nodo.estado === "vencida") return "#dc2626";
  return LEYENDA[nodo.tipo].color;
}

const MANIJA = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function NodoMapa({ data, selected }: NodeProps<NodoFlow>) {
  const nodo = data.nodo;
  const color = colorDelNodo(nodo);
  const esCliente = nodo.tipo === "cliente";
  const tenue = nodo.estado === "cancelado" || (nodo.tipo === "etapa" && nodo.estado === "pendiente");
  return (
    <div
      className={cn(
        "flex flex-col justify-center rounded-xl border-2 bg-card px-2.5 py-1.5 text-left shadow-sm transition",
        esCliente && "text-white",
        nodo.estado === "programado" && "border-dashed",
        nodo.tipo === "mas" && "border-dashed bg-muted",
        tenue && "opacity-60",
        selected && "ring-2 ring-primary ring-offset-1",
      )}
      style={{
        width: esCliente ? ANCHO_NODO + 30 : ANCHO_NODO,
        minHeight: ALTO_NODO,
        borderColor: color,
        background: esCliente ? color : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} id="l" className={MANIJA} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r" className={MANIJA} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="ls" className={MANIJA} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="rt" className={MANIJA} isConnectable={false} />
      <Handle type="source" position={Position.Top} id="ts" className={MANIJA} isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="bt" className={MANIJA} isConnectable={false} />
      <div className="flex items-center gap-1.5">
        {!esCliente ? <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" /> : null}
        <span className={cn("truncate font-semibold", esCliente ? "text-[15px]" : "text-[13px] text-foreground", nodo.estado === "cancelado" && "line-through")}>
          {nodo.titulo}
        </span>
        {nodo.insignia ? (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-semibold",
              nodo.insignia === "respondió" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
            )}
          >
            {nodo.insignia}
          </span>
        ) : null}
      </div>
      {nodo.subtitulo ? (
        <span className={cn("truncate text-[11px]", esCliente ? "text-white/80" : "text-muted-foreground")}>{nodo.subtitulo}</span>
      ) : null}
    </div>
  );
}

const nodeTypes = { mapa: NodoMapa };

function hrefDelChat(chatKey: string) {
  return `/cliente/chats?chatKey=${encodeURIComponent(chatKey)}&assigned=all`;
}

type Props = {
  datos: DatosDelLead;
  /** Si viene, "Abrir chat" llama a esto (p. ej. cerrar el diálogo) además de navegar. */
  alAbrirChat?: () => void;
};

function Lienzo({ datos, alAbrirChat }: Props) {
  const [ocultos, setOcultos] = useState<Set<TipoFiltrable>>(() => new Set());
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set());
  const [elegido, setElegido] = useState<string | null>(null);
  // La hora se fija al abrir: el mapa es una foto, no un reloj.
  const [ahora] = useState(() => new Date());
  const { fitView } = useReactFlow();

  const mapa = useMemo(() => armarMapaDelLead(datos, { ahora, ocultos, expandidos }), [datos, ahora, ocultos, expandidos]);

  const nodos = useMemo<NodoFlow[]>(
    () =>
      mapa.nodos.map((n) => ({
        id: n.id,
        type: "mapa",
        position: { x: n.x, y: n.y },
        data: { nodo: n },
        selected: n.id === elegido,
        draggable: false,
        connectable: false,
      })),
    [mapa, elegido],
  );

  const aristas = useMemo<Edge[]>(() => {
    const porId = new Map(mapa.nodos.map((n) => [n.id, n]));
    return mapa.aristas.flatMap((a) => {
      const desde = porId.get(a.desde);
      const hasta = porId.get(a.hasta);
      if (!desde || !hasta) return [];
      const haciaArriba = desde.tipo === "cliente" && hasta.tipo === "etapa";
      const haciaIzquierda = !haciaArriba && hasta.x < desde.x;
      return [
        {
          id: a.id,
          source: a.desde,
          target: a.hasta,
          sourceHandle: haciaArriba ? "ts" : haciaIzquierda ? "ls" : "r",
          targetHandle: haciaArriba ? "bt" : haciaIzquierda ? "rt" : "l",
          type: "smoothstep",
          style: { stroke: colorDelNodo(hasta), strokeWidth: 1.5, strokeDasharray: a.punteada ? "5 4" : undefined, opacity: 0.7 },
        },
      ];
    });
  }, [mapa]);

  useEffect(() => {
    const t = window.setTimeout(() => void fitView({ padding: 0.15, duration: 200 }), 30);
    return () => window.clearTimeout(t);
  }, [ocultos, expandidos, fitView]);

  const nodoElegido = elegido ? mapa.nodos.find((n) => n.id === elegido) ?? null : null;

  const alternar = (tipo: TipoFiltrable) =>
    setOcultos((antes) => {
      const nuevo = new Set(antes);
      if (nuevo.has(tipo)) nuevo.delete(tipo);
      else nuevo.add(tipo);
      return nuevo;
    });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Leyenda + filtros: un chip por tipo, con su color y cuántos hay. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-card px-3 py-2">
        {TIPOS.map((tipo) => {
          const activo = !ocultos.has(tipo);
          const total = mapa.conteos[tipo];
          return (
            <button
              key={tipo}
              type="button"
              onClick={() => alternar(tipo)}
              aria-pressed={activo}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
                activo ? "border-border bg-background text-foreground" : "border-dashed border-border bg-muted text-muted-foreground line-through",
                total === 0 && "opacity-50",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: LEYENDA[tipo].color }} aria-hidden="true" />
              {LEYENDA[tipo].nombre}
              <span className="text-muted-foreground">{total}</span>
            </button>
          );
        })}
        <span className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground md:inline-flex">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#16a34a]" />hecho</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#ea580c]" />actual</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#9ca3af]" />falta</span>
          <span>borde punteado = programado</span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodos}
          edges={aristas}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, nodo) => {
            const n = (nodo.data as DatoDelNodo).nodo;
            if (n.tipo === "mas" && n.grupo) {
              const grupo = n.grupo;
              setExpandidos((antes) => new Set(antes).add(grupo));
              return;
            }
            setElegido(n.id);
          }}
          onPaneClick={() => setElegido(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {nodoElegido?.detalle ? (
          <aside
            className={cn(
              "absolute z-10 flex flex-col gap-2 overflow-y-auto border-border bg-card p-4 shadow-lg",
              // Celular: hoja de abajo. Escritorio: panel a la derecha.
              "inset-x-0 bottom-0 max-h-[55%] rounded-t-2xl border-t",
              "md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:max-h-none md:w-80 md:rounded-none md:border-t-0 md:border-l",
            )}
          >
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">{nodoElegido.detalle.titulo}</h3>
              <button
                type="button"
                onClick={() => setElegido(null)}
                aria-label="Cerrar detalle"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {nodoElegido.detalle.filas.map((f, i) => (
                <div key={`${f.etiqueta}-${i}`} className="contents">
                  <dt className="text-muted-foreground">{f.etiqueta}</dt>
                  <dd className="break-words text-foreground">{f.valor}</dd>
                </div>
              ))}
            </dl>
            {nodoElegido.detalle.texto ? (
              <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[13px] text-foreground">{nodoElegido.detalle.texto}</p>
            ) : null}
            {nodoElegido.detalle.chatKey ? (
              <Link
                href={hrefDelChat(nodoElegido.detalle.chatKey)}
                onClick={() => alAbrirChat?.()}
                className="mt-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <MessageCircle className="size-4" />
                Abrir chat
              </Link>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export function MapaDelLead(props: Props) {
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  );
}

export default MapaDelLead;
