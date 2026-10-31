"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { textoDinero } from "../dominio/reporte";
import type { DepartamentoDelMapa, MapaDelMes } from "../servicios/leer-mapa";
import { FORMAS_DE_DEPARTAMENTOS, RECUADRO_SAN_ANDRES, VIEWBOX } from "./mapa-colombia-formas";

/**
 * Dirección → Mapa de Colombia: cada departamento pintado según el gasto de Meta del mes (de más claro a
 * más oscuro) y en rojo los que gastan y no venden (los últimos días del rojo). Al tocar uno se abre su
 * panel con gasto, chats, ventas y valor vendido. Solo presenta: los números llegan armados por leerMapa.
 */

/** Del más claro al más oscuro. Clases completas para que Tailwind las encuentre. */
const TONOS = ["fill-primary/15", "fill-primary/30", "fill-primary/50", "fill-primary/70", "fill-primary/90"];

function tonoDelGasto(gasto: number | null, maximo: number): string {
  if (!gasto || gasto <= 0 || maximo <= 0) return "fill-muted";
  const indice = Math.min(TONOS.length - 1, Math.floor((gasto / maximo) * TONOS.length));
  return TONOS[indice];
}

const textoNumero = (valor: number | null) => (valor === null ? "No disponible" : valor.toLocaleString("es-CO"));
const textoGasto = (d: DepartamentoDelMapa) =>
  d.gasto === null ? "No disponible" : `${textoDinero(d.gasto)}${d.porcentajeDelGasto !== null ? ` (${d.porcentajeDelGasto.toLocaleString("es-CO")} % del total)` : ""}`;
const textoValor = (valor: number | null) => (valor === null ? "No disponible" : textoDinero(valor));

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{titulo}</span>
      <span className="text-sm font-medium">{valor}</span>
    </div>
  );
}

function Numeros({ departamento }: { departamento: DepartamentoDelMapa }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Dato titulo="Gasto en Meta Ads" valor={textoGasto(departamento)} />
      <Dato titulo="Chats que llegaron" valor={textoNumero(departamento.chats)} />
      <Dato titulo="Ventas" valor={textoNumero(departamento.ventas)} />
      <Dato titulo="Valor vendido" valor={textoValor(departamento.valorVendido)} />
    </div>
  );
}

function PanelDelDepartamento({ departamento, mapa, onCerrar }: { departamento: DepartamentoDelMapa; mapa: MapaDelMes; onCerrar: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{departamento.nombre}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Numeros departamento={departamento} />
        {departamento.rojo ? (
          <p className="text-sm text-destructive">
            En rojo: en los últimos {mapa.rojo.dias} días gastó {textoDinero(departamento.gasto60d)} en Meta y no tuvo ventas.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MapaColombia({ mapa, meses, error }: { mapa: MapaDelMes; meses: string[]; error?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [cargando, arrancar] = useTransition();
  const [elegido, setElegido] = useState<string | null>(null);

  const porClave = new Map(mapa.departamentos.map((d) => [d.clave, d]));
  const maximo = Math.max(0, ...mapa.departamentos.map((d) => d.gasto ?? 0));
  const seleccionado = elegido ? porClave.get(elegido as DepartamentoDelMapa["clave"]) ?? null : null;
  const opciones = meses.includes(mapa.mes) ? meses : [mapa.mes, ...meses];

  const cambiarMes = (mes: string) => {
    setElegido(null);
    arrancar(() => router.push(`${pathname}?mes=${encodeURIComponent(mes)}`));
  };

  const forma = (clave: DepartamentoDelMapa["clave"], d: string) => {
    const departamento = porClave.get(clave);
    if (!departamento) return null;
    const color = departamento.rojo ? "fill-destructive" : tonoDelGasto(departamento.gasto, maximo);
    const activo = elegido === clave;
    return (
      <path
        key={clave}
        d={d}
        role="button"
        tabIndex={0}
        aria-label={departamento.nombre}
        aria-pressed={activo}
        className={`${color} cursor-pointer stroke-background outline-none hover:opacity-80 focus-visible:stroke-foreground ${activo ? "stroke-foreground" : ""}`}
        strokeWidth={activo ? 3 : 1.5}
        strokeLinejoin="round"
        onClick={() => setElegido(activo ? null : clave)}
        onKeyDown={(evento) => {
          if (evento.key === "Enter" || evento.key === " ") {
            evento.preventDefault();
            setElegido(activo ? null : clave);
          }
        }}
      >
        <title>{departamento.nombre}</title>
      </path>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Mapa de Colombia: gasto, chats y ventas</h1>
        <p className="text-sm text-muted-foreground">
          Del {mapa.desde} al {mapa.hasta}. Más oscuro = más gasto en Meta Ads. En rojo: gastó en los últimos {mapa.rojo.dias} días (del{" "}
          {mapa.rojo.desde} al {mapa.rojo.hasta}) y no vendió.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Mes
          <NativeSelect value={mapa.mes} onChange={(evento) => cambiarMes(evento.target.value)} disabled={cargando} aria-label="Mes">
            {opciones.map((mes) => (
              <NativeSelectOption key={mes} value={mes}>
                {mes}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {cargando ? <span className="pb-1.5 text-xs text-muted-foreground">Cargando…</span> : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {mapa.fuentes.gasto === "no disponible" ? <Badge variant="outline">Gasto no disponible: Meta Ads no respondió</Badge> : null}
        {mapa.fuentes.chats === "no disponible" ? <Badge variant="outline">Chats no disponibles</Badge> : null}
        {mapa.fuentes.ventas === "no disponible" ? <Badge variant="outline">Ventas no disponibles</Badge> : null}
        {!mapa.rojo.datosSuficientes ? <Badge variant="outline">Rojo sin calcular: faltan datos de {mapa.rojo.dias} días</Badge> : null}
      </div>

      {mapa.aviso ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {mapa.aviso} Por eso el rojo puede no ser exacto.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card>
          <CardContent>
            <svg viewBox={VIEWBOX} className="mx-auto h-auto w-full max-w-xl" role="group" aria-label="Mapa de Colombia por departamento">
              {Object.entries(FORMAS_DE_DEPARTAMENTOS)
                .filter(([clave]) => clave !== "san-andres")
                .map(([clave, d]) => forma(clave as DepartamentoDelMapa["clave"], d))}
              <rect
                x={RECUADRO_SAN_ANDRES.x}
                y={RECUADRO_SAN_ANDRES.y}
                width={RECUADRO_SAN_ANDRES.ancho}
                height={RECUADRO_SAN_ANDRES.alto}
                rx={8}
                className="fill-none stroke-border"
                strokeWidth={2}
              />
              {forma("san-andres", FORMAS_DE_DEPARTAMENTOS["san-andres"])}
              <text
                x={RECUADRO_SAN_ANDRES.x + RECUADRO_SAN_ANDRES.ancho / 2}
                y={RECUADRO_SAN_ANDRES.y + RECUADRO_SAN_ANDRES.alto - 12}
                textAnchor="middle"
                className="pointer-events-none fill-muted-foreground text-[30px]"
              >
                San Andrés
              </text>
            </svg>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 10 10" className="size-3" aria-hidden="true">
                  <rect width="10" height="10" className="fill-muted" />
                </svg>
                Sin gasto
              </span>
              <span className="flex items-center gap-1">
                Menos gasto
                {TONOS.map((tono) => (
                  <svg key={tono} viewBox="0 0 10 10" className="size-3" aria-hidden="true">
                    <rect width="10" height="10" className={tono} />
                  </svg>
                ))}
                Más gasto
              </span>
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 10 10" className="size-3" aria-hidden="true">
                  <rect width="10" height="10" className="fill-destructive" />
                </svg>
                Gasta y no vende
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {seleccionado ? (
            <PanelDelDepartamento departamento={seleccionado} mapa={mapa} onCerrar={() => setElegido(null)} />
          ) : (
            <Card>
              <CardContent className="text-sm text-muted-foreground">Toca un departamento para ver su gasto, chats y ventas.</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Total del mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Dato titulo="Gasto en Meta Ads" valor={textoValor(mapa.totales.gasto)} />
                <Dato titulo="Chats que llegaron" valor={textoNumero(mapa.totales.chats)} />
                <Dato titulo="Ventas" valor={textoNumero(mapa.totales.ventas)} />
                <Dato titulo="Valor vendido" valor={textoValor(mapa.totales.valorVendido)} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{mapa.sinUbicar.nombre}</CardTitle>
            <p className="text-xs text-muted-foreground">Chats y ventas sin ciudad ni departamento conocido.</p>
          </CardHeader>
          <CardContent>
            <Numeros departamento={mapa.sinUbicar} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{mapa.otrasRegiones.nombre}</CardTitle>
            <p className="text-xs text-muted-foreground">Regiones que Meta nombra y no son un departamento de la lista.</p>
          </CardHeader>
          <CardContent>
            <Numeros departamento={mapa.otrasRegiones} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
