"use client";

import { useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";

import { COLORES_DE_IDEA, cajaDelColor } from "./colores";

/**
 * Una idea del mapa: una caja con texto que se escribe encima.
 *
 * El texto se edita EN LA CAJA, no en un panel al costado: en un mapa mental uno escribe mientras
 * mira el conjunto, y mandar la escritura a otro lado rompe justo eso.
 *
 * La caja crece con el texto. Un alto fijo obligaba a resumir la idea para que entrara, que es lo
 * contrario de para qué sirve esto.
 */
export function NodoIdea({
  id,
  data,
  selected,
  onTexto,
  onColor,
  onBorrar,
}: NodeProps & {
  onTexto: (id: string, texto: string) => void;
  onColor: (id: string, color: string) => void;
  onBorrar: (id: string) => void;
}) {
  const texto = typeof data?.texto === "string" ? data.texto : "";
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const ajustarAlto = () => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };

  useEffect(ajustarAlto, [texto]);

  // Una caja recién creada llega vacía: se le pone el cursor adentro para poder escribir de una,
  // sin un clic extra.
  useEffect(() => {
    if (!texto) {
      areaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`group relative min-w-[150px] max-w-[240px] rounded-xl border px-3 py-2 shadow-sm transition ${cajaDelColor(
        data?.color,
      )} ${selected ? "ring-1 ring-primary/40" : ""}`}
    >
      {/*
        La paleta aparece SOLO con la caja seleccionada. Seis puntitos permanentes en cada idea
        convertian el mapa en una grilla de colorcitos y tapaban lo unico que importa, que es lo
        que dice cada caja.
      */}
      {selected ? (
        <div className="nodrag absolute -top-8 left-0 flex items-center gap-1 rounded-full border border-border bg-popover px-1.5 py-1 shadow-sm">
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
      ) : null}
      {/* Los cuatro bordes conectan: un mapa mental crece para cualquier lado, y obligar a que las
          uniones salgan siempre de abajo lo endereza en un organigrama. */}
      <Handle type="target" position={Position.Top} className="!size-2 !bg-muted-foreground/50" />
      <Handle type="target" position={Position.Left} className="!size-2 !bg-muted-foreground/50" />

      <textarea
        ref={areaRef}
        value={texto}
        onChange={(evento) => onTexto(id, evento.target.value)}
        onInput={ajustarAlto}
        rows={1}
        placeholder="Escribí acá…"
        // nodrag: sin esto, arrastrar para seleccionar texto movia la caja entera.
        className="nodrag w-full resize-none bg-transparent text-[13px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
      />

      <button
        type="button"
        onClick={() => onBorrar(id)}
        aria-label="Borrar esta idea"
        title="Borrar"
        className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition hover:text-destructive group-hover:flex max-sm:flex"
      >
        <X className="size-3" />
      </button>

      <Handle type="source" position={Position.Right} className="!size-2 !bg-muted-foreground/50" />
      <Handle type="source" position={Position.Bottom} className="!size-2 !bg-muted-foreground/50" />
    </div>
  );
}
