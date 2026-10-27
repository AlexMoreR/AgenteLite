import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  HORAS_PARA_QUEDARSE,
  MINIMO_POR_PASO,
  textoDeHoras,
  type EmbudoPorPaso,
  type GrupoPorPaso,
} from "../dominio/por-paso";
import { textoPct } from "../dominio/semanal";

/**
 * LA PANTALLA "EMBUDO POR PASO": en qué paso del bot se queda la gente. Solo presenta: los números
 * llegan armados (dominio/por-paso.ts, el mismo cálculo del MCP). Sin JavaScript del lado del cliente.
 *
 * Mobile-first: todo en una columna. Dos bloques: los chats que atendió solo el bot y, aparte, los
 * que tomó una asesora. En cada uno, barras de "llegaron" y de "se quedaron" por paso, la tasa de
 * paso a paso (el paso donde más se cae, en rojo) y el tiempo promedio en cada paso.
 */

function Barra({ valor, maximo, tono }: { valor: number; maximo: number; tono: string }) {
  const ancho = maximo > 0 ? Math.max((valor / maximo) * 100, valor > 0 ? 3 : 0) : 0;
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", tono)} style={{ width: `${ancho}%` }} />
    </div>
  );
}

function GrupoDelEmbudo({ titulo, descripcion, grupo }: { titulo: string; descripcion: string; grupo: GrupoPorPaso }) {
  const maximo = Math.max(...grupo.pasos.map((paso) => paso.llegaron), 0);
  const caida = grupo.mayorCaida;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
          {titulo}
          <Badge variant="outline">{grupo.chats.toLocaleString("es-CO")} chats</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {grupo.conPaso === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay chats con un paso registrado en este rango.</p>
        ) : (
          <>
            <section aria-label="Cuántos llegaron a cada paso" className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-foreground">Llegaron a cada paso</h3>
              <ol className="flex flex-col gap-3">
                {grupo.pasos.map((paso) => (
                  <li key={paso.clave} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold text-foreground">{paso.nombre}</span>
                      <span className="text-muted-foreground">{paso.llegaron.toLocaleString("es-CO")}</span>
                    </div>
                    <Barra valor={paso.llegaron} maximo={maximo} tono="bg-primary" />
                    {paso.tasaAlSiguiente !== null ? (
                      <p
                        className={cn(
                          "text-xs",
                          caida?.desde === paso.clave ? "font-bold text-red-700 dark:text-red-400" : "text-muted-foreground",
                        )}
                      >
                        {textoPct(paso.tasaAlSiguiente)} pasa al siguiente
                        {caida?.desde === paso.clave ? " · aquí se cae más" : ""}
                        {paso.pocosDatos ? " · pocos datos" : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>

            <section aria-label="Cuántos se quedaron en cada paso" className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-foreground">Se quedaron aquí (más de {HORAS_PARA_QUEDARSE} h sin responder)</h3>
              <ol className="flex flex-col gap-3">
                {grupo.pasos.map((paso) => (
                  <li key={paso.clave} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold text-foreground">{paso.nombre}</span>
                      <span className="text-muted-foreground">
                        {paso.seQuedaron.toLocaleString("es-CO")} · {textoPct(paso.pctSeQuedaron)}
                        {paso.enCurso ? ` · ${paso.enCurso} en curso` : ""}
                      </span>
                    </div>
                    <Barra valor={paso.seQuedaron} maximo={maximo} tono="bg-red-500" />
                  </li>
                ))}
              </ol>
            </section>

            <section aria-label="Tiempo en cada paso" className="flex flex-col gap-1">
              <h3 className="text-sm font-bold text-foreground">Tiempo promedio en cada paso</h3>
              <dl className="flex flex-col divide-y divide-border">
                {grupo.pasos.map((paso) => (
                  <div key={paso.clave} className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="text-sm text-muted-foreground">{paso.nombre}</dt>
                    <dd className="text-sm font-semibold text-foreground">{textoDeHoras(paso.horasPromedio)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <p className="text-xs text-muted-foreground">
              {caida
                ? `Se cae más entre «${caida.desdeNombre}» y «${caida.haciaNombre}»: pasa el ${textoPct(caida.tasa)} y ${caida.noPasaron.toLocaleString("es-CO")} no pasan.`
                : "No hay caída que señalar."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export type EmbudoPorPasoVistaProps = {
  embudo: EmbudoPorPaso;
  /** El embudo está apagado (embudo:activo:<negocio> = false). */
  apagado: boolean;
  etiquetaRango: string;
  nombreProducto: string;
  /** Texto de ayuda para decir en voz alta (el mismo del MCP). */
  resumen: string;
  filtros: React.ReactNode;
};

export function EmbudoPorPasoVista(props: EmbudoPorPasoVistaProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-5 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-foreground">Embudo por paso</h1>
        <p className="text-sm text-muted-foreground">
          {props.nombreProducto} · {props.etiquetaRango}. En qué paso del bot se queda la gente.
        </p>
      </header>

      {props.filtros}

      {props.apagado ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            El registro del embudo está apagado en este negocio: no hay datos del embudo por paso.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="text-sm text-foreground">{props.resumen}</CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GrupoDelEmbudo
              titulo="Solo el bot"
              descripcion="Chats que atendió el bot de principio a fin (sin asesora)."
              grupo={props.embudo.bot}
            />
            <GrupoDelEmbudo
              titulo="Lo tomó una asesora"
              descripcion="IA en pausa o chat asignado: aparte, para no mezclarlos con los del bot."
              grupo={props.embudo.asesora}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Cada chat cuenta una vez por paso aunque vuelva atrás. «Se quedó» = es su paso actual y lleva más de {HORAS_PARA_QUEDARSE} h sin escribir
            (si vuelve a escribir, deja de contar; los que ya compraron no cuentan). Identificación se cuenta dentro de Presentación. Con menos de{" "}
            {MINIMO_POR_PASO} chats en un paso los porcentajes pueden engañar. Los tiempos salen de los últimos 10 cambios de paso de cada chat.
          </p>
        </>
      )}
    </div>
  );
}
