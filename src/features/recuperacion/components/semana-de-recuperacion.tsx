import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  compararSemanas,
  porcentaje,
  textoDeAlarma,
  textoPct,
  type AlarmaDeHoy,
  type SemanaDeRecuperacion,
} from "../dominio/semana";

/**
 * RECUPERACIÓN · pantalla "Semana" (diseño aprobado por Alex el 13-10-2026: Main.dc.html). Solo
 * presenta: los números llegan armados (dominio/semana.ts). Sin JavaScript del lado del cliente: las
 * flechas de la semana son enlaces. "Para hoy" y "Leads" llegan en la fase 2.
 *
 * Mobile-first: una columna a 375 px, botones de 44 px. En escritorio, columna centrada.
 */

export type SemanaDeRecuperacionVistaProps = {
  etiquetaSemana: string;
  etiquetaAnterior: string;
  hrefSemanaAnterior: string;
  /** null = ya es la semana más reciente que se puede ver. */
  hrefSemanaSiguiente: string | null;
  alarma: AlarmaDeHoy | null;
  semana: SemanaDeRecuperacion;
  anterior: SemanaDeRecuperacion | null;
};

const TONO: Record<string, string> = {
  sube: "text-green-700 dark:text-green-400",
  baja: "text-red-700 dark:text-red-400",
  igual: "text-foreground",
  nada: "text-foreground",
};

type Paso = { nombre: string; valor: number; pct: number; nota: string; alerta?: boolean };

function Barra({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn("h-2.5 rounded-full", className)} style={{ width: `${Math.min(100, Math.max(pct, 2))}%` }} />
    </div>
  );
}

export function SemanaDeRecuperacionVista(props: SemanaDeRecuperacionVistaProps) {
  const { semana, alarma } = props;
  const n = (valor: number) => valor.toLocaleString("es-CO");
  const base = semana.llegaron;
  const pasos: Paso[] = [
    { nombre: "Llegaron", valor: semana.llegaron, pct: 100, nota: "Leads nuevos de las líneas de ventas" },
    {
      nombre: "Se callaron y recibieron seguimiento",
      valor: semana.conSeguimiento,
      pct: porcentaje(semana.conSeguimiento, base) ?? 0,
      nota: `${textoPct(porcentaje(semana.conSeguimiento, base))} de los que llegaron`,
    },
    {
      nombre: "Respondieron (recuperados)",
      valor: semana.recuperados,
      pct: porcentaje(semana.recuperados, base) ?? 0,
      nota: "Contestaron en menos de 72 h tras un seguimiento",
    },
    {
      nombre: "Siguen callados más de 72 h",
      valor: semana.calladosMas72,
      pct: porcentaje(semana.calladosMas72, base) ?? 0,
      nota: "Van a llamada de Recuperación 72 h",
      alerta: true,
    },
    {
      nombre: "Compraron",
      valor: semana.compraron,
      pct: porcentaje(semana.compraron, base) ?? 0,
      nota:
        semana.compraron === 0
          ? "Ninguna venta marcada todavía"
          : `${semana.compraronRecuperados} ${semana.compraronRecuperados === 1 ? "de ellos fue recuperado" : "de ellos fueron recuperados"}`,
    },
  ];
  const maxTasa = Math.max(1, ...semana.tipos.map((t) => t.pct ?? 0));
  const textoAlarma = alarma ? textoDeAlarma(alarma) : null;
  const comparaciones = compararSemanas(semana, props.anterior);

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
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
          <span aria-current="page" className="flex min-h-10 flex-none items-center rounded-full bg-foreground px-3.5 text-sm font-semibold text-background">
            Semana
          </span>
          {["Para hoy", "Leads"].map((nombre) => (
            <span
              key={nombre}
              aria-disabled
              title="Pronto"
              className="flex min-h-10 flex-none items-center gap-1.5 rounded-full bg-muted px-3.5 text-sm font-semibold text-muted-foreground"
            >
              {nombre}
              <span className="rounded-full bg-background px-1.5 text-[10px] font-bold tracking-wide uppercase">Pronto</span>
            </span>
          ))}
        </nav>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {alarma && textoAlarma ? (
          <section
            aria-labelledby="alarma-titulo"
            className="flex flex-col gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900/60 dark:bg-orange-950/30"
          >
            <span className="text-xs font-bold tracking-[0.06em] text-orange-800 uppercase dark:text-orange-300">Alarma de hoy</span>
            <h2 id="alarma-titulo" className="text-lg leading-snug font-extrabold text-foreground">
              {textoAlarma.titulo}
            </h2>
            {textoAlarma.detalle ? <p className="text-sm leading-relaxed text-foreground/80">{textoAlarma.detalle}</p> : null}
          </section>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3.5">
            <span className="text-[13px] font-semibold text-muted-foreground">Recuperados</span>
            <span className="text-3xl font-extrabold tabular-nums text-foreground">{n(semana.recuperados)}</span>
            <span className="text-[13px] text-foreground/80">{textoPct(semana.pctRecuperados)} de los que recibieron seguimiento</span>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3.5">
            <span className="text-[13px] font-semibold text-muted-foreground">Ventas de recuperados</span>
            <span className="text-3xl font-extrabold tabular-nums text-foreground">{n(semana.compraronRecuperados)}</span>
            <span className="text-[13px] text-foreground/80">
              de {semana.compraron} {semana.compraron === 1 ? "venta" : "ventas"} de leads de la semana
            </span>
          </div>
        </div>

        <section aria-labelledby="pasos-titulo" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 id="pasos-titulo" className="text-[17px] font-extrabold text-foreground">
            ¿Qué pasó con los leads?
          </h2>
          {base === 0 ? <p className="text-sm text-muted-foreground">No llegaron leads nuevos esta semana.</p> : null}
          <ol className="flex flex-col gap-3">
            {pasos.map((paso) => (
              <li key={paso.nombre} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{paso.nombre}</span>
                  <span className="text-base font-extrabold tabular-nums text-foreground">{n(paso.valor)}</span>
                </div>
                <Barra pct={paso.pct} className={paso.alerta ? "bg-orange-700 dark:bg-orange-500" : "bg-blue-600 dark:bg-blue-500"} />
                <span className="text-xs text-muted-foreground">{paso.nota}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="tipos-titulo" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <h2 id="tipos-titulo" className="text-[17px] font-extrabold text-foreground">
              ¿Qué seguimiento recupera más?
            </h2>
            <span className="text-[13px] text-muted-foreground">% de mensajes que el cliente contestó en 24 h</span>
          </div>
          {semana.tipos.length === 0 ? <p className="text-sm text-muted-foreground">No salieron seguimientos a estos leads.</p> : null}
          <ul className="flex flex-col">
            {semana.tipos.map((tipo) => (
              <li key={tipo.clase} className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 pb-1 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-foreground">{tipo.nombre}</span>
                  <span className={cn("text-lg font-extrabold tabular-nums", tipo.baja ? "text-red-700 dark:text-red-400" : "text-foreground")}>
                    {textoPct(tipo.pct)}
                  </span>
                </div>
                <Barra
                  pct={tipo.pct === null ? 0 : Math.round((tipo.pct / maxTasa) * 100)}
                  className={tipo.baja ? "bg-red-700 dark:bg-red-500" : "bg-blue-600 dark:bg-blue-500"}
                />
                <span className="text-xs text-muted-foreground">
                  {n(tipo.contestaron)} de {n(tipo.enviados)} contestaron{tipo.baja ? ". Revisar el texto." : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-foreground/80">
            Llamadas y audios de la asesora: todavía no se miden. Se agregan en la fase 2.
          </p>
        </section>

        <section aria-labelledby="antes-titulo" className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
          <h2 id="antes-titulo" className="text-[17px] font-extrabold text-foreground">
            Frente a la semana anterior
          </h2>
          <span className="text-xs text-muted-foreground">Esta semana · {props.etiquetaAnterior}</span>
          {comparaciones.map((fila) => (
            <div key={fila.nombre} className="flex justify-between gap-3 text-sm">
              <span className="text-foreground">{fila.nombre}</span>
              <span className="font-bold tabular-nums">
                <span className={TONO[fila.tono]}>{fila.actual}</span>
                <span className="font-semibold text-muted-foreground"> · {fila.antes}</span>
              </span>
            </div>
          ))}
        </section>

        <p className="text-xs leading-normal text-muted-foreground">
          Leads que escribieron por primera vez esta semana (lunes a domingo, hora Bogotá) en las líneas de ventas. Se miran sus
          seguimientos automáticos hasta 7 días después del domingo. Venta = chat marcado Ganado en el CRM.
        </p>
      </div>
    </div>
  );
}
