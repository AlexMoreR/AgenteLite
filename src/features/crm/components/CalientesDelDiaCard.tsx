import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Los datos que trae estadoDeEtapaPorLectura(): se pasan sueltos para no cargar el servicio en el navegador. */
export type CalientesDelDiaDatos = {
  calientesHoy: number | null;
  calientesPorDia: Array<{ fecha: string; calientes: number }> | null;
  porcentajeSinEtapa: number | null;
  sinEtapa: { sin_etapa: number; total: number } | null;
  meta: number;
};

const DIA_CORTO = new Intl.DateTimeFormat("es-CO", { weekday: "short", timeZone: "UTC" });

/** "2026-11-04" → "mié". La fecha ya viene en día de Colombia: se lee como UTC para no correrla. */
function diaCorto(fecha: string) {
  return DIA_CORTO.format(new Date(`${fecha}T12:00:00Z`)).replace(".", "");
}

/**
 * Calientes del día (Dirección → Informe): cuántos chats pasaron a Caliente hoy, los últimos 7 días y
 * qué parte de los chats de la semana sigue sin etapa ("---"). La meta del dueño es menos del 10 %.
 */
export function CalientesDelDiaCard({ datos }: { datos: CalientesDelDiaDatos }) {
  const pasaLaMeta = datos.porcentajeSinEtapa !== null && datos.porcentajeSinEtapa > datos.meta;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-muted-foreground" />
          Calientes del día
        </CardTitle>
        <CardDescription>Chats que pasaron a Caliente, en hora de Colombia.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-3xl font-bold leading-none text-foreground">{datos.calientesHoy ?? "—"}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {datos.calientesHoy === null ? "No se pudo leer hoy" : "hoy"}
          </p>
        </div>

        {datos.calientesPorDia ? (
          <div className="grid grid-cols-7 gap-1" aria-label="Calientes de los últimos 7 días">
            {datos.calientesPorDia.map((dia, i) => {
              const esHoy = i === (datos.calientesPorDia?.length ?? 0) - 1;
              return (
                <div
                  key={dia.fecha}
                  className={cn(
                    "flex min-w-0 flex-col items-center rounded-md border border-border px-1 py-1.5",
                    esHoy && "bg-muted",
                  )}
                  title={dia.fecha}
                >
                  <span className="text-[11px] text-muted-foreground">{diaCorto(dia.fecha)}</span>
                  <span className="text-[13px] font-semibold text-foreground">{dia.calientes}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-[13px]">
          <span className="text-muted-foreground">Chats de la semana sin etapa</span>
          {datos.porcentajeSinEtapa === null ? (
            <span className="text-muted-foreground">No se pudo leer</span>
          ) : (
            <Badge variant={pasaLaMeta ? "destructive" : "secondary"}>
              {datos.porcentajeSinEtapa} %{datos.sinEtapa ? ` (${datos.sinEtapa.sin_etapa} de ${datos.sinEtapa.total})` : ""}
            </Badge>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {pasaLaMeta
            ? `Pasa la meta: debería ser menos del ${datos.meta} %.`
            : `Meta: menos del ${datos.meta} %.`}
        </p>
      </CardContent>
    </Card>
  );
}
