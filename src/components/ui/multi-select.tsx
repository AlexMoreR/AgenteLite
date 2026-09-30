"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Un "select" donde se pueden marcar varias opciones.
 *
 * La lista se despliega DEBAJO del campo, en el mismo lugar, y no flotando encima: está pensado
 * para usarse dentro de modales, y un menú flotante (Popover, de Radix) dentro de un modal de Base
 * UI se cuenta como "clic afuera" y cierra el modal. Desplegado en línea además se usa mejor con
 * el dedo en el celular: no se corta contra el borde ni tapa lo que hay abajo.
 */

export type OpcionMultiple = { value: string; label: string };

type Props = {
  opciones: OpcionMultiple[];
  valor: string[];
  alCambiar: (valor: string[]) => void;
  /** Lo que dice el campo cuando no hay nada marcado. */
  placeholder: string;
  /** Nombre de lo que se elige en plural, para el resumen del campo ("3 asesoras"). */
  plural?: string;
  className?: string;
};

export function MultiSelect({ opciones, valor, alCambiar, placeholder, plural = "elegidas", className }: Props) {
  const [abierto, setAbierto] = React.useState(false);
  const idDeLaLista = React.useId();

  const elegidas = opciones.filter((opcion) => valor.includes(opcion.value));
  // Hasta dos nombres se leen enteros; con más, el campo se volvería un renglón que no entra.
  const resumen =
    elegidas.length === 0
      ? placeholder
      : elegidas.length <= 2
        ? elegidas.map((opcion) => opcion.label).join(", ")
        : `${elegidas.length} ${plural}`;

  const alternar = (opcion: string) => {
    alCambiar(valor.includes(opcion) ? valor.filter((actual) => actual !== opcion) : [...valor, opcion]);
  };

  return (
    <div className={cn("rounded-lg border border-input bg-background", className)}>
      <button
        type="button"
        onClick={() => setAbierto((actual) => !actual)}
        aria-expanded={abierto}
        aria-controls={idDeLaLista}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className={cn("min-w-0 truncate", elegidas.length === 0 ? "text-muted-foreground" : "text-foreground")}>
          {resumen}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")}
        />
      </button>

      {abierto ? (
        <div id={idDeLaLista} role="listbox" aria-multiselectable="true" className="border-t border-border p-1">
          {opciones.map((opcion) => {
            const marcada = valor.includes(opcion.value);
            return (
              <button
                key={opcion.value}
                type="button"
                role="option"
                aria-selected={marcada}
                onClick={() => alternar(opcion.value)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] text-foreground transition hover:bg-muted"
              >
                {/* Solo se dibuja: el toque lo maneja la fila entera, que es más fácil de acertar. */}
                <Checkbox checked={marcada} tabIndex={-1} aria-hidden className="pointer-events-none" />
                <span className="min-w-0 truncate">{opcion.label}</span>
              </button>
            );
          })}
          {valor.length > 0 ? (
            <button
              type="button"
              onClick={() => alCambiar([])}
              className="mt-0.5 w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-primary hover:bg-muted"
            >
              Quitar selección
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
