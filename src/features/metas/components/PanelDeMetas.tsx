import { Suspense } from "react";
import Link from "next/link";
import { Target } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { ColorDeAvance, FilaDeAsesora, FilaDelEquipo } from "@/features/metas/dominio/calculo";
import { mesEnPalabras } from "@/features/metas/dominio/metas-guardadas";
import { armarPanel, type PanelVisible } from "@/features/metas/servicios/panel-de-metas";
import type { AccesoDelCrm } from "@/lib/permisos-del-crm";
import { cn } from "@/lib/utils";

type Props = {
  access: AccesoDelCrm & { workspaceId: string; userId: string };
  className?: string;
};

const pesos = (valor: number) => `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(valor)}`;
/** 13750000 → '13,75 M'. Corto, para que las cifras quepan en el celular. */
const millones = (valor: number) =>
  `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(valor / 1_000_000)} M`;
const oGuion = (valor: number | null, formato: (valor: number) => string) => (valor === null ? "—" : formato(valor));
const porciento = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0);

const textoDelColor: Record<ColorDeAvance, string> = {
  verde: "Al día",
  amarillo: "Un poco atrás",
  rojo: "Atrasada",
};
const claseDelColor: Record<ColorDeAvance, string> = {
  verde: "text-emerald-700 dark:text-emerald-400",
  amarillo: "text-amber-700 dark:text-amber-300",
  rojo: "text-destructive",
};

function Dato({ etiqueta, valor, destacado = false }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{etiqueta}</p>
      <p className={cn("truncate text-sm tabular-nums", destacado ? "font-semibold text-foreground" : "text-foreground")}>
        {valor}
      </p>
    </div>
  );
}

function EstadoDelColor({ color, equipo = false }: { color: ColorDeAvance | null; equipo?: boolean }) {
  if (!color) return null;
  const texto = equipo && color === "rojo" ? "Atrasado" : textoDelColor[color];
  return <span className={cn("shrink-0 text-xs font-medium", claseDelColor[color])}>{texto}</span>;
}

function FilaAsesora({ fila, titulo }: { fila: FilaDeAsesora; titulo: string }) {
  const comision =
    fila.comisionEstimada === null
      ? "Sin calcular"
      : `${pesos(fila.comisionEstimada)}${fila.porConfirmar ? " (por confirmar)" : ""}`;
  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{titulo}</p>
        <EstadoDelColor color={fila.color} />
      </div>
      <Progress
        value={porciento(fila.vendido ?? 0, fila.meta)}
        marca={porciento(fila.esperado, fila.meta)}
        etiquetaDeMarca="Lo esperado a la fecha"
        color={fila.color}
        aria-label={`Avance de ${fila.nombre} sobre su meta`}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <Dato etiqueta="Meta" valor={millones(fila.meta)} />
        <Dato etiqueta="Reto" valor={millones(fila.reto)} />
        <Dato etiqueta="Vendido" valor={oGuion(fila.vendido, millones)} destacado />
        <Dato etiqueta="Falta" valor={oGuion(fila.falta, millones)} />
        <Dato etiqueta="Esperado a la fecha" valor={millones(fila.esperado)} />
        <Dato etiqueta="Comisión estimada" valor={comision} destacado />
      </div>
    </div>
  );
}

function FilaEquipo({ equipo }: { equipo: FilaDelEquipo }) {
  const bono =
    equipo.bonoGanado === null || equipo.total === null
      ? `Bono de ${pesos(equipo.bono)}: sin datos de Gestión`
      : equipo.bonoGanado
        ? `Bono de ${pesos(equipo.bono)}: ganado`
        : `Bono de ${pesos(equipo.bono)}: faltan ${millones(equipo.meta - equipo.total)}`;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Equipo</p>
        <EstadoDelColor color={equipo.color} equipo />
      </div>
      <Progress
        value={porciento(equipo.total ?? 0, equipo.meta)}
        marca={porciento(equipo.esperado, equipo.meta)}
        etiquetaDeMarca="Lo esperado a la fecha"
        color={equipo.color}
        aria-label="Avance del equipo sobre la meta"
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <Dato etiqueta="Vendido" valor={oGuion(equipo.total, millones)} destacado />
        <Dato etiqueta="Meta" valor={millones(equipo.meta)} />
        <Dato etiqueta="Mínimo" valor={millones(equipo.minimo)} />
        <Dato etiqueta="Esperado a la fecha" valor={millones(equipo.esperado)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Meta semanal: {millones(equipo.metaSemanal)} · {bono}
      </p>
    </div>
  );
}

function Contenido({ panel }: { panel: PanelVisible }) {
  if (panel.estado === "sin-metas") {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay metas cargadas para {mesEnPalabras(panel.mes)}.
        {panel.puedeEditar ? (
          <>
            {" "}
            <Link href="/cliente/metas" className="font-medium text-primary hover:underline">
              Cargar metas
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {panel.avisos.map((aviso) => (
        <p
          key={aviso}
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          {aviso}.
        </p>
      ))}
      {panel.asesoras.map((fila, indice) => (
        <FilaAsesora
          key={fila.userId ?? `${fila.nombre}-${indice}`}
          fila={fila}
          titulo={panel.puedeEditar ? fila.nombre : "Tu meta"}
        />
      ))}
      {!panel.puedeEditar && panel.asesoras.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tienes una meta cargada este mes.</p>
      ) : null}
      <FilaEquipo equipo={panel.equipo} />
      {panel.sinAsignar && panel.sinAsignar.cantidad > 0 ? (
        <p className="text-xs text-muted-foreground">
          {panel.sinAsignar.cantidad === 1 ? "1 venta" : `${panel.sinAsignar.cantidad} ventas`} sin asignar (
          {millones(panel.sinAsignar.monto)}): Gestión no trae la vendedora o no coincide con ninguna asesora. Cuentan
          para el equipo.
        </p>
      ) : null}
    </div>
  );
}

/** Panel "Meta del mes" (servidor). Si algo falla, lo dice en una línea y la pantalla sigue cargando. */
export async function PanelDeMetas({ access, className }: Props) {
  const panel = await armarPanel(access, access.workspaceId, access.userId, new Date()).catch(() => null);
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Target className="size-4 text-muted-foreground" />
          Meta del mes{panel ? ` · ${mesEnPalabras(panel.mes)}` : ""}
        </CardTitle>
        {panel?.estado === "listo" && panel.puedeEditar ? (
          <CardAction>
            <Link href="/cliente/metas" className="text-xs font-medium text-primary hover:underline">
              Editar metas
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {panel ? (
          <Contenido panel={panel} />
        ) : (
          <p className="text-sm text-muted-foreground">No se pudo cargar la meta del mes. Recarga en un momento.</p>
        )}
      </CardContent>
    </Card>
  );
}

function EsperandoElPanel({ className }: { className?: string }) {
  return (
    <Card size="sm" className={className} aria-busy="true">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Target className="size-4 text-muted-foreground" />
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

/** El panel dentro de `<Suspense>`: la pantalla no espera a Gestión para mostrarse. */
export function PanelDeMetasSuspendido(props: Props) {
  return (
    <Suspense fallback={<EsperandoElPanel className={props.className} />}>
      <PanelDeMetas {...props} />
    </Suspense>
  );
}
