"use client";

import { useRef } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

/*
  El valor de una condición o una acción, como en Chatwoot: una caja con buscador.
  - Múltiple: lo elegido son chips con × DENTRO de la caja; al tocarla se abre la lista y se
    escribe para filtrar (Enter elige el primero).
  - Único: un botón con lo elegido; al tocarlo se abre la lista con su propio buscador.
  Es el Combobox de Base UI, la misma librería del modal: así la lista flotante no cuenta como
  "clic afuera" y no cierra el modal.
*/

export type OpcionDeSelector = { value: string; label: string };

const igual = (a: OpcionDeSelector, b: OpcionDeSelector) => a.value === b.value;

/** Un id que ya no está en el catálogo (p. ej. una etiqueta borrada) se sigue viendo y no se pierde al editar. */
function aOpcion(opciones: OpcionDeSelector[], id: string): OpcionDeSelector {
  return opciones.find((opcion) => opcion.value === id) ?? { value: id, label: "(ya no existe)" };
}

function ListaDeOpciones({ conBuscador = false }: { conBuscador?: boolean }) {
  return (
    <Combobox.Popup className="w-(--anchor-width) min-w-56 max-h-[min(20rem,var(--available-height))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none flex flex-col">
      {conBuscador ? (
        <div className="border-b border-border p-1.5">
          <Combobox.Input
            placeholder="Seleccionar"
            aria-label="Buscar"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
      ) : null}
      <Combobox.Empty className="px-3 text-sm text-muted-foreground empty:p-0 [&:not(:empty)]:py-3">Sin resultados</Combobox.Empty>
      <Combobox.List className="min-h-0 flex-1 overflow-y-auto p-1 empty:p-0">
        {(opcion: OpcionDeSelector) => (
          <Combobox.Item
            key={opcion.value}
            value={opcion}
            className="flex min-h-11 cursor-default items-center gap-2 rounded-lg px-3 text-sm text-foreground outline-none select-none data-[highlighted]:bg-muted data-[selected]:font-medium data-[selected]:text-[var(--primary)]"
          >
            <span className="min-w-0 flex-1 truncate">{opcion.label}</span>
            <Combobox.ItemIndicator>
              <CheckIcon className="size-4 text-[var(--primary)]" />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      </Combobox.List>
    </Combobox.Popup>
  );
}

export function SelectorMultiple({
  opciones,
  valores,
  alCambiar,
  etiqueta,
  className,
}: {
  opciones: OpcionDeSelector[];
  valores: string[];
  alCambiar: (valores: string[]) => void;
  /** Nombre accesible de la caja ("Etapas", "Asesoras"…). */
  etiqueta: string;
  className?: string;
}) {
  const ancla = useRef<HTMLDivElement>(null);
  const seleccion = valores.map((id) => aOpcion(opciones, id));

  return (
    <Combobox.Root
      multiple
      items={opciones}
      value={seleccion}
      onValueChange={(nuevas: OpcionDeSelector[]) => alCambiar(nuevas.map((opcion) => opcion.value))}
      isItemEqualToValue={igual}
      autoHighlight
    >
      <Combobox.Chips
        ref={ancla}
        className={cn(
          "flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1 py-0.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        <Combobox.Value>
          {(elegidas: OpcionDeSelector[]) => (
            <>
              {elegidas.map((opcion) => (
                <Combobox.Chip
                  key={opcion.value}
                  aria-label={opcion.label}
                  className="flex h-6 max-w-full items-center gap-0.5 rounded-md bg-muted pl-2 text-[12px] font-medium text-foreground outline-none data-[highlighted]:bg-[var(--primary)]/15"
                >
                  <span className="min-w-0 truncate">{opcion.label}</span>
                  <Combobox.ChipRemove
                    aria-label={`Quitar ${opcion.label}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  >
                    <X className="size-3" />
                  </Combobox.ChipRemove>
                </Combobox.Chip>
              ))}
              <Combobox.Input
                aria-label={etiqueta}
                placeholder={elegidas.length === 0 ? "Seleccionar" : ""}
                className="h-7 min-w-16 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </>
          )}
        </Combobox.Value>
      </Combobox.Chips>
      <Combobox.Portal>
        <Combobox.Positioner anchor={ancla} sideOffset={4} className="z-[60]">
          <ListaDeOpciones />
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export function SelectorUnico({
  opciones,
  valor,
  alCambiar,
  placeholder,
  etiqueta,
  className,
}: {
  opciones: OpcionDeSelector[];
  /** "" = nada elegido todavía. */
  valor: string;
  alCambiar: (valor: string) => void;
  placeholder: string;
  etiqueta: string;
  className?: string;
}) {
  const seleccion = valor ? aOpcion(opciones, valor) : null;

  return (
    <Combobox.Root
      items={opciones}
      value={seleccion}
      onValueChange={(nueva: OpcionDeSelector | null) => {
        if (nueva) alCambiar(nueva.value);
      }}
      isItemEqualToValue={igual}
      autoHighlight
    >
      <Combobox.Trigger
        aria-label={etiqueta}
        className={cn(
          "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", seleccion ? "text-foreground" : "text-muted-foreground")}>
          {seleccion ? seleccion.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-[60]">
          <ListaDeOpciones conBuscador />
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
