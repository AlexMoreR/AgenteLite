"use client";

import Link from "next/link";

import { ArrowRight, Phone, Snowflake, TrendingUp, Trophy, Users, type LucideIcon } from "lucide-react";

import { useSetBreadcrumbLabel } from "@/components/breadcrumb-label-context";
import { getCrmStageLabel } from "../domain/crm-config";
import type { MiTableroData } from "../services/getMiTableroData";
import { SelectorDeRango } from "./SelectorDeRango";

/**
 * El tablero de UNA asesora.
 *
 * Va aparte del informe del CRM a proposito: ese es del negocio y esta pensado para el jefe.
 * Esta pantalla responde lo que a ella le importa —cuanto tengo, cuanto movi, cuanto cerre— y
 * termina siempre empujando a Mi dia, que es donde estan las tareas del dia.
 */

/**
 * Tarjeta de estadistica: rotulo arriba, cifra y contexto en la misma linea.
 *
 * Sin icono y con la cifra mas chica que antes. Cuatro tarjetas con icono grande y numero enorme
 * competian entre si y con el resto de la pantalla; lo que se mira de reojo es el numero, y para
 * eso no hace falta que grite. El contexto ("1 en la semana") va pegado a la cifra en vez de en
 * un renglon aparte: se lee de un golpe.
 */
/*
  Cada cifra con su color y su dibujito, en dos columnas en el celular.

  Una debajo de otra, las cuatro tarjetas ocupaban la pantalla entera y habia que bajar para llegar
  a las etapas. De a dos se ven todas juntas, y el color de cada una (violeta los leads, azul lo
  movido, celeste las llamadas, verde las ventas) deja reconocerlas de reojo sin leer el rotulo.
*/
const ACENTOS = {
  violeta: { chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300", cifra: "text-foreground" },
  azul: { chip: "bg-blue-500/10 text-blue-600 dark:text-blue-300", cifra: "text-blue-600 dark:text-blue-300" },
  celeste: { chip: "bg-sky-500/10 text-sky-600 dark:text-sky-300", cifra: "text-foreground" },
  verde: { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", cifra: "text-emerald-600 dark:text-emerald-300" },
} as const;

function Tarjeta({
  titulo,
  valor,
  detalle,
  icono: Icono,
  acento,
}: {
  titulo: string;
  valor: number;
  detalle: string;
  icono: LucideIcon;
  acento: keyof typeof ACENTOS;
}) {
  const colores = ACENTOS[acento];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-xl ${colores.chip}`}>
          <Icono className="size-4" />
        </span>
        <p className="truncate text-[13px] font-medium text-muted-foreground">{titulo}</p>
      </div>
      <div>
        <span className={`block text-3xl font-semibold leading-none tabular-nums ${colores.cifra}`}>{valor}</span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">{detalle}</span>
      </div>
    </div>
  );
}

// El mismo color de la chapita de cada etapa en el resto del CRM: Nuevo violeta, Frio celeste...
const COLOR_DE_ETAPA: Record<string, string> = {
  NUEVO: "bg-violet-500",
  CALIFICADO: "bg-cyan-500",
  PROPUESTA: "bg-yellow-400",
  NEGOCIACION: "bg-orange-500",
};

export function MiTableroView({
  data,
  esDeOtraPersona = false,
}: {
  data: MiTableroData;
  esDeOtraPersona?: boolean;
}) {
  const vivos = data.porEtapa.filter((fila) => !["GANADO", "PERDIDO"].includes(fila.stage));
  const maximo = Math.max(1, ...vivos.map((fila) => fila.count));
  const totalVivos = vivos.reduce((suma, fila) => suma + fila.count, 0);
  // Solo el nombre de pila: "Hola, Angy Marcela Ortiz" suena a carta del banco.
  const primerNombre = data.advisorName.trim().split(/\s+/)[0] || data.advisorName;

  // Mirando el tablero de otra persona va su nombre: no es su tablero, lo esta revisando.
  useSetBreadcrumbLabel(esDeOtraPersona ? data.advisorName : `Hola, ${primerNombre} 👋`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/*
          El saludo se mudo ARRIBA, a la barra de la app: decia "Mi Tablero" —un titulo mudo— y
          justo debajo estaba el saludo, o sea dos titulos para la misma pantalla. Ahora la barra
          saluda y aca no queda nada repetido.
        */}
        <SelectorDeRango desde={data.desde} hasta={data.hasta} />

        {esDeOtraPersona ? null : (
          <Link
            href="/cliente/crm/mi-dia"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Ir a mi día
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* "Leads a cargo" es una FOTO de hoy, no del rango: son los chats que tiene ahora. */}
        <Tarjeta
          titulo="Leads a cargo"
          valor={data.leadsACargo}
          detalle={esDeOtraPersona ? "Chats que son suyos" : "Chats que son tuyos"}
          icono={Users}
          acento="violeta"
        />
        <Tarjeta titulo="Movidos" valor={data.movidos} detalle="Con movimiento" icono={TrendingUp} acento="azul" />
        <Tarjeta titulo="Llamadas" valor={data.llamadas} detalle="Registradas" icono={Phone} acento="celeste" />
        <Tarjeta titulo="Ventas" valor={data.ventas} detalle="Cerradas" icono={Trophy} acento="verde" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[13px] font-medium text-foreground">
            {esDeOtraPersona ? "Sus leads por etapa" : "Tus leads por etapa"}
          </p>
          {/*
            Una sola barra partida por etapa, arriba: de un vistazo se ve cuanto del total es frio y
            cuanto esta por cerrarse. Abajo cada etapa con su color, el mismo de su chapita.
          */}
          {totalVivos > 0 ? (
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
              {vivos.map((fila) =>
                fila.count > 0 ? (
                  <div
                    key={fila.stage}
                    className={`h-full ${COLOR_DE_ETAPA[fila.stage] ?? "bg-[var(--primary)]"}`}
                    style={{ width: `${(fila.count / totalVivos) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {vivos.map((fila) => (
              <div key={fila.stage} className="flex items-center gap-3">
                <span className={`size-2.5 shrink-0 rounded-full ${COLOR_DE_ETAPA[fila.stage] ?? "bg-[var(--primary)]"}`} />
                <span className="w-16 shrink-0 text-[13px] text-muted-foreground">{getCrmStageLabel(fila.stage)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${COLOR_DE_ETAPA[fila.stage] ?? "bg-[var(--primary)]"}`}
                    style={{ width: `${Math.round((fila.count / maximo) * 100)}%` }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {fila.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Lo unico que esta pantalla senala como problema: leads suyos que se estan enfriando.
            Es accionable de una — por eso el boton lleva directo a la lista del dia. */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <Snowflake className="size-4 text-sky-500" />
            {esDeOtraPersona ? "Se le están enfriando" : "Se te están enfriando"}
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{data.enfriandose}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Leads {esDeOtraPersona ? "suyos" : "tuyos"}, todavía vivos, con más de 5 días sin que
            nadie los toque. Son los que se pierden sin que nadie se dé cuenta.
          </p>
          {data.enfriandose > 0 && !esDeOtraPersona ? (
            <Link
              href="/cliente/crm/mi-dia"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--primary)] hover:underline"
            >
              Retomarlos
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
