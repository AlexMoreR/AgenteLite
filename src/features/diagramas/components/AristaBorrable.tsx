"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";
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
/**
 * Cuanto se le perdona a una linea para seguir considerandola derecha.
 *
 * Es la desalineacion en pixeles entre los dos puntos. Por debajo de esto la recta se ve
 * horizontal o vertical y limpia; por encima empieza a inclinarse y se nota.
 */
const TOLERANCIA_DE_ALINEACION = 14;

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
    Recta solo si los dos puntos estan ALINEADOS; si no, angulo recto.

    Lo que afea una union no es que sea larga, es que vaya en diagonal: una linea inclinada entre
    dos cajas parece dibujada a mano y se cruza con las demas. Cuando los puntos comparten fila o
    columna, la recta se ve impecable a cualquier distancia.

    (Primero se probo decidir por distancia y quedaba mal: las diagonales cortas seguian feas.)
  */
  const desvioVertical = Math.abs(targetY - sourceY);
  const desvioHorizontal = Math.abs(targetX - sourceX);
  const estaAlineado =
    desvioVertical <= TOLERANCIA_DE_ALINEACION || desvioHorizontal <= TOLERANCIA_DE_ALINEACION;

  const [camino, centroX, centroY] =
    !estaAlineado
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 8,
        })
      : getStraightPath({ sourceX, sourceY, targetX, targetY });

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
