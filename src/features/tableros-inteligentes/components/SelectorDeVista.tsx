"use client";

import { CalendarDays, Columns3, Network, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { NOMBRE_DE_LA_VISTA, VISTAS, type Vista } from "../services/vistas-de-tabla";

const ICONO: Record<Vista, typeof Table2> = {
  tabla: Table2,
  tablero: Columns3,
  calendario: CalendarDays,
  mapa: Network,
};

type Props = {
  vista: Vista;
  alElegir: (vista: Vista) => void;
};

/**
 * Las vistas del tablero, como pestañas: Tabla (la principal), Tablero (kanban), Calendario y Mapa (el
 * diagrama). Las cuatro muestran las mismas tarjetas. En el celular se deslizan de lado.
 */
export function SelectorDeVista({ vista, alElegir }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Vista del tablero"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5 [scrollbar-width:none]"
    >
      {VISTAS.map((opcion) => {
        const Icono = ICONO[opcion];
        const activa = opcion === vista;
        return (
          <button
            key={opcion}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => alElegir(opcion)}
            className={cn(
              "flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium md:min-h-8",
              activa ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icono className="size-4 shrink-0" aria-hidden />
            {NOMBRE_DE_LA_VISTA[opcion]}
          </button>
        );
      })}
    </div>
  );
}
