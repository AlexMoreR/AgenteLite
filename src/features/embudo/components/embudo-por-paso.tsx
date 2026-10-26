import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { MINIMO_PARA_PORCENTAJE, type GrupoPorPaso } from "../dominio/por-paso";
import { FAMILIAS } from "../dominio/semanal";

/**
 * LA PANTALLA "EMBUDO POR PASO". Solo presenta: los números llegan armados (dominio/por-paso.ts, el
 * mismo cálculo del MCP). Sin JavaScript del lado del cliente; el filtro es un formulario GET.
 */

export type EmbudoPorPasoVistaProps = {
  apagado: boolean;
  familia: string;
  nombreProducto: string;
  desde: string;
  hasta: string;
  soloBot: GrupoPorPaso;
  conAsesora: GrupoPorPaso;
  resumen: string;
  hrefEmbudo: string;
};

function Barras({ titulo, grupo }: { titulo: string; grupo: GrupoPorPaso }) {
  const maximo = Math.max(1, ...grupo.pasos.map((paso) => paso.llegaron));
  const caida = grupo.mayorCaida;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {titulo}
          <Badge variant="outline">{grupo.chats.toLocaleString("es-CO")} chats</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {grupo.chats === 0 ? <p className="text-sm text-muted-foreground">Sin chats en este grupo.</p> : null}
        <ol className="flex flex-col gap-3" aria-label={titulo}>
          {grupo.pasos.map((paso, indice) => {
            const seCae = caida?.hasta === paso.nombre;
            return (
              <li key={paso.clave} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-foreground">{paso.nombre}</span>
                  <span className="text-muted-foreground">
                    {paso.horasPromedio !== null ? `${paso.horasPromedio.toLocaleString("es-CO")} h promedio en el paso` : "sin tiempo medido"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-5 flex-1 rounded bg-muted" role="img" aria-label={`${paso.llegaron} llegaron a ${paso.nombre}`}>
                    <div
                      className={cn("h-5 rounded", seCae ? "bg-red-500" : "bg-primary")}
                      style={{ width: `${paso.llegaron > 0 ? Math.max(3, Math.round((paso.llegaron / maximo) * 100)) : 0}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm font-bold tabular-nums">{paso.llegaron}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 flex-1 rounded bg-muted" role="img" aria-label={`${paso.seQuedaron} se quedaron en ${paso.nombre}`}>
                    <div
                      className="h-3 rounded bg-amber-500"
                      style={{ width: `${paso.seQuedaron > 0 ? Math.max(3, Math.round((paso.seQuedaron / maximo) * 100)) : 0}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{paso.seQuedaron}</span>
                </div>
                {indice > 0 ? (
                  <p className={cn("text-xs", seCae ? "font-bold text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                    {paso.pasaDesdeAnterior === null
                      ? `Nadie llegó al paso anterior.`
                      : `${paso.pasaDesdeAnterior} % de ${grupo.pasos[indice - 1].nombre} pasa a ${paso.nombre}`}
                    {paso.pocosDatos ? ` · pocos datos (menos de ${MINIMO_PARA_PORCENTAJE})` : ""}
                    {seCae ? " · aquí se cae más gente" : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          Barra grande: cuántos llegaron al paso. Barra naranja: cuántos se quedaron ahí (están en ese paso y llevan más de 24 horas sin escribir).
        </p>
      </CardContent>
    </Card>
  );
}

export function EmbudoPorPasoVista(props: EmbudoPorPasoVistaProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Embudo por paso</h1>
        <p className="text-sm text-muted-foreground">
          En qué paso del bot se queda cada cliente: {props.nombreProducto}, del {props.desde} al {props.hasta}.
        </p>
      </div>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Producto
          <NativeSelect name="familia" defaultValue={props.familia} className="w-full">
            {FAMILIAS.map((familia) => (
              <option key={familia.clave} value={familia.clave}>
                {familia.nombre}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={props.desde} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={props.hasta} />
        </label>
        <Button type="submit" className="min-h-11 self-end">
          Ver
        </Button>
      </form>

      {props.apagado ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          El registro del embudo está apagado en este negocio: no hay datos para mostrar.
        </p>
      ) : (
        <>
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">{props.resumen}</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Barras titulo="Solo el bot" grupo={props.soloBot} />
            <Barras titulo="Lo tomó una asesora" grupo={props.conAsesora} />
          </div>
        </>
      )}
      <a href={props.hrefEmbudo} className="inline-flex min-h-11 items-center self-start text-sm underline">
        Volver al embudo
      </a>
    </div>
  );
}
