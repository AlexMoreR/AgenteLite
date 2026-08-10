"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Elegir QUE PERIODO mirar en el tablero.
 *
 * Antes era un dia suelto, y para saber "como me fue esta semana" habia que abrirlo siete veces y
 * sumar de cabeza. Los atajos de la izquierda cubren lo que se pregunta todos los dias; el
 * calendario queda para el caso raro.
 */

const BOGOTA = "America/Bogota";

/** El dia en Bogota, en el formato del calendario (YYYY-MM-DD). */
function comoTexto(fecha: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA }).format(fecha);
}

function hace(dias: number) {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

const ATAJOS: Array<{ etiqueta: string; rango: () => { desde: Date; hasta: Date } }> = [
  { etiqueta: "Hoy", rango: () => ({ desde: new Date(), hasta: new Date() }) },
  { etiqueta: "Ayer", rango: () => ({ desde: hace(1), hasta: hace(1) }) },
  { etiqueta: "Últimos 7 días", rango: () => ({ desde: hace(6), hasta: new Date() }) },
  { etiqueta: "Últimos 30 días", rango: () => ({ desde: hace(29), hasta: new Date() }) },
  { etiqueta: "Este mes", rango: () => {
      const hoy = new Date();
      return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1), hasta: hoy };
    },
  },
];

/** "9 ago 2026", o "3 – 9 ago 2026" cuando es un rango. */
function rotulo(desde: string, hasta: string) {
  const formato = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const inicio = formato.format(new Date(`${desde}T12:00:00Z`));
  if (desde === hasta) {
    return inicio;
  }
  return `${inicio} – ${formato.format(new Date(`${hasta}T12:00:00Z`))}`;
}

export function SelectorDeRango({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<DateRange | undefined>({
    from: new Date(`${desde}T12:00:00Z`),
    to: new Date(`${hasta}T12:00:00Z`),
  });

  const aplicar = (inicio: Date, fin: Date) => {
    setAbierto(false);
    router.push(`/cliente/mi-tablero?desde=${comoTexto(inicio)}&hasta=${comoTexto(fin)}`);
  };

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[13px] text-foreground transition hover:bg-muted"
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          {rotulo(desde, hasta)}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto p-0">
        {/* Los atajos arriba en el celular y a la izquierda en escritorio: dos meses de calendario
            al lado de una columna no entran en 360px. */}
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b border-border p-2 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {ATAJOS.map((atajo) => (
              <button
                key={atajo.etiqueta}
                type="button"
                onClick={() => {
                  const { desde: inicio, hasta: fin } = atajo.rango();
                  aplicar(inicio, fin);
                }}
                className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition hover:bg-muted"
              >
                {atajo.etiqueta}
              </button>
            ))}
          </div>

          <div className="p-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={borrador?.from}
              selected={borrador}
              onSelect={setBorrador}
              // Un rango futuro no tiene datos: no se puede elegir.
              disabled={{ after: new Date() }}
              className="[--cell-size:2rem] sm:[--cell-size:2.25rem]"
            />

            <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!borrador?.from}
                onClick={() => {
                  if (!borrador?.from) return;
                  // Un solo dia elegido = ese dia, no un rango a medias.
                  aplicar(borrador.from, borrador.to ?? borrador.from);
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
