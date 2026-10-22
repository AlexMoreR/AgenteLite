"use client";

import { memo, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import { ANCHO_CENTRO, ANCHO_TARJETA } from "../services/disposicion";
import type { Contadores } from "../services/niveles";
import { IconoDeTipo } from "./IconoDeTipo";

export type DatosNodoTarjeta = {
  titulo: string;
  /** El color y el ícono de su tipo (null si el tipo no llegó): el ícono al lado del título y una franja arriba. */
  color: string | null;
  icono: string | null;
  /** Cuántas hijas (no borradas) tiene: si tiene, tocarla entra a su nivel. */
  hijas: number;
  /** Ella y toda su descendencia (services/niveles.ts, contadoresRecursivos). */
  contadores: Contadores;
  /** Es la tarjeta del nivel actual (la del centro): tocarla abre su ficha. */
  esNivel: boolean;
  atenuado: boolean;
  /** Abre la ficha sin entrar (mantener presionada una tarjeta con hijas). */
  alAbrirFicha: () => void;
};

export type NodoDeTarjeta = Node<DatosNodoTarjeta, "tarjeta">;

const ESPERA_PRESIONADO = 500;
const TOLERANCIA_MOVIMIENTO = 8;

/** Las líneas de contadores: "76 te toca · 1 en curso" y "21 siguen"; "sin tareas" si todo es 0. */
export function lineasDeContadores({ teToca, enCurso, siguen, hecho }: Contadores): string[] {
  const primera = [teToca ? `${teToca} te toca` : null, enCurso ? `${enCurso} en curso` : null].filter(Boolean).join(" · ");
  const segunda = siguen ? `${siguen} ${siguen === 1 ? "sigue" : "siguen"}` : "";
  const lineas = [primera, segunda].filter(Boolean);
  if (lineas.length) return lineas;
  return [hecho ? `${hecho} ${hecho === 1 ? "hecha" : "hechas"}` : "sin tareas"];
}

/**
 * Una tarjeta en el mapa como ETIQUETA de solo texto, al estilo del tablero "Tareas Magilus": el
 * nombre en negrita (hasta 3 líneas; entero al pasar el mouse) y debajo los contadores que no son cero. Borde fino ROJO si tiene algo que "te
 * toca"; neutro si no. La del centro (el nivel actual) es más grande y va en contraste (clara en
 * oscuro, oscura en claro). Ancho según el texto, sin pasar de las medidas de services/disposicion.ts.
 * Mantener presionada una con hijas abre su ficha sin entrar.
 *
 * El tipo se ve en la tarjeta (Emanuel, 22-10-2026): su ícono en su color al lado del título y una
 * franja fina de ese color arriba. Antes solo la ficha lo mostraba y en el mapa una "Asesora" no se
 * distinguía de una "Tarea". El borde rojo de "te toca" no cambia.
 */
function NodoTarjetaBase({ data, selected }: NodeProps<NodoDeTarjeta>) {
  const lineas = lineasDeContadores(data.contadores);
  const teToca = data.contadores.teToca > 0;
  const centro = data.esNivel;

  // Mantener presionado: abre la ficha y se come el toque que viene después (no entra).
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const disparado = useRef(false);
  const cancelar = () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    inicio.current = null;
  };

  return (
    <div
      style={{
        maxWidth: centro ? ANCHO_CENTRO : ANCHO_TARJETA,
        minWidth: centro ? 120 : 90,
      }}
      className={cn(
        "relative flex w-max select-none flex-col items-center justify-center overflow-hidden rounded-md border text-center leading-tight transition-opacity [-webkit-touch-callout:none]",
        centro
          ? "min-h-14 gap-0.5 border-zinc-900 bg-zinc-900 px-4 py-2 text-zinc-50 shadow-md dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
          : "min-h-11 border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        !centro && teToca && "border-rose-600 dark:border-rose-500",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        data.atenuado && "opacity-25",
      )}
      onPointerDown={(evento) => {
        disparado.current = false;
        if (centro || data.hijas === 0) return;
        inicio.current = { x: evento.clientX, y: evento.clientY };
        temporizador.current = setTimeout(() => {
          disparado.current = true;
          temporizador.current = null;
          data.alAbrirFicha();
        }, ESPERA_PRESIONADO);
      }}
      onPointerMove={(evento) => {
        const desde = inicio.current;
        if (desde && Math.hypot(evento.clientX - desde.x, evento.clientY - desde.y) > TOLERANCIA_MOVIMIENTO) cancelar();
      }}
      onPointerUp={cancelar}
      onPointerLeave={cancelar}
      onPointerCancel={cancelar}
      title={data.titulo}
      onContextMenu={(evento) => evento.preventDefault()}
      onClickCapture={(evento) => {
        if (!disparado.current) return;
        disparado.current = false;
        evento.stopPropagation();
      }}
    >
      {/* Las líneas se dibujan solas: los puntos de conexión no se muestran ni se arrastran. */}
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      {data.color && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: data.color }} />
      )}
      {/* El título: hasta 3 líneas (con o sin contadores) y entero al pasar el mouse. */}
      <div className="flex max-w-full items-center justify-center gap-1">
        {(data.color || data.icono) && (
          <IconoDeTipo
            icono={data.icono}
            color={data.color ?? undefined}
            className={cn("shrink-0", centro ? "size-4" : "size-3.5")}
          />
        )}
        <p className={cn("line-clamp-3 min-w-0 break-words font-semibold", centro ? "text-sm" : "text-xs")}>{data.titulo}</p>
      </div>
      {lineas.map((linea) => (
        <p
          key={linea}
          className={cn(
            "max-w-full truncate tabular-nums",
            centro ? "text-xs opacity-80" : "text-[11px] text-zinc-500 dark:text-zinc-400",
          )}
        >
          {linea}
        </p>
      ))}
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" isConnectable={false} />
    </div>
  );
}

export const NodoTarjeta = memo(NodoTarjetaBase);
