import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { HORAS_PARA_QUEDARSE, MINIMO_POR_PASO, textoDeEmbudoPorPaso, type EmbudoPorPaso, type GrupoPorPaso } from "../dominio/por-paso";
import { FAMILIAS } from "../dominio/semanal";

/**
 * LA PANTALLA "EMBUDO POR PASO": barras de cuántos clientes llegaron a cada paso del bot y cuántos
 * se quedaron en cada uno, con la tasa de paso a paso. Solo presenta: los números llegan armados
 * (dominio/por-paso.ts, el mismo cálculo del MCP). Sin JavaScript del lado del cliente.
 */

type Props = {
  embudo: EmbudoPorPaso | null;
  apagado: boolean;
  familia: string;
  nombreProducto: string;
  desde: string;
  hasta: string;
};

const horas = (valor: number | null) => (valor === null ? "sin dato" : `${valor.toLocaleString("es-CO", { maximumFractionDigits: 1 })} h`);

function Barras({ titulo, valores, maximo, tono }: { titulo: string; valores: Array<{ nombre: string; valor: number }>; maximo: number; tono: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{titulo}</h3>
      <ol className="flex flex-col gap-2">
        {valores.map((item) => (
          <li key={item.nombre} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-foreground">{item.nombre}</span>
              <span className="text-muted-foreground">{item.valor.toLocaleString("es-CO")}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", tono)}
                style={{ width: `${maximo > 0 ? Math.max((item.valor / maximo) * 100, item.valor > 0 ? 3 : 0) : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Grupo({ titulo, ayuda, grupo }: { titulo: string; ayuda: string; grupo: GrupoPorPaso }) {
  const maximo = Math.max(1, ...grupo.pasos.map((paso) => paso.llegaron));
  const caida = grupo.mayorCaida;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          {titulo}
          <Badge variant="outline">{grupo.chats.toLocaleString("es-CO")} chats</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {grupo.chats === 0 ? (
          <p className="text-sm text-muted-foreground">No hay chats en este grupo para ese rango.</p>
        ) : (
          <>
            <Barras titulo="Llegaron a cada paso" tono="bg-primary" maximo={maximo} valores={grupo.pasos.map((paso) => ({ nombre: paso.nombre, valor: paso.llegaron }))} />
            <Barras
              titulo={`Se quedaron aquí (más de ${HORAS_PARA_QUEDARSE} h sin escribir)`}
              tono="bg-red-500"
              maximo={maximo}
              valores={grupo.pasos.map((paso) => ({ nombre: paso.nombre, valor: paso.seQuedaron }))}
            />
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {grupo.pasos.map((paso, i) => {
                const siguiente = grupo.pasos[i + 1];
                const resalta = caida?.desde === paso.clave;
                return (
                  <li key={paso.clave} className={cn(resalta && "font-bold text-red-700 dark:text-red-400")}>
                    {siguiente
                      ? paso.tasaAlSiguiente === null
                        ? `${paso.nombre} → ${siguiente.nombre}: sin datos`
                        : `${paso.tasaAlSiguiente} % de ${paso.nombre} pasa a ${siguiente.nombre}`
                      : `${paso.nombre}: último paso`}
                    {` · tiempo promedio en el paso: ${horas(paso.horasPromedio)}`}
                    {paso.pocosDatos && paso.llegaron > 0 ? ` · pocos datos (menos de ${MINIMO_POR_PASO})` : ""}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              {caida
                ? `Se cae más entre «${caida.desdeNombre}» y «${caida.haciaNombre}»: no pasan ${caida.quedaron} (${caida.pctQuedaron} %).`
                : "No hay caída que señalar."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function EmbudoPorPasoVista({ embudo, apagado, familia, nombreProducto, desde, hasta }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-foreground">En qué paso del bot se cae la gente</h1>
        <p className="text-sm text-muted-foreground">
          {nombreProducto} · chats que entraron del {desde} al {hasta}. Un chat «se queda» en su paso actual si lleva más de{" "}
          {HORAS_PARA_QUEDARSE} horas sin escribir.
        </p>
      </header>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Producto
          <NativeSelect name="familia" defaultValue={familia} className="w-full">
            {FAMILIAS.map((item) => (
              <option key={item.clave} value={item.clave}>
                {item.nombre}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={desde} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={hasta} />
        </label>
        <div className="flex items-end">
          <Button type="submit" className="min-h-11 w-full">
            Ver
          </Button>
        </div>
      </form>

      {apagado || !embudo ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          El registro del embudo está apagado en este negocio: no hay datos por paso.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground">{textoDeEmbudoPorPaso(embudo, nombreProducto)}</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Grupo titulo="Solo el bot" ayuda="Chats que el bot llevó solo, sin asesora." grupo={embudo.bot} />
            <Grupo titulo="Lo tomó una asesora" ayuda="IA en pausa o chat asignado: no se mezclan con los del bot." grupo={embudo.asesora} />
          </div>
        </>
      )}
    </div>
  );
}
