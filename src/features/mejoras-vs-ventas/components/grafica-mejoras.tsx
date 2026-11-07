"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { colorDe } from "@/features/coach/components/linea/colores";

import type { CambioDelDia, FilaDelDia } from "../dominio/serie";

/**
 * La gráfica de los 30 días: leads a la izquierda y cotizaciones y ventas a la derecha (con una sola escala, 185
 * leads aplastarían 3 cotizaciones contra el piso). Cada día con cambios terminados lleva una marca; al pasar el
 * cursor (o tocar el día en el celular) se ven su código y título. Un día sin dato queda como hueco, no como 0.
 */

const CONFIG = {
  leads: { label: "Leads nuevos", theme: { light: colorDe(0).light, dark: colorDe(0).dark } },
  cotizaciones: { label: "Cotizaciones", theme: { light: colorDe(1).light, dark: colorDe(1).dark } },
  ventas: { label: "Ventas", theme: { light: colorDe(2).light, dark: colorDe(2).dark } },
} satisfies ChartConfig;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-06" → "6 nov". */
export function diaCorto(fecha: string): string {
  const [, mes, dia] = fecha.split("-").map(Number);
  return `${dia} ${MESES[mes - 1] ?? ""}`.trim();
}

type Punto = {
  etiqueta: string;
  leads: number | null;
  cotizaciones: number | null;
  ventas: number | null;
  cambios: CambioDelDia[];
};

const textoDe = (valor: number | null) => (valor === null ? "sin dato" : valor.toLocaleString("es-CO"));

function Detalle({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Punto }> }) {
  const punto = payload?.[0]?.payload;
  if (!active || !punto) return null;
  return (
    <div className="grid max-w-72 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{punto.etiqueta}</p>
      <p>
        Leads: <span className="font-mono tabular-nums">{textoDe(punto.leads)}</span> · Cotizaciones:{" "}
        <span className="font-mono tabular-nums">{textoDe(punto.cotizaciones)}</span> · Ventas:{" "}
        <span className="font-mono tabular-nums">{textoDe(punto.ventas)}</span>
      </p>
      {punto.cambios.length ? (
        <ul className="grid gap-0.5 border-t border-border/50 pt-1">
          {punto.cambios.map((cambio) => (
            <li key={cambio.codigo}>
              <span className="font-medium">{cambio.codigo}</span> {cambio.titulo}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GraficaMejoras({ filas }: { filas: FilaDelDia[] }) {
  const puntos: Punto[] = filas.map((fila) => ({
    etiqueta: diaCorto(fila.fecha),
    leads: fila.leads,
    cotizaciones: fila.cotizaciones,
    ventas: fila.ventas ? fila.ventas.total : null,
    cambios: fila.cambios,
  }));
  const hayDatos = puntos.some((p) => p.leads !== null || p.cotizaciones !== null || p.ventas !== null);

  if (!hayDatos) {
    return (
      <p className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
        No hay números de estos 30 días. Mira los avisos de arriba.
      </p>
    );
  }

  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-72 w-full sm:h-80">
      <LineChart data={puntos} margin={{ top: 16, right: 0, bottom: 0, left: -12 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis yAxisId="leads" tickLine={false} axisLine={false} width={40} allowDecimals={false} domain={[0, "auto"]} />
        <YAxis yAxisId="gestion" orientation="right" tickLine={false} axisLine={false} width={32} allowDecimals={false} domain={[0, "auto"]} />
        {puntos
          .filter((p) => p.cambios.length)
          .map((p) => (
            <ReferenceLine
              key={p.etiqueta}
              x={p.etiqueta}
              yAxisId="leads"
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{ value: `▲${p.cambios.length > 1 ? p.cambios.length : ""}`, position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
            />
          ))}
        <ChartTooltip content={<Detalle />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line yAxisId="leads" dataKey="leads" type="monotone" stroke="var(--color-leads)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        <Line
          yAxisId="gestion"
          dataKey="cotizaciones"
          type="monotone"
          stroke="var(--color-cotizaciones)"
          strokeWidth={2}
          dot={{ r: 2, fill: "var(--color-cotizaciones)" }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="gestion"
          dataKey="ventas"
          type="monotone"
          stroke="var(--color-ventas)"
          strokeWidth={2}
          dot={{ r: 2, fill: "var(--color-ventas)" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
