import Link from "next/link";

import { cn } from "@/lib/utils";

import type { EnSeguimientoAhora } from "../dominio/en-seguimiento";
import type { Grupo } from "../dominio/listas";
import { EncabezadoDeRecuperacion, type EncabezadoProps } from "./encabezado";

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
 * flechas de la semana son enlaces. Cada número (alarma, tarjetas, pasos, tipos) es un enlace a la
 * lista de esos chats (vista "Leads", components/leads-de-recuperacion.tsx).
 *
 * Mobile-first: una columna a 375 px, botones de 44 px. En escritorio, columna centrada.
 */

export type SemanaDeRecuperacionVistaProps = {
  encabezado: Omit<EncabezadoProps, "vista">;
  etiquetaAnterior: string;
  /** El enlace a la lista de cada grupo (misma semana). */
  hrefGrupo: (grupo: Grupo) => string;
  alarma: AlarmaDeHoy | null;
  /** En vivo (no semanal). null = no se pudo leer. */
  enSeguimiento: EnSeguimientoAhora | null;
  semana: SemanaDeRecuperacion;
  anterior: SemanaDeRecuperacion | null;
};

const TONO: Record<string, string> = {
  sube: "text-green-700 dark:text-green-400",
  baja: "text-red-700 dark:text-red-400",
  igual: "text-foreground",
  nada: "text-foreground",
};

type Paso = { grupo: Grupo; nombre: string; valor: number; pct: number; nota: string; alerta?: boolean };

/** La flecha de "ver la lista". */
function Flecha() {
  return (
    <span aria-hidden className="flex-none text-xl leading-none font-semibold text-muted-foreground">
      ›
    </span>
  );
}

const KPI = "flex min-h-11 flex-col gap-1 rounded-2xl border border-border bg-card p-3.5 hover:bg-muted/50";
const FILA_ENLACE = "-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted/60";

function Barra({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn("h-2.5 rounded-full", className)} style={{ width: `${Math.min(100, Math.max(pct, 2))}%` }} />
    </div>
  );
}

/** "En seguimiento ahora": en vivo, no cambia con la semana. Cada número abre su lista. */
function TarjetaEnSeguimiento({ datos, hrefGrupo }: { datos: EnSeguimientoAhora; hrefGrupo: (grupo: Grupo) => string }) {
  const n = (valor: number) => valor.toLocaleString("es-CO");
  const filas: Array<{ grupo: Grupo; nombre: string; valor: number }> = [
    { grupo: "en_seguimiento_1", nombre: "1 seguimiento", valor: datos.uno },
    { grupo: "en_seguimiento_2", nombre: "2 seguimientos", valor: datos.dos },
    { grupo: "en_seguimiento_3", nombre: "3 o más · llegaron al tope", valor: datos.tresOMas },
  ];
  return (
    <section aria-labelledby="en-seguimiento-titulo" className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-2">
      <Link href={hrefGrupo("en_seguimiento")} className={cn(FILA_ENLACE, "mx-0")}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id="en-seguimiento-titulo" className="flex items-center gap-2 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
            En seguimiento ahora
            <span className="rounded-full bg-green-600/15 px-1.5 py-0.5 text-[10px] text-green-800 dark:text-green-300">En vivo</span>
          </span>
          <span className="text-3xl font-extrabold tabular-nums text-foreground">{n(datos.total)}</span>
          <span className="text-[13px] text-foreground/80">Recibieron un seguimiento en las últimas 72 h y no han contestado</span>
        </span>
        <Flecha />
      </Link>
      <ul className="flex flex-col">
        {filas.map((fila) => (
          <li key={fila.grupo} className="border-t border-border/60">
            <Link href={hrefGrupo(fila.grupo)} className={cn(FILA_ENLACE, "mx-0")}>
              <span className="flex-1 text-sm text-foreground">{fila.nombre}</span>
              <span className="text-base font-extrabold tabular-nums text-foreground">{n(fila.valor)}</span>
              <Flecha />
            </Link>
          </li>
        ))}
      </ul>
      <span className="px-2 pb-1 text-xs text-muted-foreground">
        {datos.programados === 1 ? "1 tiene" : `${n(datos.programados)} tienen`} el próximo automático ya programado
      </span>
    </section>
  );
}

export function SemanaDeRecuperacionVista(props: SemanaDeRecuperacionVistaProps) {
  const { semana, alarma } = props;
  const n = (valor: number) => valor.toLocaleString("es-CO");
  const base = semana.llegaron;
  const pasos: Paso[] = [
    { grupo: "llegaron", nombre: "Llegaron", valor: semana.llegaron, pct: 100, nota: "Leads nuevos de las líneas de ventas" },
    {
      grupo: "seguimiento",
      nombre: "De los que llegaron esta semana, se callaron y recibieron seguimiento",
      valor: semana.conSeguimiento,
      pct: porcentaje(semana.conSeguimiento, base) ?? 0,
      nota: `${textoPct(porcentaje(semana.conSeguimiento, base))} de los que llegaron`,
    },
    {
      grupo: "recuperados",
      nombre: "Respondieron (recuperados)",
      valor: semana.recuperados,
      pct: porcentaje(semana.recuperados, base) ?? 0,
      nota: "Contestaron en menos de 72 h tras un seguimiento",
    },
    {
      grupo: "callados72",
      nombre: "Siguen callados más de 72 h",
      valor: semana.calladosMas72,
      pct: porcentaje(semana.calladosMas72, base) ?? 0,
      nota: "Van a llamada de Recuperación 72 h",
      alerta: true,
    },
    {
      grupo: "compraron",
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
      <EncabezadoDeRecuperacion vista="semana" {...props.encabezado} />

      <div className="flex flex-col gap-3.5 p-4">
        {alarma && textoAlarma ? (
          <section
            aria-labelledby="alarma-titulo"
            className="flex flex-col gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-2 dark:border-orange-900/60 dark:bg-orange-950/30"
          >
            <Link href={props.hrefGrupo("vencidas")} className={cn(FILA_ENLACE, "mx-0 hover:bg-orange-100/70 dark:hover:bg-orange-900/30")}>
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-xs font-bold tracking-[0.06em] text-orange-800 uppercase dark:text-orange-300">Alarma de hoy</span>
                <h2 id="alarma-titulo" className="text-lg leading-snug font-extrabold text-foreground">
                  {textoAlarma.titulo}
                </h2>
                {textoAlarma.detalle ? <span className="text-sm leading-relaxed text-foreground/80">{textoAlarma.detalle}</span> : null}
              </span>
              <Flecha />
            </Link>
            {alarma.llamadas72h > 0 ? (
              <Link
                href={props.hrefGrupo("llamadas72")}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-orange-200 bg-background/70 px-3 text-sm font-semibold text-foreground hover:bg-background dark:border-orange-900/60"
              >
                Ver las {n(alarma.llamadas72h)} llamadas de 72 h
                <Flecha />
              </Link>
            ) : null}
          </section>
        ) : null}

        {props.enSeguimiento ? <TarjetaEnSeguimiento datos={props.enSeguimiento} hrefGrupo={props.hrefGrupo} /> : null}

        <div className="grid grid-cols-2 gap-2.5">
          <Link href={props.hrefGrupo("recuperados")} className={KPI}>
            <span className="flex items-center justify-between gap-1 text-[13px] font-semibold text-muted-foreground">
              Recuperados <Flecha />
            </span>
            <span className="text-3xl font-extrabold tabular-nums text-foreground">{n(semana.recuperados)}</span>
            <span className="text-[13px] text-foreground/80">{textoPct(semana.pctRecuperados)} de los que recibieron seguimiento</span>
          </Link>
          <Link href={props.hrefGrupo("compraron_recuperados")} className={KPI}>
            <span className="flex items-center justify-between gap-1 text-[13px] font-semibold text-muted-foreground">
              Ventas de recuperados <Flecha />
            </span>
            <span className="text-3xl font-extrabold tabular-nums text-foreground">{n(semana.compraronRecuperados)}</span>
            <span className="text-[13px] text-foreground/80">
              de {semana.compraron} {semana.compraron === 1 ? "venta" : "ventas"} de leads de la semana
            </span>
          </Link>
        </div>

        <section aria-labelledby="pasos-titulo" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 id="pasos-titulo" className="text-[17px] font-extrabold text-foreground">
            ¿Qué pasó con los leads?
          </h2>
          {base === 0 ? <p className="text-sm text-muted-foreground">No llegaron leads nuevos esta semana.</p> : null}
          <ol className="flex flex-col gap-1">
            {pasos.map((paso) => (
              <li key={paso.nombre}>
                <Link href={props.hrefGrupo(paso.grupo)} className={FILA_ENLACE}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{paso.nombre}</span>
                      <span className="text-base font-extrabold tabular-nums text-foreground">{n(paso.valor)}</span>
                    </span>
                    <Barra pct={paso.pct} className={paso.alerta ? "bg-orange-700 dark:bg-orange-500" : "bg-blue-600 dark:bg-blue-500"} />
                    <span className="text-xs text-muted-foreground">{paso.nota}</span>
                  </span>
                  <Flecha />
                </Link>
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
              <li key={tipo.clase} className="border-t border-border/60 pt-1 first:border-t-0 first:pt-0">
                <Link href={props.hrefGrupo(`tipo:${tipo.clase}`)} className={FILA_ENLACE}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">{tipo.nombre}</span>
                      <span className={cn("text-lg font-extrabold tabular-nums", tipo.baja ? "text-red-700 dark:text-red-400" : "text-foreground")}>
                        {textoPct(tipo.pct)}
                      </span>
                    </span>
                    <Barra
                      pct={tipo.pct === null ? 0 : Math.round((tipo.pct / maxTasa) * 100)}
                      className={tipo.baja ? "bg-red-700 dark:bg-red-500" : "bg-blue-600 dark:bg-blue-500"}
                    />
                    <span className="text-xs text-muted-foreground">
                      {n(tipo.contestaron)} de {n(tipo.enviados)} contestaron{tipo.baja ? ". Revisar el texto." : ""}
                    </span>
                  </span>
                  <Flecha />
                </Link>
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
