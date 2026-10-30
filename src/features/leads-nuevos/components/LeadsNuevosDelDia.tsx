import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadsNuevosAgrupados } from "../dominio/reglas";

/**
 * Leads nuevos de hoy de TODA la empresa (solo para el dueño y las administradoras). Las cifras son las mismas
 * que da `leads_nuevos` del MCP: salen de leadsNuevosDelDia(). Solo muestra, no escribe nada.
 */
export function LeadsNuevosDelDia({ data }: { data: LeadsNuevosAgrupados }) {
  const origen = data.por_origen;
  const filasDeOrigen: Array<[string, number]> = [
    ["Meta", origen.meta],
    ["Marketplace (por texto)", origen.marketplace.por_texto],
    ["Marketplace (por línea)", origen.marketplace.por_linea],
    ["Directo", origen.directo],
  ];
  const filasDeLinea: Array<[string, number]> = [
    ["Admin", data.por_linea.admin],
    ["Ventas 1", data.por_linea.ventas_1],
    ["Ventas 2", data.por_linea.ventas_2],
    ...(data.por_linea.otras ? ([["Otras", data.por_linea.otras]] as Array<[string, number]>) : []),
    ["Solo ventas", data.por_linea.solo_ventas],
  ];
  const filasDeAsesora: Array<[string, number]> = [
    ...data.por_asesora.map((a) => [a.asesora, a.total] as [string, number]),
    ["Sin asignar", data.sin_asignar],
  ];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Leads nuevos de hoy (empresa)</h2>
        <p className="text-xs text-muted-foreground">
          {data.fecha} · Total: <span className="text-foreground">{data.total}</span>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TablaDeConteo titulo="Por origen" filas={filasDeOrigen} />
        <TablaDeConteo titulo="Por línea" filas={filasDeLinea} />
        <TablaDeConteo titulo="Por asesora" filas={filasDeAsesora} />
      </div>
    </div>
  );
}

function TablaDeConteo({ titulo, filas }: { titulo: string; filas: Array<[string, number]> }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map(([nombre, cantidad]) => (
              <TableRow key={nombre}>
                <TableCell className="break-words">{nombre}</TableCell>
                <TableCell className="text-right font-medium">{cantidad}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
