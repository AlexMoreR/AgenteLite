"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import type { AsesoraDeLaSerie, FilaDeSerie, MetricaDeLinea } from "../../dominio/linea-de-tiempo";
import { colorDe, indiceDeClave } from "./colores";

/**
 * Linea de tiempo del Coach: x = dia, una linea por asesora. Un dia sin informe queda como hueco
 * (null, sin unir los puntos): no es un cero.
 */
export function GraficoDelCoach({
  filas,
  asesoras,
  metrica,
}: {
  filas: FilaDeSerie[];
  asesoras: AsesoraDeLaSerie[];
  metrica: MetricaDeLinea;
}) {
  const config = asesoras.reduce<ChartConfig>((acc, a) => {
    const color = colorDe(indiceDeClave(a.clave));
    acc[a.clave] = { label: a.nombre, theme: { light: color.light, dark: color.dark } };
    return acc;
  }, {});
  const hayDatos = filas.some((f) => asesoras.some((a) => typeof f[a.clave] === "number"));

  if (!hayDatos) {
    return (
      <p className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
        No hay informes del Coach en estas fechas.
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72">
      <LineChart data={filas} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          allowDecimals={metrica.clave === "puntaje"}
          domain={metrica.clave === "puntaje" ? [0, 10] : [0, "auto"]}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {asesoras.map((a) => (
          <Line
            key={a.clave}
            dataKey={a.clave}
            type="monotone"
            stroke={`var(--color-${a.clave})`}
            strokeWidth={2}
            dot={{ r: 3, fill: `var(--color-${a.clave})` }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
