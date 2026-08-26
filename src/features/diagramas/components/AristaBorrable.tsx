"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";

/**
 * Una unión entre dos ideas, con su botón para quitarla.
 *
 * El botón vive EN LA LÍNEA y no en un menú: una conexión mal hecha se ve al instante y se quiere
 * deshacer ahí mismo. La alternativa de React Flow —seleccionar la línea y apretar Suprimir— no
 * existe en un celular, que es donde más se usa esto.
 *
 * Aparece al TOCAR la línea, no siempre: en un mapa con veinte uniones eran veinte cruces
 * flotando entre las cajas, y competían con lo que uno está leyendo. Al seleccionarla, la línea
 * entera se pone roja junto con su cruz, así queda claro cuál se va a borrar.
 *
 * La línea es fina pero tiene una banda invisible mucho más ancha alrededor (interactionWidth),
 * que es lo que hace posible acertarle con el dedo.
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
  /*
    Lineas escalonadas y no curvas: en un mapa con varias ramas las curvas se cruzan entre si y
    cuesta seguir cual sale de donde. Los angulos rectos, con la esquina apenas redondeada, se
    leen como un diagrama de flujo.
  */
  const [camino, centroX, centroY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={camino}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{
          ...style,
          ...(selected ? { stroke: "var(--destructive)", strokeWidth: 2 } : {}),
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${centroX}px, ${centroY}px)`,
          }}
          // nopan: sin esto, tocar el boton arrastraba el lienzo entero.
          className={`nopan ${selected ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <button
            type="button"
            onClick={(evento) => {
              evento.stopPropagation();
              onBorrar(id);
            }}
            aria-label="Quitar esta conexión"
            title="Quitar conexión"
            className={`inline-flex size-5 items-center justify-center rounded-full border shadow-sm transition ${
              selected
                ? "border-destructive bg-destructive text-white opacity-100 hover:scale-110"
                : "border-border bg-background opacity-0"
            }`}
          >
            <X className="size-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
