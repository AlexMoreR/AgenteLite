import Link from "next/link";
import { Fragment } from "react";

/**
 * Encabezado de Recuperación (título, semana ‹ › y pestañas). Lo comparten "Semana" y "Leads".
 * Sin JavaScript del lado del cliente: todo son enlaces.
 */

export type EncabezadoProps = {
  vista: "semana" | "leads";
  etiquetaSemana: string;
  hrefSemanaAnterior: string;
  /** null = ya es la semana más reciente que se puede ver. */
  hrefSemanaSiguiente: string | null;
  hrefVistaSemana: string;
  hrefVistaLeads: string;
};

const PESTANA = "flex min-h-10 flex-none items-center rounded-full px-3.5 text-sm font-semibold";

export function EncabezadoDeRecuperacion(props: EncabezadoProps) {
  const pestanas = [
    { clave: "semana", nombre: "Semana", href: props.hrefVistaSemana },
    { clave: "leads", nombre: "Leads", href: props.hrefVistaLeads },
  ] as const;
  return (
    <header className="flex flex-col gap-3 border-b border-border bg-card px-4 pt-5 pb-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-foreground">Recuperación</h1>
        <nav aria-label="Semana" className="flex items-center gap-1">
          <Link
            href={props.hrefSemanaAnterior}
            aria-label="Semana anterior"
            className="flex size-11 items-center justify-center rounded-full border border-border bg-background text-lg font-semibold text-foreground hover:bg-muted"
          >
            ‹
          </Link>
          <span className="flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm font-semibold whitespace-nowrap text-foreground">
            {props.etiquetaSemana}
          </span>
          {props.hrefSemanaSiguiente ? (
            <Link
              href={props.hrefSemanaSiguiente}
              aria-label="Semana siguiente"
              className="flex size-11 items-center justify-center rounded-full border border-border bg-background text-lg font-semibold text-foreground hover:bg-muted"
            >
              ›
            </Link>
          ) : (
            <span aria-hidden className="flex size-11 items-center justify-center rounded-full border border-border text-lg font-semibold text-muted-foreground/40">
              ›
            </span>
          )}
        </nav>
      </div>
      <nav aria-label="Vistas de Recuperación" className="flex gap-2">
        {pestanas.map((p) => (
          <Fragment key={p.clave}>
            {p.clave === "leads" ? (
              <span aria-disabled title="Pronto" className={`${PESTANA} gap-1.5 bg-muted text-muted-foreground`}>
                Para hoy
                <span className="rounded-full bg-background px-1.5 text-[10px] font-bold tracking-wide uppercase">Pronto</span>
              </span>
            ) : null}
            {p.clave === props.vista ? (
              <span aria-current="page" className={`${PESTANA} bg-foreground text-background`}>
                {p.nombre}
              </span>
            ) : (
              <Link href={p.href} className={`${PESTANA} bg-muted text-foreground hover:bg-muted/70`}>
                {p.nombre}
              </Link>
            )}
          </Fragment>
        ))}
      </nav>
    </header>
  );
}
