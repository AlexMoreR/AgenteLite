"use client";

import { useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TarjetaVista, TipoVista } from "../services/tableros";
import { diaDeBogota } from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";

type Props = {
  tarjetas: TarjetaVista[];
  tipos: TipoVista[];
  alAbrir: (tarjetaId: string) => void;
};

const DIAS_DE_LA_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** El día de hoy en Colombia, como fecha local (para armar el mes sin que cambie de día). */
function hoyEnBogota(): Date {
  const [anio, mes, dia] = (diaDeBogota(new Date().toISOString()) ?? "2026-01-01").split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/**
 * La vista Calendario: el mes con cada tarjeta en el día de su fecha (en la hora de Colombia) y, aparte,
 * las tarjetas "Sin fecha". En el celular el mes se ve como una lista de los días que tienen tarjetas.
 */
export function VistaCalendario({ tarjetas, tipos, alAbrir }: Props) {
  const [mes, setMes] = useState(() => startOfMonth(hoyEnBogota()));
  const hoy = useMemo(() => format(hoyEnBogota(), "yyyy-MM-dd"), []);
  const usaEstados = useMemo(() => new Map(tipos.map((tipo) => [tipo.id, tipo.usaEstados])), [tipos]);

  const { porDia, sinFecha } = useMemo(() => {
    const mapa = new Map<string, TarjetaVista[]>();
    const sin: TarjetaVista[] = [];
    for (const tarjeta of tarjetas) {
      const dia = diaDeBogota(tarjeta.fecha);
      if (!dia) sin.push(tarjeta);
      else mapa.set(dia, [...(mapa.get(dia) ?? []), tarjeta]);
    }
    return { porDia: mapa, sinFecha: sin };
  }, [tarjetas]);

  const dias = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(mes, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(mes), { weekStartsOn: 1 }) }),
    [mes],
  );
  const diasDelMesConTarjetas = dias.filter((dia) => isSameMonth(dia, mes) && porDia.has(format(dia, "yyyy-MM-dd")));
  const titulo = format(mes, "MMMM yyyy", { locale: es });

  const chip = (tarjeta: TarjetaVista) => {
    const conEstado = usaEstados.get(tarjeta.tipoId) ?? true;
    return (
      <button
        key={tarjeta.id}
        type="button"
        onClick={() => alAbrir(tarjeta.id)}
        title={`${tarjeta.codigo} ${tarjeta.titulo}`.trim()}
        className="flex w-full min-w-0 items-center gap-1 rounded border bg-card px-1.5 py-1 text-left text-xs hover:bg-muted"
      >
        {conEstado ? <span className={cn("size-2 shrink-0 rounded-full", COLOR_DEL_ESTADO[tarjeta.estado].punto)} aria-hidden /> : null}
        {tarjeta.codigo ? <span className="shrink-0 tabular-nums text-muted-foreground">{tarjeta.codigo}</span> : null}
        <span className="truncate">{tarjeta.titulo}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto">
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-3 py-2">
          <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={() => setMes((m) => addMonths(m, -1))} aria-label="Mes anterior">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={() => setMes((m) => addMonths(m, 1))} aria-label="Mes siguiente">
            <ChevronRight />
          </Button>
          <h2 className="ml-1 text-sm font-semibold capitalize">{titulo}</h2>
          <Button variant="outline" size="sm" className="ml-auto h-10 md:h-8" onClick={() => setMes(startOfMonth(hoyEnBogota()))}>
            Hoy
          </Button>
        </div>

        {/* Pantallas anchas: la cuadrícula del mes. */}
        <div className="hidden p-3 md:block">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {DIAS_DE_LA_SEMANA.map((dia) => (
              <div key={dia} className="bg-card px-2 py-1 text-xs font-medium text-muted-foreground">
                {dia}
              </div>
            ))}
            {dias.map((dia) => {
              const clave = format(dia, "yyyy-MM-dd");
              const lista = porDia.get(clave) ?? [];
              return (
                <div
                  key={clave}
                  className={cn("min-h-24 min-w-0 space-y-1 bg-background p-1.5", !isSameMonth(dia, mes) && "bg-muted/40 text-muted-foreground")}
                >
                  <div
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      clave === hoy && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {dia.getDate()}
                  </div>
                  {lista.map(chip)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Celular: solo los días del mes que tienen tarjetas. */}
        <div className="space-y-3 p-3 md:hidden">
          {diasDelMesConTarjetas.length ? (
            diasDelMesConTarjetas.map((dia) => {
              const clave = format(dia, "yyyy-MM-dd");
              return (
                <section key={clave} className="space-y-1">
                  <h3 className={cn("text-xs font-medium capitalize text-muted-foreground", clave === hoy && "text-foreground")}>
                    {format(dia, "EEEE d", { locale: es })}
                    {clave === hoy ? " · hoy" : ""}
                  </h3>
                  {(porDia.get(clave) ?? []).map(chip)}
                </section>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Ninguna tarjeta tiene fecha en este mes.</p>
          )}
        </div>
      </div>

      <aside className="shrink-0 border-t border-border bg-card p-3 lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <h2 className="mb-2 text-sm font-semibold">
          Sin fecha <span className="font-normal tabular-nums text-muted-foreground">{sinFecha.length}</span>
        </h2>
        {sinFecha.length ? (
          <div className="space-y-1">{sinFecha.map(chip)}</div>
        ) : (
          <p className="text-xs text-muted-foreground">Todas las tarjetas tienen fecha.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">La fecha se pone en la columna Fecha de la vista Tabla.</p>
      </aside>
    </div>
  );
}
