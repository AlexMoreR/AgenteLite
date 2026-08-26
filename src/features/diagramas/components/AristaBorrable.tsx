"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";

/**
 * Una unión entre dos ideas, con su botón para quitarla.
 *
 * El botón vive EN LA LÍNEA y no en un menú: una conexión mal hecha se ve al instante y se quiere
 * deshacer ahí mismo. La alternativa de React Flow —seleccionar la línea y apretar Suprimir— no
 * existe en un celular, que es donde más se usa esto.
 *
 * Está siempre a la vista, apenas marcado: esconderlo hasta pasar el mouse por encima lo volvía
 * un blanco invisible, y en el celular directamente no hay "pasar por encima".
 */
export function AristaBorrable({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
  onBorrar,
}: EdgeProps & { onBorrar: (id: string) => void }) {
  const [camino, centroX, centroY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={camino} markerEnd={markerEnd} style={style} />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${centroX}px, ${centroY}px)`,
          }}
          // nopan: sin esto, tocar el boton arrastraba el lienzo entero.
          className="nopan pointer-events-auto"
        >
          <button
            type="button"
            onClick={(evento) => {
              evento.stopPropagation();
              onBorrar(id);
            }}
            aria-label="Quitar esta conexión"
            title="Quitar conexión"
            /* Siempre visible, apenas marcado. Esconderlo hasta pasar por encima lo volvia un
               blanco invisible: habia que adivinar donde estaba para poder verlo. */
            className={`inline-flex size-5 items-center justify-center rounded-full border border-border bg-background shadow-sm transition hover:scale-110 hover:text-destructive ${
              selected ? "text-destructive" : "text-muted-foreground/70"
            }`}
          >
            <X className="size-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
