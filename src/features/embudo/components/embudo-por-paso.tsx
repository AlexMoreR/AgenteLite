import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  HORAS_PARA_QUEDARSE,
  MINIMO_DE_CLIENTES_POR_PASO,
  textoDeHoras,
  textoPct,
  type EmbudoPorPaso,
  type GrupoPorPaso,
} from "../dominio/por-paso";
import { FAMILIAS } from "../dominio/semanal";

/**
 * LA PANTALLA "EMBUDO POR PASO": en qué paso del bot se queda cada cliente. Solo presenta: los
 * números llegan armados (dominio/por-paso.ts, el mismo cálculo de la herramienta MCP
 * `embudo_por_paso`). Sin JavaScript del lado del cliente; los filtros son un formulario GET.
 *
 * Mobile-first: las barras van en una columna y los dos grupos (solo el bot / lo tomó una
 * asesora) se apilan hasta `lg`.
 */

function Barras({
  titulo,
  grupo,
  valor,
  tono,
}: {
  titulo: string;
  grupo: GrupoPorPaso;
  valor: (indice: number) => number;
  tono: string;
}) {
  const maximo = Math.max(1, ...grupo.pasos.map((_, indice) => valor(indice)));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      <ol className="flex flex-col gap-2" aria-label={titulo}>
        {grupo.pasos.map((paso, indice) => {
          const cuantos = valor(indice);
          const ancho = cuantos > 0 ? Math.max((cuantos / maximo) * 100, 3) : 0;
          return (
            <li key={paso.clave} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-foreground">{paso.nombre}</span>
                <span className="text-muted-foreground">{cuantos.toLocaleString("es-CO")}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", tono)} style={{ width: `${ancho}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TarjetaDeGrupo({ titulo, descripcion, grupo }: { titulo: string; descripcion: string; grupo: GrupoPorPaso }) {
  const caida = grupo.mayorCaida;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
          {titulo}
          <Badge variant="outline">{grupo.total.toLocaleString("es-CO")} clientes</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {grupo.total === 0 ? (
          <p className="text-sm text-muted-foreground">No hay clientes de este grupo en el rango.</p>
        ) : (
          <>
            <Barras titulo="Llegaron a cada paso" grupo={grupo} valor={(i) => grupo.pasos[i].llegaron} tono="bg-primary" />
            <Barras titulo="Se quedaron en cada paso" grupo={grupo} valor={(i) => grupo.pasos[i].seQuedaron} tono="bg-red-500" />
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">De un paso al siguiente</h3>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {grupo.pasos.map((paso, indice) => {
                  const siguiente = grupo.pasos[indice + 1];
                  const esCaida = caida?.desde === paso.clave;
                  return (
                    <li key={paso.clave} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="text-muted-foreground">
                        {siguiente ? (
                          <>
                            <span className="text-foreground">{textoPct(paso.tasaAlSiguiente)}</span> de {paso.nombre} pasa a{" "}
                            {siguiente.nombre}
                          </>
                        ) : (
                          <>En {paso.nombre} dura en promedio</>
                        )}
                        {paso.pocosDatos ? <Badge variant="outline" className="ml-2">Pocos datos</Badge> : null}
                      </span>
                      <span className={cn("text-right text-xs", esCaida ? "font-bold text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                        {esCaida ? "Aquí se cae más · " : ""}
                        {textoDeHoras(paso.horasPromedio)} en el paso
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                {caida
                  ? `Se cae más entre «${caida.desdeNombre}» y «${caida.haciaNombre}»: no pasa el ${textoPct(caida.pctQueNoPaso)} (${caida.quedaron} clientes).`
                  : "No hay caída que señalar."}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export type EmbudoPorPasoVistaProps = {
  apagado: boolean;
  nombreProducto: string;
  etiquetaRango: string;
  embudo: EmbudoPorPaso | null;
  filtros: { familia: string; desde: string; hasta: string };
  hrefLimpiar: string;
  hrefEmbudo: string;
};

export function EmbudoPorPasoVista(props: EmbudoPorPasoVistaProps) {
  const { embudo } = props;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-5 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-foreground">Embudo por paso del bot</h1>
        <p className="text-sm text-muted-foreground">
          {props.nombreProducto} · {props.etiquetaRango}. Clientes que entraron en ese rango, según el paso en el que va el bot.
        </p>
        <a href={props.hrefEmbudo} className="inline-flex min-h-11 items-center self-start text-sm underline">
          Volver al embudo
        </a>
      </header>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Producto
          <NativeSelect name="familia" defaultValue={props.filtros.familia} className="w-full">
            {FAMILIAS.map((familia) => (
              <option key={familia.clave} value={familia.clave}>
                {familia.nombre}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={props.filtros.desde} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={props.filtros.hasta} />
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" className="min-h-11 flex-1">
            Ver
          </Button>
          <Button render={<a href={props.hrefLimpiar} />} variant="outline" className="min-h-11">
            Limpiar
          </Button>
        </div>
      </form>

      {props.apagado || !embudo ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            El registro del embudo está apagado en este negocio: no hay datos del embudo por paso.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TarjetaDeGrupo titulo="Solo el bot" descripcion="Chats que atendió el bot, sin asesora." grupo={embudo.soloBot} />
            <TarjetaDeGrupo
              titulo="Lo tomó una asesora"
              descripcion="La IA está en pausa o el chat está asignado a una asesora. Aparte para no mezclarlos con los del bot."
              grupo={embudo.conAsesora}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            «Se quedó» = su paso actual es ese y lleva más de {HORAS_PARA_QUEDARSE} horas sin escribir (si compró no cuenta). Con menos de{" "}
            {MINIMO_DE_CLIENTES_POR_PASO} clientes en un paso los porcentajes pueden engañar. Identificación (solo del V2) se cuenta dentro de
            Presentación. Si el cliente vuelve a un paso anterior, no se cuenta dos veces.
          </p>
        </>
      )}
    </div>
  );
}
