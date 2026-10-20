"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Info, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { ANCHO_TARJETA, ALTO_TARJETA } from "../services/disposicion";
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

const mismoTexto = (a: string, b: string) => a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

/**
 * Una tarjeta en el mapa, compacta (ANCHO_TARJETA x ALTO_TARJETA, las mismas medidas que usa
 * services/disposicion.ts): el ícono del TIPO con su color junto al título (2 líneas máx.) y, abajo,
 * una línea chica con el ESTADO como punto ("● Idea") o, en las carpetas (Área, sin estado), el
 * nombre del tipo; con hijas suma el contador ("Área · 9") y un botón "i" para ver la ficha sin
 * entrar. El área solo se muestra si no repite el título.
 */
function NodoTarjetaBase({ data, selected }: NodeProps<NodoDeTarjeta>) {
  const color = COLOR_DEL_ESTADO[data.estado];
  const area = data.area && !mismoTexto(data.area, data.titulo) ? data.area : null;
  const conBotonFicha = data.hijas > 0 && !data.esNivel;
  return (
    <div
      style={{ width: ANCHO_TARJETA, height: ALTO_TARJETA }}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-border bg-card px-2 py-1.5 text-left shadow-sm transition-opacity",
        data.esNivel && "border-foreground/30 shadow-md",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        data.atenuado && "opacity-25",
      )}
    >
      {/* Las flechas se dibujan desde el MCP: los puntos de conexión no se muestran ni se arrastran. */}
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      <div className="flex min-w-0 items-start gap-1.5">
        <span title={data.tipoNombre} className="mt-px shrink-0">
          <IconoDeTipo icono={data.tipoIcono} color={data.tipoColor} className="size-3.5" />
        </span>
        <p className="line-clamp-2 min-w-0 text-xs font-semibold leading-tight text-foreground">{data.titulo}</p>
      </div>
      <div className="mt-auto flex h-6 min-w-0 items-center gap-1 text-[10px] leading-none text-muted-foreground">
        {data.usaEstados ? (
          <span className="flex min-w-0 shrink-0 items-center gap-1">
            <span className={cn("size-1.5 shrink-0 rounded-full", color.punto)} aria-hidden />
            {NOMBRE_DEL_ESTADO[data.estado]}
          </span>
        ) : (
          <span className="shrink-0">{data.tipoNombre}</span>
        )}
        {data.hijas > 0 ? <span className="shrink-0 tabular-nums">· {data.hijas}</span> : null}
        {area ? <span className="min-w-0 truncate">· {area}</span> : null}
        {data.tieneLink ? <Link2 className="size-3 shrink-0" aria-label="Tiene link" /> : null}
        {conBotonFicha ? (
          <button
            type="button"
            className="nodrag nopan -mr-1 ml-auto flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
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
