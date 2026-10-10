import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLAVE_COMBO } from "@/features/embudo/dominio/combo";
import {
  MINIMO_PARA_COMPARAR,
  diaEnBogota,
  diasEntre,
  diferenciaEnPuntos,
  esDiaValido,
  filasDelEmbudo,
  moverDia,
  type FilaDelEmbudo,
} from "@/features/embudo/dominio/panel";
import { etiquetaDeSenal, grupoDeSenal } from "@/features/embudo/dominio/senales";
import { leerEmbudo, productosDelEmbudo, type LecturaDelEmbudo } from "@/features/embudo/servicios/leer-embudo";
import { DESDE_POR_DEFECTO, leerEstadoDelRelleno, lineasParaElRelleno } from "@/features/embudo/servicios/relleno";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

import { HistoriaDelEmbudo } from "./historia";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");
const pct = (valor: number | null) => (valor === null ? "—" : `${valor.toLocaleString("es-CO")} %`);
const puntos = (valor: number | null) =>
  valor === null ? "—" : `${valor > 0 ? "+" : ""}${valor.toLocaleString("es-CO")} pts`;

const GRUPO: Record<string, string> = {
  fuerte: "Fuerte (+4)",
  media: "Media (+2)",
  debil: "Débil (+1)",
  negativa: "Negativa",
};

/**
 * EMBUDO DEL COMBO (F1: solo mide). Para quien supervisa: de la entrada del anuncio hasta el
 * anticipo, con número, % sobre el paso anterior y sobre la entrada, la transición con más
 * abandono resaltada, las señales de compra por tipo y la comparación con otro período.
 * Los leads de menos de 72 h están "madurando": se ven, pero no entran en los %.
 */
export default async function EmbudoPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  const hoy = diaEnBogota(new Date());
  const hastaPedido = texto(params.hasta);
  const hasta = esDiaValido(hastaPedido) && hastaPedido <= hoy ? hastaPedido : hoy;
  const desdePedido = texto(params.desde);
  const desde = esDiaValido(desdePedido) && desdePedido <= hasta ? desdePedido : moverDia(hasta, -13);
  const producto = texto(params.producto) || CLAVE_COMBO;
  const incluirMezcla = texto(params.mezcla) === "1";
  // comparar: "anterior" (por defecto: el período igual de largo justo antes), "no", o "AAAA-MM-DD:AAAA-MM-DD".
  const compararPedido = texto(params.comparar) || "anterior";
  const largo = diasEntre(desde, hasta);
  let comparado: { desde: string; hasta: string } | null = null;
  if (compararPedido === "anterior") {
    comparado = { desde: moverDia(desde, -largo), hasta: moverDia(desde, -1) };
  } else if (/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(compararPedido)) {
    const [d2, h2] = compararPedido.split(":");
    if (esDiaValido(d2) && esDiaValido(h2) && d2 <= h2) comparado = { desde: d2, hasta: h2 };
  }

  // La sección "Historia" (relleno histórico) es solo del dueño: mismo criterio que `ownerOnly`.
  const esDueno = access.isOwner || access.role === "ADMIN";
  const base = { workspaceId: access.workspaceId, producto, incluirMezcla };
  const [actual, anterior, productos, historia] = await Promise.all([
    leerEmbudo({ ...base, periodo: { desde, hasta } }),
    comparado ? leerEmbudo({ ...base, periodo: comparado }) : Promise.resolve(null),
    productosDelEmbudo(access.workspaceId).catch(() => [{ clave: CLAVE_COMBO, nombre: "Combo de Camilla" }]),
    esDueno
      ? Promise.all([lineasParaElRelleno(access.workspaceId), leerEstadoDelRelleno(access.workspaceId)]).catch(() => null)
      : Promise.resolve(null),
  ]);

  const filas = filasDelEmbudo(actual.conteos);
  const filasAnteriores = anterior ? filasDelEmbudo(anterior.conteos) : null;
  const poquitos =
    actual.conteos.maduros72 < MINIMO_PARA_COMPARAR || (anterior ? anterior.conteos.maduros72 < MINIMO_PARA_COMPARAR : false);
  const nombreProducto = productos.find((item) => item.clave === producto)?.nombre ?? (producto === "todos" ? "Todos" : producto);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Embudo: {nombreProducto}</h1>
        <p className="text-sm text-muted-foreground">
          Cada lead cuenta en el día en que entró. Los de menos de 72 h (30 días para cotización y anticipo) están
          madurando y no entran en los porcentajes. Solo mide: no cambia nada del bot ni del reparto.{" "}
          <Link href="/cliente/crm/supervisor" className="underline">
            Supervisor
          </Link>
        </p>
      </div>

      <Card size="sm">
        <CardContent>
          <form method="get" action="/cliente/crm/embudo" className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Desde</span>
              <Input type="date" name="desde" defaultValue={desde} max={hoy} className="h-8 w-40" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Hasta</span>
              <Input type="date" name="hasta" defaultValue={hasta} max={hoy} className="h-8 w-40" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Producto</span>
              <NativeSelect name="producto" defaultValue={producto} className="h-8">
                {productos.map((item) => (
                  <NativeSelectOption key={item.clave} value={item.clave}>
                    {item.nombre}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value="todos">Todos</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Comparar con</span>
              <NativeSelect name="comparar" defaultValue={compararPedido === "no" ? "no" : "anterior"} className="h-8">
                <NativeSelectOption value="anterior">Período anterior</NativeSelectOption>
                <NativeSelectOption value="no">No comparar</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" name="mezcla" value="1" defaultChecked={incluirMezcla} />
              Incluir leads que cambiaron de producto
            </label>
            <Button type="submit" size="sm" variant="outline">
              Ver
            </Button>
          </form>
        </CardContent>
      </Card>

      {actual.conteos.total === 0 ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          Todavía no hay leads registrados en este período. El registro empieza a llenarse con los mensajes nuevos;
          para ver semanas pasadas, el dueño puede reconstruirlas en la sección «Historia» (abajo).
        </p>
      ) : null}

      {anterior && poquitos ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          Hay menos de {MINIMO_PARA_COMPARAR} leads maduros en uno de los períodos: la comparación no es concluyente.
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-base">
            {desde} a {hasta}
            {anterior ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                vs {anterior.periodo.desde} a {anterior.periodo.hasta}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TablaDelEmbudo filas={filas} anteriores={filasAnteriores} />
          <p className="mt-2 text-xs text-muted-foreground">
            {actual.conteos.total} leads, {actual.conteos.maduros72} maduros a 72 h y {actual.conteos.maduros30} a 30 días.
            {anterior ? ` Período comparado: ${anterior.conteos.total} leads (${anterior.conteos.maduros72} maduros).` : ""} La fila
            resaltada es la transición con más abandono.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <TarjetaDeSenales titulo={`Señales de compra (${desde} a ${hasta})`} lectura={actual} />
        {anterior ? (
          <TarjetaDeSenales titulo={`Señales (${anterior.periodo.desde} a ${anterior.periodo.hasta})`} lectura={anterior} />
        ) : null}
      </div>

      {historia ? (
        <HistoriaDelEmbudo
          lineas={historia[0].lineas}
          lineaPorDefecto={historia[0].porDefecto}
          desdePorDefecto={DESDE_POR_DEFECTO <= hoy ? DESDE_POR_DEFECTO : hoy}
          hoy={hoy}
          estadoInicial={historia[1]}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        <Link href="/cliente/crm/tablero" className="underline">
          Tablero del equipo
        </Link>
      </p>
    </div>
  );
}

function TablaDelEmbudo({ filas, anteriores }: { filas: FilaDelEmbudo[]; anteriores: FilaDelEmbudo[] | null }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Paso</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead className="text-right">Madurando</TableHead>
          <TableHead className="text-right">% del anterior</TableHead>
          <TableHead className="text-right">% de la entrada</TableHead>
          {anteriores ? <TableHead className="text-right">Antes (% del anterior)</TableHead> : null}
          {anteriores ? <TableHead className="text-right">Diferencia</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((fila, indice) => {
          const previa = anteriores?.[indice] ?? null;
          const diferencia = previa ? diferenciaEnPuntos(fila.sobreAnterior, previa.sobreAnterior) : null;
          return (
            <TableRow key={fila.clave} className={fila.esMayorAbandono ? "bg-destructive/10" : undefined}>
              <TableCell className="font-medium">
                {fila.nombre}
                {fila.esMayorAbandono ? (
                  <span className="ml-2 text-xs font-normal text-destructive">mayor abandono ({pct(fila.perdida)})</span>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fila.numero}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{fila.madurando || ""}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(fila.sobreAnterior)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(fila.sobreEntrada)}</TableCell>
              {anteriores ? (
                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(previa?.sobreAnterior ?? null)}</TableCell>
              ) : null}
              {anteriores ? (
                <TableCell
                  className={`text-right tabular-nums ${diferencia !== null && diferencia < 0 ? "text-destructive" : ""}`}
                >
                  {puntos(diferencia)}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TarjetaDeSenales({ titulo, lectura }: { titulo: string; lectura: LecturaDelEmbudo }) {
  return (
    <Card size="sm">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        {lectura.senales.length ? (
          <ul className="text-sm">
            {lectura.senales.map((senal) => (
              <li key={senal.tipo} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                <span>
                  {etiquetaDeSenal(senal.tipo)}
                  <span className="ml-1.5 text-xs text-muted-foreground">{GRUPO[grupoDeSenal(senal.tipo) ?? ""] ?? ""}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {senal.leads} leads · {senal.veces} veces
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin señales en este período.</p>
        )}
      </CardContent>
    </Card>
  );
}
