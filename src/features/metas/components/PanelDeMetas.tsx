import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Target } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { FilaDeAsesora, FilaDelEquipo } from "@/features/metas/dominio/calculo";
import { mesEnPalabras } from "@/features/metas/dominio/metas-guardadas";
import { armarPanel } from "@/features/metas/servicios/panel-de-metas";
import type { AccesoDelCrm } from "@/lib/permisos-del-crm";

type Props = {
  access: AccesoDelCrm;
  workspaceId: string;
  userId: string;
  className?: string;
};

const FORMATO_MILLONES = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const FORMATO_PESOS = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** 13.750.000 → "13,75 M". */
const millones = (valor: number | null) => (valor === null ? "—" : `${FORMATO_MILLONES.format(valor / 1_000_000)} M`);
const pesos = (valor: number) => `$${FORMATO_PESOS.format(valor)}`;
/** Avance en % de la meta (para la barra). */
const enPorcentaje = (valor: number | null, meta: number) => (valor === null || meta <= 0 ? 0 : (valor / meta) * 100);

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{etiqueta}</p>
      <p className="truncate text-sm font-semibold text-foreground tabular-nums">{valor}</p>
      {nota ? <p className="text-[11px] text-muted-foreground">{nota}</p> : null}
    </div>
  );
}

function Comision({ fila, sinGestion }: { fila: FilaDeAsesora; sinGestion: boolean }) {
  if (sinGestion) return <Dato etiqueta="Comisión estimada" valor="—" />;
  if (fila.comisionEstimada === null) return <Dato etiqueta="Comisión estimada" valor="Por confirmar" />;
  return (
    <Dato
      etiqueta="Comisión estimada"
      valor={pesos(fila.comisionEstimada)}
      nota={fila.porConfirmar ? "Por confirmar" : null}
    />
  );
}

function FilaAsesora({ fila }: { fila: FilaDeAsesora }) {
  const sinGestion = fila.vendido === null;
  return (
    <li className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-foreground">{fila.nombre}</p>
        {fila.vendido !== null && fila.vendido >= fila.reto ? (
          <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">¡Reto cumplido!</span>
        ) : null}
      </div>
      <Progress
        value={enPorcentaje(fila.vendido, fila.meta)}
        marca={enPorcentaje(fila.esperado, fila.meta)}
        color={fila.color}
        aria-label={`Avance de ${fila.nombre} sobre su meta`}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <Dato etiqueta="Meta" valor={millones(fila.meta)} />
        <Dato etiqueta="Reto" valor={millones(fila.reto)} />
        <Dato etiqueta="Vendido" valor={millones(fila.vendido)} />
        <Dato etiqueta="Falta" valor={millones(fila.falta)} />
        <Dato etiqueta="Esperado a hoy" valor={millones(fila.esperado)} />
        <Comision fila={fila} sinGestion={sinGestion} />
      </div>
    </li>
  );
}

function textoDelBono(equipo: FilaDelEquipo) {
  if (equipo.bonoGanado === null || equipo.total === null) return `Bono de ${pesos(equipo.bono)} si el equipo llega a la meta`;
  if (equipo.bonoGanado) return `Bono de ${pesos(equipo.bono)}: ¡ganado!`;
  return `Bono de ${pesos(equipo.bono)}: faltan ${millones(equipo.meta - equipo.total)}`;
}

function FilaEquipo({ equipo }: { equipo: FilaDelEquipo }) {
  return (
    <li className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-sm font-medium text-foreground">Equipo</p>
      <Progress
        value={enPorcentaje(equipo.total, equipo.meta)}
        marca={enPorcentaje(equipo.esperado, equipo.meta)}
        color={equipo.color}
        aria-label="Avance del equipo sobre la meta"
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <Dato etiqueta="Vendido" valor={millones(equipo.total)} />
        <Dato etiqueta="Meta" valor={millones(equipo.meta)} />
        <Dato etiqueta="Mínimo" valor={millones(equipo.minimo)} />
        <Dato etiqueta="Esperado a hoy" valor={millones(equipo.esperado)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Meta semanal: {millones(equipo.metaSemanal)} · {textoDelBono(equipo)}
      </p>
    </li>
  );
}

function EnlaceEditar({ texto }: { texto: string }) {
  return (
    <Link href="/cliente/metas" className={buttonVariants({ variant: "outline", size: "sm" })}>
      {texto}
    </Link>
  );
}

function Encabezado({ mes, accion }: { mes: string; accion?: ReactNode }) {
  return (
    <CardHeader className="flex flex-wrap items-center justify-between gap-2">
      <CardTitle className="flex items-center gap-2">
        <Target className="size-4 text-primary" aria-hidden />
        Meta del mes
        <span className="text-xs font-normal text-muted-foreground">· {mesEnPalabras(mes)}</span>
      </CardTitle>
      {accion}
    </CardHeader>
  );
}

/**
 * "Meta del mes" en Mi día y Mi tablero. La asesora ve su fila y la del equipo; el dueño, todas, las ventas sin
 * asignar y el enlace para editar. Es de servidor: las cifras de las demás nunca llegan al navegador de la asesora.
 */
export async function PanelDeMetas({ access, workspaceId, userId, className }: Props) {
  const panel = await armarPanel(access, workspaceId, userId, new Date());

  if (panel.estado === "sin-metas") {
    return (
      <Card size="sm" className={className}>
        <Encabezado mes={panel.mes} accion={panel.puedeEditar ? <EnlaceEditar texto="Cargar metas" /> : null} />
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {panel.puedeEditar
              ? "Este mes todavía no tiene metas. Cárgalas para que cada asesora vea su avance."
              : "Este mes todavía no tiene metas cargadas."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className={className}>
      <Encabezado mes={panel.mes} accion={panel.puedeEditar ? <EnlaceEditar texto="Editar metas" /> : null} />
      <CardContent className="space-y-3">
        {panel.avisos.length ? (
          <ul className="space-y-1">
            {panel.avisos.map((aviso) => (
              <li
                key={aviso}
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                {aviso}
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="space-y-2">
          {panel.asesoras.map((fila, indice) => (
            <FilaAsesora key={fila.userId ?? `${fila.nombre}-${indice}`} fila={fila} />
          ))}
          {!panel.puedeEditar && panel.asesoras.length === 0 ? (
            <li className="text-sm text-muted-foreground">Este mes no tienes una meta propia cargada.</li>
          ) : null}
          <FilaEquipo equipo={panel.equipo} />
        </ul>
        {panel.sinAsignar ? (
          <p className="text-xs text-muted-foreground">
            {panel.sinAsignar.cuantas === 1 ? "1 venta sin asignar" : `${panel.sinAsignar.cuantas} ventas sin asignar`} (
            {millones(panel.sinAsignar.monto)}): cuentan para el equipo, no para ninguna asesora.
            {panel.sinAsignar.vendedoras.length
              ? ` Vendedora en Gestión: ${panel.sinAsignar.vendedoras.join(", ")}. Revisa el "nombre en Gestión" en Editar metas.`
              : ""}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          La raya en la barra es lo esperado a hoy. Las ventas se leen de Gestión cada 5 minutos.
        </p>
      </CardContent>
    </Card>
  );
}

function PanelCargando({ className }: { className?: string }) {
  return (
    <Card size="sm" className={className} aria-busy>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-primary" aria-hidden />
          Meta del mes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

/** El panel sin frenar la página: mientras Gestión responde se ve un esqueleto y el resto de la pantalla ya carga. */
export function PanelDeMetasSuspendido(props: Props) {
  return (
    <Suspense fallback={<PanelCargando className={props.className} />}>
      <PanelDeMetas {...props} />
    </Suspense>
  );
}
