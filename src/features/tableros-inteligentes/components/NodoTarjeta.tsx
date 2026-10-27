"use client";

import { memo, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import { ANCHO_CENTRO, ANCHO_TARJETA } from "../services/disposicion";
import type { Contadores } from "../services/niveles";
import { colorDeTipoValido, inicialDeLaPersona } from "../services/reglas";
import { IconoDeTipo } from "./IconoDeTipo";

export type DatosNodoTarjeta = {
  titulo: string;
  /** Cuántas hijas (no borradas) tiene: si tiene, tocarla entra a su nivel. */
  hijas: number;
  /** Ella y toda su descendencia (services/niveles.ts, contadoresRecursivos). */
  contadores: Contadores;
  /** Es la tarjeta del nivel actual (la del centro): tocarla abre su ficha. */
  esNivel: boolean;
  atenuado: boolean;
  /** El nombre de su responsable (se dibuja su inicial en un circulito); null si no tiene. */
  responsable: string | null;
  /** Color (hex), ícono y nombre de su tipo: pintan la tarjeta. */
  colorTipo: string | null;
  iconoTipo: string | null;
  nombreTipo: string | null;
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
 * nombre en negrita (hasta 3 líneas; entero al pasar el mouse) y debajo los contadores que no son cero. Fondo blanco y borde gris suave, con el color del tipo solo en el ícono; si tiene algo que "te toca" el borde es rojo.
 * La del centro (el nivel actual) es más grande y con borde más marcado. Ancho según el texto, sin pasar de las medidas de services/disposicion.ts.
 * Mantener presionada una con hijas abre su ficha sin entrar.
 */
function NodoTarjetaBase({ data, selected }: NodeProps<NodoDeTarjeta>) {
  const lineas = lineasDeContadores(data.contadores);
  const teToca = data.contadores.teToca > 0;
  const centro = data.esNivel;
  const colorTipo = colorDeTipoValido(data.colorTipo);

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
        // Todas blancas (superficie de tarjeta en oscuro) con borde gris suave; el color del tipo va solo en el ícono.
        "bg-card text-zinc-900 dark:text-zinc-100",
        centro ? "min-h-14 gap-0.5 border-2 px-4 py-2 shadow-md" : "min-h-11 border px-2.5 py-1.5",
        teToca
          ? "border-rose-600 dark:border-rose-500"
          : centro
            ? "border-zinc-400 dark:border-zinc-600"
            : "border-zinc-300 dark:border-zinc-700",
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
      title={data.nombreTipo ? `${data.nombreTipo}: ${data.titulo}` : data.titulo}
      onContextMenu={(evento) => evento.preventDefault()}
      onClickCapture={(evento) => {
        if (!disparado.current) return;
        disparado.current = false;
        evento.stopPropagation();
      }}
    >
      {/* Las líneas se dibujan solas: los puntos de conexión no se muestran ni se arrastran. */}
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      {data.responsable ? (
        <span
          className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-semibold leading-none text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
          title={`Responsable: ${data.responsable}`}
          aria-label={`Responsable: ${data.responsable}`}
        >
          {inicialDeLaPersona(data.responsable)}
        </span>
      ) : null}
      {/* El título: hasta 3 líneas (con o sin contadores) y entero al pasar el mouse. */}
      <p className={cn("line-clamp-3 max-w-full break-words font-semibold", centro ? "text-sm font-bold" : "text-xs")}>
        {colorTipo ? (
          <IconoDeTipo icono={data.iconoTipo} color={colorTipo} className="mr-1 -mt-0.5 inline-block size-3.5 align-middle" />
        ) : null}
        {data.titulo}
      </p>
      {lineas.map((linea) => (
        <p
          key={linea}
          className={cn(
            "max-w-full truncate tabular-nums text-zinc-500 dark:text-zinc-400",
            centro ? "text-xs" : "text-[11px]",
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
