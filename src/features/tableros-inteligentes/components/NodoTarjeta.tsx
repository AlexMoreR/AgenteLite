"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Info, Layers, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";

export type DatosNodoTarjeta = {
  titulo: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  tipoNombre: string;
  tipoColor: string;
  tipoIcono: string | null;
  /** false = carpeta (Área): no muestra estado. */
  usaEstados: boolean;
  /** Cuántas hijas (no borradas) tiene: si tiene, tocarla entra a su nivel. */
  hijas: number;
  tieneLink: boolean;
  /** Es la tarjeta del nivel actual (la del centro): tocarla abre su ficha. */
  esNivel: boolean;
  atenuado: boolean;
  /** Abre la ficha sin entrar (botón "i" de las tarjetas con hijas). */
  alAbrirFicha: () => void;
};

export type NodoDeTarjeta = Node<DatosNodoTarjeta, "tarjeta">;

/**
 * Una tarjeta en el mapa: color e ícono de su TIPO (franja y ícono), borde e insignia de su ESTADO
 * (las carpetas, como Área, no tienen estado: borde neutro). Con hijas muestra el contador junto al
 * título ("Ventas · 5") y un botón "i" para ver la ficha sin entrar.
 */
function NodoTarjetaBase({ data, selected }: NodeProps<NodoDeTarjeta>) {
  const color = COLOR_DEL_ESTADO[data.estado];
  const borde = data.usaEstados ? color.tarjeta : "border-zinc-300 bg-card dark:border-zinc-600";
  return (
    <div
      className={cn(
        "relative flex h-[132px] w-[200px] flex-col overflow-hidden rounded-xl border-2 py-2 pl-3.5 pr-2.5 text-left shadow-sm transition-opacity",
        borde,
        data.esNivel && "shadow-md",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        data.atenuado && "opacity-25",
      )}
    >
      {/* Franja del color del tipo. */}
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: data.tipoColor }} aria-hidden />
      {/* Las flechas se dibujan desde el MCP: los puntos de conexión no se muestran ni se arrastran. */}
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <IconoDeTipo icono={data.tipoIcono} color={data.tipoColor} className="size-3.5 shrink-0" />
        <span className="truncate">{data.tipoNombre}</span>
        {data.usaEstados ? (
          <span className={cn("ml-auto shrink-0 rounded-full border px-1.5 text-[10px] leading-4", color.pastilla)}>
            {NOMBRE_DEL_ESTADO[data.estado]}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-3 text-sm font-semibold leading-snug text-foreground">
        {data.titulo}
        {data.hijas > 0 ? <span className="font-medium text-muted-foreground"> · {data.hijas}</span> : null}
      </p>
      <div className="mt-auto flex min-h-6 items-center gap-1.5 text-[11px] text-muted-foreground">
        {data.hijas > 0 && !data.esNivel ? (
          <span className="flex items-center gap-1">
            <Layers className="size-3" aria-hidden />
            Tocar para entrar
          </span>
        ) : data.area ? (
          <span className="truncate">{data.area}</span>
        ) : null}
        {data.tieneLink ? <Link2 className="size-3.5 shrink-0" aria-label="Tiene link" /> : null}
        {data.hijas > 0 && !data.esNivel ? (
          <button
            type="button"
            className="nodrag nopan ml-auto flex size-8 shrink-0 items-center justify-center rounded-full border bg-background/80 text-muted-foreground hover:text-foreground"
            aria-label="Ver la ficha sin entrar"
            title="Ver la ficha"
            onClick={(evento) => {
              evento.stopPropagation();
              data.alAbrirFicha();
            }}
          >
            <Info className="size-3.5" />
          </button>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" isConnectable={false} />
    </div>
  );
}

export const NodoTarjeta = memo(NodoTarjetaBase);
