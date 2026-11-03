import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { META_SIN_ETAPA, type CalientesDelDia } from "../services/etapa-por-lectura";

/** "2026-11-03" → "mar 3" (el día ya viene en hora de Colombia). */
function etiquetaDelDia(fecha: string) {
  const dia = new Date(`${fecha}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat("es-CO", { weekday: "short", timeZone: "UTC" }).format(dia).replace(".", "");
  return { semana, numero: dia.getUTCDate() };
}

/**
 * Calientes del día (Dirección → Informe): cuántos contactos pasaron a Caliente hoy, los 7 últimos días y el %
 * de chats de la semana que siguen sin etapa ("---"), con la meta del dueño de menos del 10 %.
 */
export function CalientesDelDiaCard({
  calientesHoy,
  calientesPorDia,
  porcentajeSinEtapa,
  sinEtapa,
}: {
  calientesHoy: number | null;
  calientesPorDia: CalientesDelDia[];
  porcentajeSinEtapa: number | null;
  sinEtapa: { sin_etapa: number; total: number } | null;
}) {
  const pasaLaMeta = porcentajeSinEtapa !== null && porcentajeSinEtapa > META_SIN_ETAPA;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Flame className="size-4 text-amber-500" />
          Calientes del día
        </CardTitle>
        <CardDescription>Contactos que pasaron a Caliente, en hora de Colombia.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-foreground tabular-nums">{calientesHoy ?? "—"}</span>
          <span className="text-[13px] text-muted-foreground">{calientesHoy === null ? "no se pudo leer hoy" : "hoy"}</span>
        </div>

        {calientesPorDia.length > 0 ? (
          <ol className="grid grid-cols-7 gap-1" aria-label="Calientes de los últimos 7 días">
            {calientesPorDia.map((dia, i) => {
              const { semana, numero } = etiquetaDelDia(dia.fecha);
              const esHoy = i === calientesPorDia.length - 1;
              return (
                <li
                  key={dia.fecha}
                  className={cn(
                    "flex min-w-0 flex-col items-center rounded-md border border-border px-1 py-1.5",
                    esHoy ? "bg-muted" : "bg-card",
                  )}
                >
                  <span className="truncate text-[11px] text-muted-foreground">
                    {semana} {numero}
                  </span>
                  <span className="text-[13px] font-semibold text-foreground tabular-nums">{dia.calientes}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-[13px]">
          <span className="text-muted-foreground">
            Chats de la semana sin etapa:{" "}
            <span className={cn("font-semibold tabular-nums", pasaLaMeta ? "text-destructive" : "text-foreground")}>
              {porcentajeSinEtapa === null ? "no se pudo leer" : `${String(porcentajeSinEtapa).replace(".", ",")} %`}
            </span>
            {sinEtapa ? (
              <span className="tabular-nums">
                {" "}
                ({sinEtapa.sin_etapa} de {sinEtapa.total})
              </span>
            ) : null}
          </span>
          {porcentajeSinEtapa !== null ? (
            <Badge variant={pasaLaMeta ? "destructive" : "secondary"}>
              {pasaLaMeta ? `Pasa la meta de ${META_SIN_ETAPA} %` : `Meta: menos de ${META_SIN_ETAPA} %`}
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
