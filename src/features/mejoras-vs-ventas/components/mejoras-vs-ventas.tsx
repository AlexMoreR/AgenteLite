"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { FilaDelDia } from "../dominio/serie";
import type { MejorasVsVentas as Datos } from "../servicios/leer-mejoras-vs-ventas";
import { GraficaMejoras, diaCorto } from "./grafica-mejoras";

/**
 * Dirección → Mejoras vs ventas (solo lectura): cotizaciones de hoy contra la meta, la gráfica de 30 días con las
 * marcas de los cambios y la tabla por día. Solo presenta: los números llegan armados por leerMejorasVsVentas.
 */

const SIN_DATO = "sin dato";
const numero = (valor: number | null) => (valor === null ? SIN_DATO : valor.toLocaleString("es-CO"));
const porciento = (valor: number | null) => (valor === null ? "—" : `${valor.toLocaleString("es-CO")} %`);

function Ventas({ fila }: { fila: FilaDelDia }) {
  if (!fila.ventas) return <span className="text-muted-foreground">{SIN_DATO}</span>;
  const { total, nuevos, recurrentes, sinClasificar } = fila.ventas;
  return (
    <span className="flex flex-col">
      <span className="font-medium tabular-nums">{total}</span>
      {total ? (
        <span className="text-xs text-muted-foreground">
          {nuevos} nuevos · {recurrentes} recurrentes{sinClasificar ? ` · ${sinClasificar} sin clasificar` : ""}
        </span>
      ) : null}
    </span>
  );
}

export function MejorasVsVentas({ datos }: { datos: Datos }) {
  const { cotizacionesDeHoy, meta } = datos;
  const llego = cotizacionesDeHoy !== null && cotizacionesDeHoy >= meta;
  // De la más nueva a la más vieja: lo de hoy arriba.
  const filas = [...datos.filas].reverse();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Mejoras vs ventas</h1>
        <p className="text-sm text-muted-foreground">Qué se cambió cada día y cómo se movieron los números después. Solo lectura.</p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Cotizaciones de hoy</CardDescription>
          <CardTitle className="text-4xl tabular-nums">
            {cotizacionesDeHoy === null ? "Sin dato" : cotizacionesDeHoy.toLocaleString("es-CO")}{" "}
            <span className="text-lg font-normal text-muted-foreground">de {meta}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {cotizacionesDeHoy === null
            ? "Gestión no respondió: no se sabe cuántas van hoy."
            : llego
              ? "Meta del día cumplida."
              : `Faltan ${meta - cotizacionesDeHoy} para la meta del día.`}
        </CardContent>
      </Card>

      {datos.avisos.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {datos.avisos.map((aviso) => (
            <li key={aviso}>{aviso}</li>
          ))}
        </ul>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimos 30 días</CardTitle>
          <CardDescription>
            Leads en la escala de la izquierda; cotizaciones y ventas en la de la derecha. ▲ = día con cambios terminados (pasa el cursor o toca el día para verlos).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GraficaMejoras filas={datos.filas} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Día por día</CardTitle>
          <CardDescription>
            {datos.base} El % cotización → venta compara ventas y cotizaciones del mismo día: la venta de hoy suele venir de una cotización anterior, así que puede pasar de 100 %. Ver juntos un cambio y una subida no prueba que el cambio la causó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Cotizaciones</TableHead>
                <TableHead>Ventas</TableHead>
                <TableHead className="text-right">Lead → cotización</TableHead>
                <TableHead className="text-right">Cotización → venta</TableHead>
                <TableHead>Cambios aplicados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila) => (
                <TableRow key={fila.fecha}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {diaCorto(fila.fecha)}
                    {fila.fecha === datos.hoy ? <span className="ml-1 text-xs text-muted-foreground">(hoy)</span> : null}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${fila.leads === null ? "text-muted-foreground" : ""}`}>{numero(fila.leads)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${fila.cotizaciones === null ? "text-muted-foreground" : ""}`}>
                    {numero(fila.cotizaciones)}
                  </TableCell>
                  <TableCell>
                    <Ventas fila={fila} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{porciento(fila.porcentajeLeadACotizacion)}</TableCell>
                  <TableCell className="text-right tabular-nums">{porciento(fila.porcentajeCotizacionAVenta)}</TableCell>
                  <TableCell className="min-w-56 whitespace-normal">
                    {fila.cambios.length ? (
                      <ul className="flex flex-col gap-0.5 text-xs">
                        {fila.cambios.map((cambio) => (
                          <li key={cambio.codigo}>
                            <span className="font-medium">{cambio.codigo}</span> {cambio.titulo}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
