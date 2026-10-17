"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  METRICAS_DE_LINEA,
  NOMBRE_DEL_RANGO,
  textoDelRango,
  type ClaveDeMetrica,
  type Rango,
  type TipoDeRango,
} from "../../dominio/linea-de-tiempo";

/** Los filtros van en la URL (se puede compartir el enlace). `actuales` = la consulta de hoy. */
type Destino = { base: string; actuales: Record<string, string> };

function armarUrl({ base, actuales }: Destino, cambios: Record<string, string | null>) {
  const q = new URLSearchParams(actuales);
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor === null) q.delete(clave);
    else q.set(clave, valor);
  }
  const texto = q.toString();
  return texto ? `${base}?${texto}` : base;
}

const aDia = (fecha: Date) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
const deDia = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d);
};

function useIr(destino: Destino) {
  const router = useRouter();
  const [cargando, iniciar] = useTransition();
  const ir = (cambios: Record<string, string | null>) => iniciar(() => router.push(armarUrl(destino, cambios), { scroll: false }));
  return { ir, cargando };
}

/** Ayer / Últimos 7 días / Semana / Mes (pestañas) + Personalizado (calendario). */
export function FiltroDeRango({
  rango,
  opciones,
  hoy,
  ...destino
}: Destino & { rango: Rango; opciones: Exclude<TipoDeRango, "custom">[]; hoy: string }) {
  const { ir, cargando } = useIr(destino);
  const esMovil = useIsMobile();
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<DateRange | undefined>({ from: deDia(rango.desde), to: deDia(rango.hasta) });
  const personalizado = rango.tipo === "custom";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${cargando ? "opacity-60" : ""}`} aria-busy={cargando}>
      <Tabs
        value={personalizado ? null : rango.tipo}
        onValueChange={(valor) => ir({ rango: String(valor), desde: null, hasta: null, dia: null })}
      >
        <TabsList className="h-10!">
          {opciones.map((tipo) => (
            <TabsTrigger key={tipo} value={tipo} className="px-3 text-sm">
              {NOMBRE_DEL_RANGO[tipo]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Popover open={abierto} onOpenChange={setAbierto}>
        <PopoverTrigger asChild>
          <Button type="button" variant={personalizado ? "default" : "outline"} className="h-10 px-3">
            <CalendarDays />
            {personalizado ? textoDelRango(rango) : NOMBRE_DEL_RANGO.custom}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[calc(100vw-2rem)] bg-popover p-2 text-popover-foreground sm:w-auto">
          <Calendar
            mode="range"
            numberOfMonths={esMovil ? 1 : 2}
            locale={es}
            defaultMonth={borrador?.from}
            selected={borrador}
            onSelect={setBorrador}
            disabled={{ after: deDia(hoy) }}
            className="w-full [--cell-size:2.25rem]"
          />
          <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-10"
              disabled={!borrador?.from}
              onClick={() => {
                if (!borrador?.from) return;
                setAbierto(false);
                ir({ rango: "custom", desde: aDia(borrador.from), hasta: aDia(borrador.to ?? borrador.from), dia: null });
              }}
            >
              Ver
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Que se mira en el grafico. */
export function FiltroDeMetrica({ metrica, ...destino }: Destino & { metrica: ClaveDeMetrica }) {
  const { ir, cargando } = useIr(destino);
  return (
    <Tabs value={metrica} onValueChange={(valor) => ir({ metrica: String(valor) })} className={cargando ? "opacity-60" : ""}>
      <TabsList className="h-10! w-full sm:w-fit">
        {METRICAS_DE_LINEA.map((m) => (
          <TabsTrigger key={m.clave} value={m.clave} className="px-3 text-sm">
            {m.corto}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
