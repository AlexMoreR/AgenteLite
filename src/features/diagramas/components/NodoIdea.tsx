"use client";

import { useEffect, useRef } from "react";
import { Handle, NodeResizeControl, Position, type NodeProps } from "@xyflow/react";
import { Bold, X } from "lucide-react";

import { COLORES_DE_IDEA, cajaDelColor } from "./colores";
import { ICONOS_DE_IDEA } from "./iconos";
import { TextoConNegrita } from "./TextoConNegrita";

/**
 * Una idea del mapa: una caja con texto que se escribe encima.
 *
 * El texto se edita EN LA CAJA, no en un panel al costado: en un mapa mental uno escribe mientras
 * mira el conjunto, y mandar la escritura a otro lado rompe justo eso.
 *
 * Mientras la caja está seleccionada se ve el texto CRUDO, con sus asteriscos, para poder
 * editarlo; al soltarla se ve ya formateado. Es el mismo ida y vuelta de cualquier editor y evita
 * el enredo de escribir encima de texto con formato.
 */
const PUNTOS = [
  { posicion: Position.Top, clave: "arriba" },
  { posicion: Position.Right, clave: "derecha" },
  { posicion: Position.Bottom, clave: "abajo" },
  { posicion: Position.Left, clave: "izquierda" },
] as const;

export function NodoIdea({
  id,
  data,
  selected,
  onTexto,
  onColor,
  onIcono,
  onBorrar,
}: NodeProps & {
  onTexto: (id: string, texto: string) => void;
  onColor: (id: string, color: string) => void;
  onIcono: (id: string, icono: string) => void;
  onBorrar: (id: string) => void;
}) {
  const texto = typeof data?.texto === "string" ? data.texto : "";
  const icono = typeof data?.icono === "string" ? data.icono : "";
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const ajustarAlto = () => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };

  useEffect(ajustarAlto, [texto, selected]);

  // Una caja recién creada llega vacía: se le pone el cursor adentro para poder escribir de una,
  // sin un clic extra.
  useEffect(() => {
    if (!texto) {
      areaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Poner en negrita lo seleccionado, envolviéndolo en asteriscos.
   *
   * Se usa la misma marca que WhatsApp (*así*) y no HTML: es la que él escribe todos los días, y
   * deja el contenido como texto plano, sin etiquetas que después haya que limpiar.
   */
  const alternarNegrita = () => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const desde = area.selectionStart;
    const hasta = area.selectionEnd;
    if (desde === hasta) {
      return;
    }
    const elegido = texto.slice(desde, hasta);
    const yaEstaba = elegido.startsWith("*") && elegido.endsWith("*") && elegido.length > 2;
    const nuevo = yaEstaba
      ? `${texto.slice(0, desde)}${elegido.slice(1, -1)}${texto.slice(hasta)}`
      : `${texto.slice(0, desde)}*${elegido}*${texto.slice(hasta)}`;
    onTexto(id, nuevo);
    // Se devuelve el foco para poder seguir escribiendo sin volver a tocar la caja.
    requestAnimationFrame(() => area.focus());
  };

  return (
    <div
      className={`group relative flex size-full min-h-[52px] min-w-[150px] flex-col rounded-xl border px-3 py-2 shadow-sm transition ${cajaDelColor(
        data?.color,
      )} ${selected ? "ring-1 ring-primary/40" : ""}`}
    >
      {/*
        La barra aparece SOLO con la caja seleccionada. Permanente en cada idea convertía el mapa
        en una grilla de controles y tapaba lo único que importa, que es lo que dice cada caja.
      */}
      {selected ? (
        <div className="nodrag nopan absolute -top-[4.5rem] left-0 flex w-max flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md">
          <div className="flex items-center gap-1">
            {ICONOS_DE_IDEA.map((opcion) => (
              <button
                key={opcion}
                type="button"
                onClick={() => onIcono(id, icono === opcion ? "" : opcion)}
                title={icono === opcion ? "Quitar el ícono" : "Poner este ícono"}
                className={`flex size-6 items-center justify-center rounded-md text-sm transition hover:bg-muted ${
                  icono === opcion ? "bg-muted ring-1 ring-foreground/30" : ""
                }`}
              >
                {opcion}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={alternarNegrita}
              title="Negrita: seleccioná el texto primero"
              aria-label="Poner en negrita"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Bold className="size-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            {COLORES_DE_IDEA.map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => onColor(id, opcion.valor)}
                aria-label={opcion.nombre}
                title={opcion.nombre}
                className={`size-3.5 rounded-full border transition hover:scale-125 ${opcion.punto} ${
                  data?.color === opcion.valor || (!data?.color && opcion.valor === "neutro")
                    ? "ring-1 ring-foreground/40 ring-offset-1"
                    : ""
                }`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/*
        Los cuatro bordes conectan, y cada uno sirve para SALIR y para ENTRAR.

        Van dos conectores superpuestos por punto porque React Flow le da UN solo rol a cada uno.
        El de salida queda encima para que arrastrar empiece una unión; al soltar, la librería
        busca el conector válido más cercano.
      */}
      {PUNTOS.map(({ posicion, clave }) => (
        <div key={clave}>
          <Handle
            type="target"
            id={`${clave}-in`}
            position={posicion}
            className="!size-2.5 !border-0 !bg-muted-foreground/40 transition hover:!bg-primary"
          />
          <Handle
            type="source"
            id={`${clave}-out`}
            position={posicion}
            className="!size-2.5 !border-0 !bg-muted-foreground/40 transition hover:!bg-primary"
          />
        </div>
      ))}

      {/* overflow-auto: una vez que la caja tiene un tamano fijo puesto a mano, un texto largo
          se desbordaria por fuera del borde. Asi se desplaza adentro. */}
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-auto">
        {icono ? (
          <span className="shrink-0 select-none text-base leading-snug" aria-hidden="true">
            {icono}
          </span>
        ) : null}

        {selected ? (
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(evento) => onTexto(id, evento.target.value)}
            onInput={ajustarAlto}
            rows={1}
            placeholder="Escribí acá…"
            // nodrag: sin esto, arrastrar para seleccionar texto movía la caja entera.
            className="nodrag min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <TextoConNegrita
            texto={texto}
            vacio="Escribí acá…"
            className="min-h-0 w-full flex-1 whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground"
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => onBorrar(id)}
        aria-label="Borrar esta idea"
        title="Borrar"
        className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition hover:text-destructive group-hover:flex max-sm:flex"
      >
        <X className="size-3" />
      </button>

      {/*
        La manija para estirar la caja, en la esquina de abajo a la derecha. Solo con la caja
        seleccionada: manijas siempre visibles en cada idea ensucian el mapa, y estirar es algo
        que se hace cuando uno ya eligió esa caja.
      */}
      {selected ? (
        <NodeResizeControl
          position="bottom-right"
          minWidth={150}
          minHeight={52}
          style={{ background: "transparent", border: "none" }}
        >
          <span className="absolute -bottom-1 -right-1 size-3 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-muted-foreground/60" />
        </NodeResizeControl>
      ) : null}
    </div>
  );
}
