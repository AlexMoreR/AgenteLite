"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { textoDinero, textoTasa } from "../dominio/reporte";
import type { ClaveDelMapa } from "../dominio/mapa";
import type { DepartamentoDelMapa, MapaDelMes } from "../servicios/leer-mapa";
import { FORMAS_DEPARTAMENTOS, RECUADRO_SAN_ANDRES, VIEWBOX_MAPA } from "./mapa-colombia-formas";

/**
 * Dirección → Mapa de Colombia: por departamento, el gasto de Meta Ads (de más claro a más oscuro),
 * los chats que llegaron y las ventas de un mes. En rojo, donde se gasta y no se vende (últimos 60 días).
 * Solo presenta: los números llegan armados por servicios/leer-mapa.ts. El mes va en ?mes=AAAA-MM.
 */

/** Cinco tonos del color del tema, del más claro al más oscuro. */
const TONOS = ["fill-primary/15", "fill-primary/30", "fill-primary/50", "fill-primary/70", "fill-primary/90"];

function claseDelDepartamento(d: DepartamentoDelMapa, gastoMaximo: number): string {
  if (d.rojo) return "fill-destructive";
  if (!d.gasto || gastoMaximo <= 0) return "fill-muted";
  const paso = Math.min(TONOS.length, Math.max(1, Math.ceil((d.gasto / gastoMaximo) * TONOS.length)));
  return TONOS[paso - 1];
}

const textoCantidad = (valor: number | null) => (valor === null ? "No disponible" : valor.toLocaleString("es-CO"));

function Detalle({ d, mapa }: { d: DepartamentoDelMapa; mapa: MapaDelMes }) {
  const gastoDisponible = mapa.fuentes.gasto === "ok";
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Gasto en Meta Ads</dt>
      <dd className="text-right font-medium">{gastoDisponible ? textoDinero(d.gasto) : "No disponible"}</dd>
      <dt className="text-muted-foreground">Del gasto total</dt>
      <dd className="text-right font-medium">{gastoDisponible ? textoTasa(d.porcentajeDelGasto ?? 0) : "No disponible"}</dd>
      <dt className="text-muted-foreground">Chats que llegaron</dt>
      <dd className="text-right font-medium">{textoCantidad(d.chats)}</dd>
      <dt className="text-muted-foreground">Ventas</dt>
      <dd className="text-right font-medium">{textoCantidad(d.ventas)}</dd>
      <dt className="text-muted-foreground">Valor vendido</dt>
      <dd className="text-right font-medium">{d.valorVendido === null ? "No disponible" : textoDinero(d.valorVendido)}</dd>
    </dl>
  );
}

export function MapaColombia({ mapa, error }: { mapa: MapaDelMes; error?: string | null }) {
  const router = useRouter();
  const [elegido, setElegido] = useState<ClaveDelMapa | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // En el celular el panel queda debajo del mapa: al elegir, se lleva la vista hasta él.
  const elegir = (clave: ClaveDelMapa) => {
    setElegido(clave);
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const gastoMaximo = Math.max(0, ...mapa.departamentos.map((d) => d.gasto ?? 0));
  const seleccion = [...mapa.departamentos, mapa.sinUbicar, mapa.otrasRegiones].find((d) => d.clave === elegido) ?? null;
  // Bogotá va de último para que quede encima de Cundinamarca.
  const enOrden = [...mapa.departamentos.filter((d) => d.clave !== "bogota"), ...mapa.departamentos.filter((d) => d.clave === "bogota")];
  // El rojo siempre termina hoy (hora de Colombia): de ahí sale el último mes que se puede pedir.
  const mesActual = mapa.rojo.hasta.slice(0, 7);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Mapa de Colombia: dónde se gasta y dónde se vende</h1>
        <p className="text-sm text-muted-foreground">
          Del {mapa.desde} al {mapa.hasta}. Más oscuro = más gasto en Meta Ads. En rojo: gasta y no vende en los últimos {mapa.rojo.dias} días
          (del {mapa.rojo.desde} al {mapa.rojo.hasta}).
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Mes
          <Input
            type="month"
            name="mes"
            defaultValue={mapa.mes}
            max={mesActual}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) router.push(`?mes=${e.target.value}`);
            }}
          />
        </label>
        <Button type="submit">Ver</Button>
      </form>

      {error ? <p className="text-sm text-destructive">{error} Se muestra el mes en curso.</p> : null}

      <div className="flex flex-wrap gap-2">
        {mapa.fuentes.gasto !== "ok" ? <Badge variant="outline">Gasto: no disponible</Badge> : null}
        {mapa.fuentes.chats !== "ok" ? <Badge variant="outline">Chats: no disponibles</Badge> : null}
        {mapa.fuentes.ventas !== "ok" ? <Badge variant="outline">Ventas: no disponibles</Badge> : null}
        {!mapa.rojo.datosSuficientes ? <Badge variant="outline">Sin datos para marcar el rojo</Badge> : null}
      </div>
      {mapa.aviso ? (
        <p className="rounded-lg border border-destructive/40 p-3 text-sm">
          {mapa.aviso} El rojo puede no ser exacto.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardContent>
            <svg viewBox={VIEWBOX_MAPA} role="group" aria-label="Mapa de Colombia por departamento" className="mx-auto h-auto w-full max-w-md">
              <rect
                x={RECUADRO_SAN_ANDRES.x}
                y={RECUADRO_SAN_ANDRES.y}
                width={RECUADRO_SAN_ANDRES.ancho}
                height={RECUADRO_SAN_ANDRES.alto}
                rx={4}
                className="fill-none stroke-border"
              />
              <text x={RECUADRO_SAN_ANDRES.x + 4} y={RECUADRO_SAN_ANDRES.y + RECUADRO_SAN_ANDRES.alto - 4} className="fill-muted-foreground text-[7px]">
                San Andrés
              </text>
              {enOrden.map((d) => (
                <path
                  key={d.clave}
                  d={FORMAS_DEPARTAMENTOS[d.clave as keyof typeof FORMAS_DEPARTAMENTOS]}
                  role="button"
                  tabIndex={0}
                  aria-label={d.nombre}
                  aria-pressed={elegido === d.clave}
                  onClick={() => elegir(d.clave)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      elegir(d.clave);
                    }
                  }}
                  className={cn(
                    claseDelDepartamento(d, gastoMaximo),
                    "cursor-pointer stroke-background outline-none hover:opacity-80 focus-visible:stroke-ring",
                    elegido === d.clave ? "stroke-foreground [stroke-width:2]" : "[stroke-width:0.8]",
                  )}
                >
                  <title>{d.nombre}</title>
                </path>
              ))}
            </svg>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm bg-primary/15" /> Poco gasto
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm bg-primary/90" /> Mucho gasto
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm bg-muted" /> Sin gasto
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm bg-destructive" /> Gasta y no vende
              </span>
            </div>
          </CardContent>
        </Card>

        <Card ref={panel} className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="text-base">{seleccion ? seleccion.nombre : "Toca un departamento"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* Los departamentos chicos (Bogotá, Quindío, San Andrés...) cuestan con el dedo: también se eligen aquí. */}
            <label className="flex flex-col gap-1 text-xs">
              Departamento
              <NativeSelect
                className="w-full"
                value={elegido ?? ""}
                onChange={(e) => {
                  if (e.target.value) setElegido(e.target.value as ClaveDelMapa);
                }}
              >
                <NativeSelectOption value="">Elegir…</NativeSelectOption>
                {[...mapa.departamentos, mapa.sinUbicar, mapa.otrasRegiones].map((d) => (
                  <NativeSelectOption key={d.clave} value={d.clave}>
                    {d.nombre}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {seleccion ? (
              <>
                {seleccion.rojo ? <Badge variant="destructive">Gasta y no vende ({mapa.rojo.dias} días)</Badge> : null}
                <Detalle d={seleccion} mapa={mapa} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Toca un departamento del mapa (o elígelo en la lista) para ver su gasto, sus chats y sus ventas del mes.</p>
            )}
            <div className="border-t pt-3 text-sm">
              <p className="font-medium">Total del mes</p>
              <p className="text-muted-foreground">
                Gasto {mapa.totales.gasto === null ? "no disponible" : textoDinero(mapa.totales.gasto)} · {textoCantidad(mapa.totales.chats)} chats ·{" "}
                {textoCantidad(mapa.totales.ventas)} ventas · {mapa.totales.valorVendido === null ? "valor no disponible" : textoDinero(mapa.totales.valorVendido)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lo que no cae en un departamento</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Chats</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Valor vendido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[mapa.sinUbicar, mapa.otrasRegiones].map((d) => (
                <TableRow key={d.clave}>
                  <TableCell className="font-medium">
                    <button type="button" className="underline-offset-4 hover:underline" onClick={() => elegir(d.clave)}>
                      {d.nombre}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">{mapa.fuentes.gasto === "ok" ? textoDinero(d.gasto) : "No disponible"}</TableCell>
                  <TableCell className="text-right">{textoCantidad(d.chats)}</TableCell>
                  <TableCell className="text-right">{textoCantidad(d.ventas)}</TableCell>
                  <TableCell className="text-right">{d.valorVendido === null ? "No disponible" : textoDinero(d.valorVendido)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Sin ubicar: el chat o la venta no dice la ciudad. Otras regiones: Meta las nombra, pero no son un departamento de Colombia.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
