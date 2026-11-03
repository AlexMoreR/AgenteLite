"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { diaDeLaFecha, filasPorDia, type FilaDeTabla } from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";

/*
  La vista CALENDARIO del Tablero IA: el mes con cada tarjeta en el día de su fecha (hora de Colombia) y,
  aparte, las tarjetas "Sin fecha". Tocar una tarjeta la abre como página. En el computador se ve la
  cuadrícula del mes; en el celular, la lista de los días del mes que tienen tarjetas.
*/

const SEMANA = { weekStartsOn: 1 as const };
const DIAS_DE_LA_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function Chip({ fila, alAbrir }: { fila: FilaDeTabla; alAbrir: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => alAbrir(fila.id)}
      title={`${fila.codigo ? `${fila.codigo} · ` : ""}${fila.titulo}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs hover:bg-muted md:py-0.5",
        fila.estado ? COLOR_DEL_ESTADO[fila.estado].tarjeta : "border-border bg-card",
      )}
    >
      {fila.estado ? <span className={cn("size-1.5 shrink-0 rounded-full", COLOR_DEL_ESTADO[fila.estado].punto)} aria-hidden /> : null}
      <span className="truncate">{fila.titulo}</span>
    </button>
  );
}

export function VistaCalendario({ filas, alAbrir }: { filas: FilaDeTabla[]; alAbrir: (id: string) => void }) {
  const hoy = diaDeLaFecha(new Date().toISOString()) ?? format(new Date(), "yyyy-MM-dd");
  const [mes, setMes] = useState(() => startOfMonth(parseISO(hoy)));
  const { porDia, sinFecha } = useMemo(() => filasPorDia(filas), [filas]);
  const dias = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(mes), SEMANA), end: endOfWeek(endOfMonth(mes), SEMANA) }),
    [mes],
  );
  const diasConTarjetas = dias.filter((dia) => isSameMonth(dia, mes) && porDia.has(format(dia, "yyyy-MM-dd")));
  const nombreDelMes = format(mes, "MMMM yyyy", { locale: es });

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-4 p-3 lg:flex-row">
        <section className="min-w-0 flex-1" aria-label={`Calendario de ${nombreDelMes}`}>
          <div className="mb-2 flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={() => setMes((m) => addMonths(m, -1))} aria-label="Mes anterior">
              <ChevronLeft />
            </Button>
            <h2 className="min-w-36 text-center text-sm font-semibold first-letter:uppercase">{nombreDelMes}</h2>
            <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={() => setMes((m) => addMonths(m, 1))} aria-label="Mes siguiente">
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" className="ml-1 h-10 md:h-7" onClick={() => setMes(startOfMonth(parseISO(hoy)))}>
              Hoy
            </Button>
          </div>

          {/* Computador: la cuadrícula del mes. */}
          <div className="hidden overflow-hidden rounded-xl border border-border md:block">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {DIAS_DE_LA_SEMANA.map((nombre) => (
                <div key={nombre} className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {nombre}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {dias.map((dia) => {
                const clave = format(dia, "yyyy-MM-dd");
                const lista = porDia.get(clave) ?? [];
                const delMes = isSameMonth(dia, mes);
                return (
                  <div
                    key={clave}
                    className={cn(
                      "min-h-24 min-w-0 space-y-1 border-r border-b border-border p-1 [&:nth-child(7n)]:border-r-0",
                      !delMes && "bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                        clave === hoy ? "bg-primary font-semibold text-primary-foreground" : delMes ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {format(dia, "d")}
                    </div>
                    {lista.map((fila) => (
                      <Chip key={fila.id} fila={fila} alAbrir={alAbrir} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Celular: solo los días del mes que tienen tarjetas. */}
          <div className="space-y-3 md:hidden">
            {diasConTarjetas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ninguna tarjeta tiene fecha en este mes.</p>
            ) : (
              diasConTarjetas.map((dia) => {
                const clave = format(dia, "yyyy-MM-dd");
                return (
                  <div key={clave} className="space-y-1">
                    <p className={cn("text-xs font-semibold first-letter:uppercase", clave === hoy && "text-primary")}>
                      {format(dia, "EEEE d", { locale: es })}
                      {clave === hoy ? " · hoy" : ""}
                    </p>
                    {(porDia.get(clave) ?? []).map((fila) => (
                      <Chip key={fila.id} fila={fila} alAbrir={alAbrir} />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className="w-full shrink-0 space-y-1.5 lg:w-72" aria-label="Sin fecha">
          <h2 className="text-sm font-semibold">
            Sin fecha <span className="font-normal text-muted-foreground tabular-nums">{sinFecha.length}</span>
          </h2>
          {sinFecha.length === 0 ? (
            <p className="text-xs text-muted-foreground">Todas las tarjetas tienen fecha.</p>
          ) : (
            sinFecha.map((fila) => <Chip key={fila.id} fila={fila} alAbrir={alAbrir} />)
          )}
        </aside>
      </div>
    </div>
  );
}
