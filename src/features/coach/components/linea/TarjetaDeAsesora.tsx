import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { diaCorto } from "../../dominio/acciones-de-hoy";
import { NOMBRE_DE_TENDENCIA, type MetricaDeLinea, type ResumenParaTarjeta, type Tendencia } from "../../dominio/linea-de-tiempo";
import { colorDe } from "./colores";

const coma = (n: number) => n.toString().replace(".", ",");

const ESTILO: Record<Tendencia, string> = {
  mejoro: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  empeoro: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  igual: "bg-muted text-muted-foreground",
};
const ICONO: Record<Tendencia, typeof ArrowRight> = { mejoro: ArrowUpRight, empeoro: ArrowDownRight, igual: ArrowRight };

export function BadgeDeTendencia({ tendencia }: { tendencia: Tendencia }) {
  const Icono = ICONO[tendencia];
  return (
    <Badge className={ESTILO[tendencia]}>
      <Icono data-icon="inline-start" />
      {NOMBRE_DE_TENDENCIA[tendencia]}
    </Badge>
  );
}

/**
 * Tarjeta corta de UNA asesora en la primera pagina: lo que entrena hoy, la cifra de ayer contra
 * la meta de hoy y si mejoro o empeoro contra su informe anterior. El detalle va en su seccion.
 */
export function TarjetaDeAsesora({
  resumen,
  indice,
  metrica,
  ayer,
  href,
}: {
  resumen: ResumenParaTarjeta;
  /** Posicion de la asesora (mismo color que su linea). */
  indice: number;
  metrica: MetricaDeLinea;
  ayer: string;
  href: string;
}) {
  const h = resumen.habilidad;
  const t = resumen.tendencia;
  return (
    <Card size="sm" className="gap-3" data-testid="tarjeta-asesora" data-asesora={resumen.nombre}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${colorDe(indice).punto}`} />
          <span className="truncate">{resumen.nombre}</span>
        </CardTitle>
        {t ? (
          <CardAction>
            <BadgeDeTendencia tendencia={t.valor} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="truncate text-sm">
          <span className="text-muted-foreground">Hoy entrena: </span>
          <span className="font-medium">{h ? h.nombre : "Sin habilidad (no hubo errores medidos)"}</span>
        </p>
        {h ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">{resumen.dia === ayer ? "Ayer" : diaCorto(resumen.dia ?? ayer)}</p>
              <p className="text-xl font-semibold tabular-nums">{h.hoy}</p>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Meta de hoy</p>
              <p className="text-xl font-semibold tabular-nums">{h.textoMeta}</p>
            </div>
            <p className="col-span-2 truncate text-xs text-muted-foreground">{h.metrica}</p>
          </div>
        ) : null}
        {t ? (
          <p className="text-xs text-muted-foreground">
            {metrica.corto}: {coma(t.actual)} vs {coma(t.anterior)} del {diaCorto(t.diaAnterior)}
          </p>
        ) : null}
        {resumen.dia && resumen.dia !== ayer ? (
          <p className="text-xs text-muted-foreground">Último informe: {diaCorto(resumen.dia)}.</p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" className="h-11 w-full">
          <Link href={href}>Ver detalle</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
