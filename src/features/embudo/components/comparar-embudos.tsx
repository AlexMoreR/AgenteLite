import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  MINIMO_DE_CHATS,
  type Comparacion,
  type Diferencia,
  type IndicadorComparado,
  type ResumenDeVersion,
} from "../dominio/comparar";
import { textoPct } from "../dominio/semanal";

/**
 * LA PANTALLA "COMPARAR EMBUDOS": dos versiones lado a lado. Solo presenta: los números llegan
 * armados (dominio/comparar.ts, el mismo cálculo del MCP). Sin JavaScript del lado del cliente.
 *
 * Mobile-first: las dos versiones se apilan en una columna y desde `md` van lado a lado. La
 * diferencia de la derecha frente a la izquierda sale en verde si mejora y en rojo si empeora.
 */

const TONO: Record<Diferencia["tono"], string> = {
  mejor: "font-bold text-green-700 dark:text-green-400",
  peor: "font-bold text-red-700 dark:text-red-400",
  igual: "font-semibold text-muted-foreground",
  nada: "text-muted-foreground",
};

const moneda = (valor: number | null) => (valor === null ? "No disponible" : `$${Math.round(valor).toLocaleString("es-CO")}`);

type Fila = {
  clave: IndicadorComparado;
  nombre: string;
  valor: (resumen: ResumenDeVersion) => string;
};

const FILAS: Fila[] = [
  { clave: "chats", nombre: "Chats que entraron", valor: (r) => r.chats.toLocaleString("es-CO") },
  { clave: "respondio", nombre: "Respondió la bienvenida", valor: (r) => textoPct(r.pctRespondio) },
  { clave: "ciudad", nombre: "Dio su ciudad", valor: (r) => textoPct(r.pctCiudad) },
  { clave: "caliente", nombre: "Llegó a Caliente (cotización)", valor: (r) => textoPct(r.pctCaliente) },
  { clave: "cierre", nombre: "Compró (tasa de cierre)", valor: (r) => textoPct(r.tasaCierre) },
  {
    clave: "dias",
    nombre: "Días promedio hasta la venta",
    valor: (r) => (r.diasHastaVenta === null ? "Sin dato" : r.diasHastaVenta.toLocaleString("es-CO", { maximumFractionDigits: 1 })),
  },
  { clave: "plata", nombre: "Plata vendida", valor: (r) => moneda(r.plata) },
];

function EmbudoDibujado({ resumen }: { resumen: ResumenDeVersion }) {
  const caida = resumen.mayorCaida;
  return (
    <ol className="flex flex-col gap-2" aria-label={`Embudo de ${resumen.etiqueta}`}>
      {resumen.pasos.map((paso) => {
        const ancho = paso.pct === null ? 0 : Math.max(paso.pct, paso.leads > 0 ? 3 : 0);
        const seCae = caida?.desde === paso.clave;
        return (
          <li key={paso.clave} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-foreground">{paso.nombre}</span>
              <span className="text-muted-foreground">
                {paso.leads.toLocaleString("es-CO")} · {textoPct(paso.pct)}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", seCae ? "bg-red-500" : "bg-primary")}
                style={{ width: `${ancho}%` }}
              />
            </div>
          </li>
        );
      })}
      <li className="text-xs text-muted-foreground">
        {caida
          ? `Se cae más entre «${caida.desdeNombre}» y «${caida.haciaNombre}»: se quedan ${caida.quedaron} (${caida.pctQuedaron} %).`
          : "No hay caída que señalar."}
      </li>
    </ol>
  );
}

function ColumnaDeVersion({ resumen, comparacion, lado }: { resumen: ResumenDeVersion; comparacion: Comparacion; lado: "a" | "b" }) {
  const gana = comparacion.ganadora === lado;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
          {resumen.etiqueta}
          {gana ? <Badge className="bg-green-600 text-white">Vende más</Badge> : null}
          {resumen.faltanDatos ? <Badge variant="outline">Faltan datos</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col divide-y divide-border">
          {FILAS.map((fila) => (
            <div key={fila.clave} className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-sm text-muted-foreground">{fila.nombre}</dt>
              <dd className="flex flex-col items-end text-right">
                <span className="text-base font-bold text-foreground">{fila.valor(resumen)}</span>
                {lado === "b" ? (
                  <span className={cn("text-xs", TONO[comparacion.diferencias[fila.clave].tono])}>
                    {comparacion.diferencias[fila.clave].texto}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <EmbudoDibujado resumen={resumen} />
      </CardContent>
    </Card>
  );
}

export type CompararEmbudosVistaProps = {
  comparacion: Comparacion | null;
  /** El embudo está apagado (embudo:activo:<negocio> = false). */
  apagado: boolean;
  etiquetaRango: string;
  nombreProducto: string;
  versionesConChats: number;
  /** La prueba A/B (Embudo 5) todavía no existe: el botón va apagado. */
  hrefPruebaAb: string | null;
  filtros: React.ReactNode;
};

export function CompararEmbudosVista(props: CompararEmbudosVistaProps) {
  const { comparacion } = props;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-5 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-foreground">Comparar embudos</h1>
        <p className="text-sm text-muted-foreground">
          {props.nombreProducto} · {props.etiquetaRango}. Cada versión es la del libro con la que entró el chat.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {props.hrefPruebaAb ? (
            <a
              href={props.hrefPruebaAb}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted"
            >
              Prueba A/B activa
            </a>
          ) : (
            <>
              <span
                aria-disabled="true"
                className="inline-flex min-h-11 items-center rounded-full border border-dashed border-border px-4 text-sm font-semibold text-muted-foreground opacity-60"
              >
                Prueba A/B activa
              </span>
              <span className="text-xs text-muted-foreground">Todavía no hay una prueba A/B registrada.</span>
            </>
          )}
        </div>
      </header>

      {props.filtros}

      {props.apagado ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            El registro del embudo está apagado en este negocio: no hay datos para comparar.
          </CardContent>
        </Card>
      ) : !comparacion ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            {props.versionesConChats < 2
              ? `Solo hay ${props.versionesConChats} versión con chats en este rango y filtros. Cambia las fechas o los filtros, o elige las versiones a mano.`
              : "Elige las dos versiones que quieres comparar."}
          </CardContent>
        </Card>
      ) : (
        <>
          {comparacion.avisos.length ? (
            <ul className="flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              {comparacion.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ColumnaDeVersion resumen={comparacion.a} comparacion={comparacion} lado="a" />
            <ColumnaDeVersion resumen={comparacion.b} comparacion={comparacion} lado="b" />
          </div>
          <p className="text-xs text-muted-foreground">
            La diferencia es la de la versión de la derecha frente a la de la izquierda. Verde = mejora, rojo = empeora. Con menos de{" "}
            {MINIMO_DE_CHATS} chats por versión los porcentajes pueden engañar.
          </p>
        </>
      )}
    </div>
  );
}
