import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { textoDinero, textoTasa, type FilaDePauta } from "../dominio/reporte";
import type { LecturaDePauta } from "../servicios/leer-reporte";

/**
 * CRM → Pauta: por campaña y anuncio, en un rango de fechas. Solo presenta (los números llegan
 * armados por dominio/reporte.ts, el mismo cálculo de la herramienta ventas_por_campana).
 * Filtros: formulario GET sin JavaScript.
 */

function Fila({ fila, gastoDisponible, sangria = false }: { fila: FilaDePauta; gastoDisponible: boolean; sangria?: boolean }) {
  return (
    <TableRow>
      <TableCell className={sangria ? "pl-6 text-muted-foreground" : "font-medium"}>{fila.nombre}</TableCell>
      <TableCell className="text-right">{gastoDisponible ? textoDinero(fila.gasto) : "No disponible"}</TableCell>
      <TableCell className="text-right">{fila.chats}</TableCell>
      <TableCell className="text-right">{fila.calientes}</TableCell>
      <TableCell className="text-right">{fila.ventas}</TableCell>
      <TableCell className="text-right">{textoDinero(fila.monto)}</TableCell>
      <TableCell className="text-right">{textoTasa(fila.tasaCierre)}</TableCell>
      <TableCell className="text-right">{textoDinero(fila.costoPorVenta)}</TableCell>
    </TableRow>
  );
}

export function ReportePauta({ lectura }: { lectura: LecturaDePauta }) {
  const { reporte } = lectura;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Pauta: qué campaña vende</h1>
        <p className="text-sm text-muted-foreground">
          Del {lectura.desde} al {lectura.hasta}. Tasa de cierre = ventas ÷ chats; costo por venta = gasto ÷ ventas.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Desde
          <Input type="date" name="desde" defaultValue={lectura.desde} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Hasta
          <Input type="date" name="hasta" defaultValue={lectura.hasta} />
        </label>
        <Button type="submit">Ver</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {!reporte.gastoDisponible ? <Badge variant="outline">Gasto: no disponible (falta conectar Meta Ads en solo lectura)</Badge> : null}
        {lectura.fuenteDeVentas === "crm" ? <Badge variant="outline">Ventas contadas con los GANADO del CRM, sin monto</Badge> : null}
        {lectura.fuenteDeVentas === "sin_datos" ? <Badge variant="outline">Todavía no hay ventas guardadas en este rango</Badge> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por campaña y anuncio</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaña / anuncio</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Chats</TableHead>
                <TableHead className="text-right">Calientes</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Monto vendido</TableHead>
                <TableHead className="text-right">Tasa de cierre</TableHead>
                <TableHead className="text-right">Costo por venta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reporte.campanas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No hay chats de anuncios en este rango.
                  </TableCell>
                </TableRow>
              ) : null}
              {reporte.campanas.map((campana) => (
                <FilaConAnuncios key={campana.clave} campana={campana} gastoDisponible={reporte.gastoDisponible} />
              ))}
              <Fila fila={reporte.organico} gastoDisponible={false} />
              <Fila fila={reporte.total} gastoDisponible={reporte.gastoDisponible} />
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilaConAnuncios({ campana, gastoDisponible }: { campana: FilaDePauta & { anuncios: FilaDePauta[] }; gastoDisponible: boolean }) {
  return (
    <>
      <Fila fila={campana} gastoDisponible={gastoDisponible} />
      {campana.anuncios.map((anuncio) => (
        <Fila key={anuncio.clave} fila={anuncio} gastoDisponible={gastoDisponible} sangria />
      ))}
    </>
  );
}
