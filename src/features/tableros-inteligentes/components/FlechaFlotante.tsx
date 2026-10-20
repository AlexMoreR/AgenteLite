"use client";

import { memo } from "react";
import { BaseEdge, getStraightPath, useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";

/*
  Una flecha del Tablero IA: RECTA y "flotante".

  No sale siempre de abajo ni llega siempre arriba: va del borde de la tarjeta de origen al borde
  de la de destino, por el lado que queda mirando a la otra (la recta entre los dos centros, cortada
  donde toca cada rectángulo). Así nunca da la vuelta por detrás de una tarjeta.

  Encima de la línea viaja UN solo punto del origen al destino (clase `tablero-ia-flujo` de
  globals.css): es solo CSS (stroke-dashoffset sobre pathLength=100), sin JS por cuadro, y con
  `prefers-reduced-motion: reduce` el punto queda quieto en la mitad de la línea. Las líneas
  atenuadas por el filtro no llevan punto. Sin puntas de flecha.

  La misma recta sirve para la UNIÓN CON LA MADRE (`data.clase = "madre"`): del centro a cada hija,
  fina y gris; el punto es rojo si la hija tiene algo que "te toca" y gris si no.
*/

/** `color` puede ser un color o una variable CSS ("var(--tia-rojo)"): va por style, no como atributo. */
export type DatosFlecha = { color: string; atenuada: boolean; clase?: "flecha" | "madre"; conPunto?: boolean };
export type FlechaDeTablero = Edge<DatosFlecha, "flotante">;

type Rect = { cx: number; cy: number; mitadAncho: number; mitadAlto: number };

function rectDe(nodo: InternalNode): Rect {
  const ancho = nodo.measured.width ?? 200;
  const alto = nodo.measured.height ?? 100;
  return {
    cx: nodo.internals.positionAbsolute.x + ancho / 2,
    cy: nodo.internals.positionAbsolute.y + alto / 2,
    mitadAncho: ancho / 2,
    mitadAlto: alto / 2,
  };
}

/** Dónde corta el borde de `desde` la recta que va de su centro al centro de `hacia`. */
function bordeHacia(desde: Rect, hacia: Rect) {
  const dx = hacia.cx - desde.cx;
  const dy = hacia.cy - desde.cy;
  if (dx === 0 && dy === 0) return { x: desde.cx, y: desde.cy };
  const escala = Math.min(
    dx === 0 ? Infinity : desde.mitadAncho / Math.abs(dx),
    dy === 0 ? Infinity : desde.mitadAlto / Math.abs(dy),
  );
  return { x: desde.cx + dx * escala, y: desde.cy + dy * escala };
}

function FlechaFlotanteBase({ id, source, target, style, data }: EdgeProps<FlechaDeTablero>) {
  const origen = useInternalNode(source);
  const destino = useInternalNode(target);
  if (!origen || !destino) return null;

  const a = rectDe(origen);
  const b = rectDe(destino);
  const inicio = bordeHacia(a, b);
  const fin = bordeHacia(b, a);
  const [camino] = getStraightPath({ sourceX: inicio.x, sourceY: inicio.y, targetX: fin.x, targetY: fin.y });

  return (
    <>
      <BaseEdge id={id} path={camino} style={style} />
      {data && !data.atenuada && data.conPunto !== false ? (
        <path d={camino} pathLength={100} className="tablero-ia-flujo" style={{ stroke: data.color }} fill="none" aria-hidden />
      ) : null}
    </>
  );
}

export const FlechaFlotante = memo(FlechaFlotanteBase);
