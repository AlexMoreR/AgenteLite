"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import { NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";
import { COLOR_DEL_ESTADO } from "./colores";

export type DatosNodoTarjeta = {
  titulo: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  atenuado: boolean;
};

export type NodoDeTarjeta = Node<DatosNodoTarjeta, "tarjeta">;

/** Una tarjeta en el mapa: el color dice el estado; se toca para abrir la ficha. */
function NodoTarjetaBase({ data, selected }: NodeProps<NodoDeTarjeta>) {
  const color = COLOR_DEL_ESTADO[data.estado];
  return (
    <div
      className={cn(
        "w-[200px] rounded-xl border-2 px-3 py-2 text-left shadow-sm transition-opacity",
        color.tarjeta,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        data.atenuado && "opacity-25",
      )}
    >
      {/* Las flechas se dibujan desde el MCP: los puntos de conexión no se muestran ni se arrastran. */}
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className={cn("size-2 shrink-0 rounded-full", color.punto)} aria-hidden />
        <span>{NOMBRE_DEL_ESTADO[data.estado]}</span>
        {data.area ? <span className="truncate">· {data.area}</span> : null}
      </div>
      <p className="mt-1 line-clamp-3 text-sm font-semibold leading-snug text-foreground">{data.titulo}</p>
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" isConnectable={false} />
    </div>
  );
}

export const NodoTarjeta = memo(NodoTarjetaBase);
