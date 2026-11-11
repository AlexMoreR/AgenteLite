"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { colorDe } from "@/features/coach/components/linea/colores";
import {
  HORAS_PANEL,
  agruparContenedores,
  colorCpu,
  colorDisco,
  colorMemoria,
  cpuEfectivo,
  ordenarContenedoresPorCpu,
  porcentaje,
  seriePanelServidor,
  type ColorEstado,
  type FotoPanel,
} from "@/lib/metricas-servidor";

/**
 * Dirección → Servidor (solo lectura): la última foto del servidor en tres tarjetas, la gráfica de 24 h y los
 * contenedores por grupo y por CPU. Se actualiza sola cada minuto llamando a GET /api/admin/metricas-servidor.
 */

const CADA_MS = 60_000;

const CONFIG = {
  cpu: { label: "CPU", theme: { light: colorDe(0).light, dark: colorDe(0).dark } },
  memoria: { label: "Memoria", theme: { light: colorDe(1).light, dark: colorDe(1).dark } },
  disco: { label: "Disco", theme: { light: colorDe(2).light, dark: colorDe(2).dark } },
} satisfies ChartConfig;

/** Las mismas clases de verde/amarillo/rojo que usan las demás pantallas. */
const CLASES: Record<ColorEstado, { chip: string; cifra: string; texto: string }> = {
  verde: { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", cifra: "text-emerald-600 dark:text-emerald-300", texto: "Bien" },
  amarillo: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-300", cifra: "text-amber-600 dark:text-amber-300", texto: "Atención" },
  rojo: { chip: "bg-red-500/10 text-red-600 dark:text-red-300", cifra: "text-red-600 dark:text-red-300", texto: "Alto" },
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false });
const pct = (valor: number) => `${Math.round(valor).toLocaleString("es-CO")} %`;
const gb = (mb: number) => (mb / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 });
const gbDisco = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 0 });

function Pastilla({ color }: { color: ColorEstado }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASES[color].chip}`}>{CLASES[color].texto}</span>;
}

function Tarjeta({ titulo, valor, color, detalle }: { titulo: string; valor: number; color: ColorEstado; detalle: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {titulo}
          <Pastilla color={color} />
        </CardDescription>
        <CardTitle className={`text-4xl tabular-nums ${CLASES[color].cifra}`}>{pct(valor)}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{detalle}</CardContent>
    </Card>
  );
}

export function PanelServidor({ muestrasIniciales }: { muestrasIniciales: FotoPanel[] }) {
  const [muestras, setMuestras] = useState(muestrasIniciales);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    const actualizar = async () => {
      try {
        const respuesta = await fetch("/api/admin/metricas-servidor", { cache: "no-store" });
        const datos = (await respuesta.json().catch(() => null)) as { ok?: boolean; muestras?: FotoPanel[] } | null;
        if (!vivo) return;
        if (respuesta.ok && datos?.ok && Array.isArray(datos.muestras)) {
          setMuestras(datos.muestras);
          setFallo(false);
        } else {
          setFallo(true);
        }
      } catch {
        if (vivo) setFallo(true);
      }
    };
    const id = setInterval(actualizar, CADA_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  const ultima = muestras.at(-1);
  const serie = seriePanelServidor(muestras).map((p) => ({ ...p, etiqueta: hora(p.tomadaEn) }));
  const contenedores = ordenarContenedoresPorCpu(ultima?.contenedores ?? []);
  const grupos = agruparContenedores(contenedores);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Servidor</h1>
        <p className="text-sm text-muted-foreground">
          CPU, memoria y disco del servidor en las últimas {HORAS_PANEL} horas. Se actualiza solo cada minuto. Solo lectura.
        </p>
        {ultima ? <p className="text-xs text-muted-foreground">Última foto: {hora(ultima.tomadaEn)} (hora de Colombia).</p> : null}
        {fallo ? <p className="text-xs text-destructive">No se pudo actualizar; se vuelve a intentar en un minuto.</p> : null}
      </div>

      {!ultima ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Todavía no llegan datos del servidor</CardTitle>
            <CardDescription>
              No hay fotos de las últimas {HORAS_PANEL} horas. Llegan cuando el script del servidor está instalado y manda una cada minuto.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tarjeta
              titulo="CPU"
              valor={cpuEfectivo(ultima)}
              color={colorCpu(cpuEfectivo(ultima))}
              detalle={`Carga ${ultima.load1.toLocaleString("es-CO", { maximumFractionDigits: 2 })}${ultima.nucleos ? ` en ${ultima.nucleos} núcleos` : ""}`}
            />
            <Tarjeta
              titulo="Memoria"
              valor={porcentaje(ultima.memUsadaMb, ultima.memTotalMb)}
              color={colorMemoria(porcentaje(ultima.memUsadaMb, ultima.memTotalMb))}
              detalle={`${gb(ultima.memUsadaMb)} de ${gb(ultima.memTotalMb)} GB`}
            />
            <Tarjeta
              titulo="Disco"
              valor={porcentaje(ultima.discoUsadoGb, ultima.discoTotalGb)}
              color={colorDisco(porcentaje(ultima.discoUsadoGb, ultima.discoTotalGb))}
              detalle={`${gbDisco(ultima.discoUsadoGb)} de ${gbDisco(ultima.discoTotalGb)} GB`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimas {HORAS_PANEL} horas</CardTitle>
              <CardDescription>CPU, memoria y disco en %, hora de Colombia.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={CONFIG} className="aspect-auto h-64 w-full sm:h-80">
                <LineChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
                  <YAxis tickLine={false} axisLine={false} width={40} domain={[0, 100]} unit="%" allowDataOverflow />
                  <ChartTooltip content={<ChartTooltipContent formatter={(valor, nombre) => `${CONFIG[nombre as keyof typeof CONFIG]?.label ?? nombre}: ${pct(Number(valor))}`} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line dataKey="cpu" type="monotone" stroke="var(--color-cpu)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="memoria" type="monotone" stroke="var(--color-memoria)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="disco" type="monotone" stroke="var(--color-disco)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {contenedores.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contenedores</CardTitle>
                <CardDescription>La última foto no trae datos de contenedores.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Por grupo</CardTitle>
                  <CardDescription>Suma de CPU y memoria de los contenedores de cada grupo, en la última foto.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {grupos.map((g) => (
                    <div key={g.grupo} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{g.grupo}</span>
                        <Pastilla color={colorCpu(g.cpu)} />
                      </div>
                      <span className={`text-2xl font-semibold tabular-nums ${CLASES[colorCpu(g.cpu)].cifra}`}>{pct(g.cpu)}</span>
                      <span className="text-xs text-muted-foreground">
                        {gb(g.memMb)} GB · {g.contenedores.length} {g.contenedores.length === 1 ? "contenedor" : "contenedores"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contenedores</CardTitle>
                  <CardDescription>De mayor a menor CPU. Un contenedor puede pasar de 100 % si usa más de un núcleo.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contenedor</TableHead>
                        <TableHead>Grupo</TableHead>
                        <TableHead className="text-right">CPU</TableHead>
                        <TableHead className="text-right">Memoria</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contenedores.map((c) => (
                        <TableRow key={c.nombre}>
                          <TableCell className="max-w-56 truncate font-medium" title={c.nombre}>
                            {c.nombre}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{c.grupo}</TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${CLASES[colorCpu(c.cpu)].cifra}`}>{pct(c.cpu)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {gb(c.memMb)} GB
                            {c.memLimiteMb ? <span className="text-xs text-muted-foreground"> de {gb(c.memLimiteMb)}</span> : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
