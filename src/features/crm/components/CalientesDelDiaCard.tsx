import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EstadoDeEtapaPorLectura } from "@/features/crm/services/etapa-por-lectura";

/** "2026-11-04" → "mié 4". El día sale de la fecha en texto, sin zona horaria: ya viene en hora de Colombia. */
function diaCorto(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const semana = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `${semana} ${dia}`;
}

/**
 * Calientes del día (parte 3 de "Etapas automáticas"): cuántos leads pasaron a Caliente hoy, los 7 últimos
 * días y qué porcentaje de los chats de la semana sigue sin etapa ("---"). La meta es menos del 10 %.
 * Lo que no se pudo leer sale como "—", sin romper la tarjeta.
 */
export function CalientesDelDiaCard({ estado }: { estado: EstadoDeEtapaPorLectura }) {
  const porcentaje = estado.porcentaje_sin_etapa_semana;
  const pasaDeLaMeta = porcentaje !== null && porcentaje > estado.meta_sin_etapa;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-amber-500" />
          Calientes del día
        </CardTitle>
        <CardDescription className="text-[12px]">Leads que pasaron a Caliente, en hora de Colombia.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-semibold leading-none text-foreground">{estado.calientes_hoy ?? "—"}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">hoy</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] text-muted-foreground">Chats de la semana sin etapa</p>
            <div className="mt-0.5 flex items-center justify-end gap-2">
              <span className="text-[15px] font-semibold text-foreground">{porcentaje === null ? "—" : `${porcentaje} %`}</span>
              {pasaDeLaMeta ? (
                <Badge variant="destructive">Pasa del {estado.meta_sin_etapa} %</Badge>
              ) : porcentaje !== null ? (
                <Badge variant="outline">Meta: menos del {estado.meta_sin_etapa} %</Badge>
              ) : null}
            </div>
          </div>
        </div>

        {estado.calientes_por_dia ? (
          <ol className="grid grid-cols-7 gap-1 border-t border-border pt-2.5" aria-label="Calientes de los últimos 7 días">
            {estado.calientes_por_dia.map((dia) => (
              <li key={dia.fecha} className="min-w-0 text-center">
                <p className="text-[13px] font-semibold text-foreground">{dia.calientes}</p>
                <p className="truncate text-[11px] text-muted-foreground">{diaCorto(dia.fecha)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-t border-border pt-2.5 text-[12px] text-muted-foreground">
            No se pudieron leer los últimos 7 días. Prueba recargar en un rato.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
