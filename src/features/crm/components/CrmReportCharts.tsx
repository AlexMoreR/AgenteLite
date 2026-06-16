"use client";

import * as React from "react";
import { Bar, BarChart, Cell, Label, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const STAGE_COLORS = ["#2563eb", "#0ea5e9", "#f59e0b", "#ef4444", "#10b981", "#6b7280"];
const ORIGIN_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6"];

export function CrmStageChart({
  rows,
}: {
  rows: Array<{ label: string; value: number }>;
}) {
  const data = rows.map((row, index) => ({
    ...row,
    fill: STAGE_COLORS[index % STAGE_COLORS.length],
  }));

  const config: ChartConfig = {
    value: { label: "Registros" },
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Distribucion por etapa</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ left: 8, right: 32 }}
          >
            <XAxis type="number" dataKey="value" hide />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={80}
              tick={{ fontSize: 12 }}
            />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey="value" radius={6}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
              <LabelList dataKey="value" position="right" className="fill-foreground" fontSize={12} />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function CrmOriginChart({
  rows,
}: {
  rows: Array<{ label: string; value: number }>;
}) {
  const data = rows.map((row, index) => ({
    ...row,
    fill: ORIGIN_COLORS[index % ORIGIN_COLORS.length],
  }));

  const total = data.reduce((sum, row) => sum + row.value, 0);

  const config: ChartConfig = data.reduce<ChartConfig>((acc, row) => {
    acc[row.label] = { label: row.label, color: row.fill };
    return acc;
  }, {});

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Origen de registros</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="mx-auto aspect-square h-[260px]">
          <PieChart>
            <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="label" hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={60} strokeWidth={4}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="label" />} className="flex-wrap gap-2" />
          </PieChart>
        </ChartContainer>
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          Total <span className="font-semibold text-foreground">{total}</span> registros
        </p>
      </CardContent>
    </Card>
  );
}

export function CrmTodayChart({
  total,
  nuevos,
  ganados,
  descartados,
}: {
  total: number;
  nuevos: number;
  ganados: number;
  descartados: number;
}) {
  const enProceso = Math.max(0, total - nuevos - ganados - descartados);

  const data = [
    { label: "Nuevos", value: nuevos, fill: "#f59e0b" },
    { label: "En proceso", value: enProceso, fill: "#2563eb" },
    { label: "Ganados", value: ganados, fill: "#10b981" },
    { label: "Descartados", value: descartados, fill: "#ef4444" },
  ];

  const config: ChartConfig = data.reduce<ChartConfig>((acc, row) => {
    acc[row.label] = { label: row.label, color: row.fill };
    return acc;
  }, {});

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Actividad de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="mx-auto aspect-square h-[240px]">
          <PieChart>
            <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="label" hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={60} strokeWidth={4}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                          {total}
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="label" />} className="flex-wrap gap-2" />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
