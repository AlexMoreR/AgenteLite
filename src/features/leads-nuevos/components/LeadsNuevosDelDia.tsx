import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadsNuevosAgrupados } from "../dominio/reglas";

/**
 * Leads nuevos de hoy en toda la empresa (solo dueño y administradoras). Son las mismas cifras de
 * `leads_nuevos` del MCP: salen de `leadsNuevosDelDia`.
 */
export function LeadsNuevosDelDia({ datos }: { datos: LeadsNuevosAgrupados }) {
  const origen = datos.por_origen;
  const linea = datos.por_linea;
  const filasOrigen: Array<[string, number]> = [
    ["Meta", origen.meta],
    ["Marketplace (total)", origen.marketplace.total],
    ["  por texto", origen.marketplace.por_texto],
    ["  por línea", origen.marketplace.por_linea],
    ["Directo", origen.directo],
  ];
  const filasLinea: Array<[string, number]> = [
    ["Admin", linea.admin],
    ["Ventas 1", linea.ventas_1],
    ["Ventas 2", linea.ventas_2],
    ["Solo ventas", linea.solo_ventas],
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Leads nuevos de hoy (empresa) · {datos.total} <span className="text-xs font-normal text-muted-foreground">{datos.fecha}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Tabla titulo="Por origen" filas={filasOrigen} />
        <Tabla titulo="Por línea" filas={filasLinea} />
        <Tabla
          titulo="Por asesora"
          filas={[...datos.por_asesora.map((a): [string, number] => [a.asesora, a.total]), ["Sin asignar", datos.sin_asignar]]}
        />
      </CardContent>
    </Card>
  );
}

function Tabla({ titulo, filas }: { titulo: string; filas: Array<[string, number]> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{titulo}</TableHead>
          <TableHead className="text-right">Leads</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map(([nombre, cantidad]) => (
          <TableRow key={nombre}>
            <TableCell className="whitespace-pre text-xs">{nombre}</TableCell>
            <TableCell className="text-right text-xs">{cantidad}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
