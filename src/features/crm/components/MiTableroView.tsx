import Link from "next/link";
import { ArrowRight, Flame, PhoneCall, Snowflake, TrendingUp, Users } from "lucide-react";

import { getCrmStageLabel } from "../domain/crm-config";
import type { MiTableroData } from "../services/getMiTableroData";

/**
 * El tablero de UNA asesora.
 *
 * Va aparte del informe del CRM a proposito: ese es del negocio y esta pensado para el jefe.
 * Esta pantalla responde lo que a ella le importa —cuanto tengo, cuanto movi, cuanto cerre— y
 * termina siempre empujando a Mi dia, que es donde estan las tareas del dia.
 */

function Tarjeta({
  titulo,
  valor,
  detalle,
  Icono,
  acento,
}: {
  titulo: string;
  valor: number;
  detalle: string;
  Icono: typeof Users;
  acento?: "verde" | "azul";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icono className="size-4" />
        {titulo}
      </div>
      <p
        className={`mt-1.5 text-3xl font-semibold tabular-nums ${
          acento === "verde" ? "text-emerald-600" : acento === "azul" ? "text-[var(--primary)]" : "text-foreground"
        }`}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{detalle}</p>
    </div>
  );
}

export function MiTableroView({ data }: { data: MiTableroData }) {
  const vivos = data.porEtapa.filter((fila) => !["GANADO", "PERDIDO"].includes(fila.stage));
  const maximo = Math.max(1, ...vivos.map((fila) => fila.count));
  // Solo el nombre de pila: "Hola, Angy Marcela Ortiz" suena a carta del banco.
  const primerNombre = data.advisorName.trim().split(/\s+/)[0] || data.advisorName;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Saludo y no "Mi tablero": el titulo ya esta arriba en la barra, repetirlo no sumaba
            nada. Y esta es la primera pantalla del dia de la asesora — que la salude por su
            nombre cuesta lo mismo que un titulo mudo. */}
        <div>
          <h1 className="text-xl font-semibold text-foreground">Hola, {primerNombre} 👋</h1>
          <p className="text-sm text-muted-foreground">Así venís con tus leads.</p>
        </div>

        <Link
          href="/cliente/crm/mi-dia"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          Ver qué tengo pendiente
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta titulo="Leads a cargo" valor={data.leadsACargo} detalle="Chats que son tuyos" Icono={Users} />
        <Tarjeta
          titulo="Movidos hoy"
          valor={data.movidosHoy}
          detalle="Con movimiento hoy"
          Icono={Flame}
          acento="azul"
        />
        <Tarjeta
          titulo="Llamadas"
          valor={data.llamadasHoy}
          detalle={`Hoy · ${data.llamadasSemana} en la semana`}
          Icono={PhoneCall}
        />
        <Tarjeta
          titulo="Ventas"
          valor={data.ventasSemana}
          detalle="Cerradas en los últimos 7 días"
          Icono={TrendingUp}
          acento="verde"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-medium text-foreground">Tus leads por etapa</p>
          <div className="mt-3 space-y-2">
            {vivos.map((fila) => (
              <div key={fila.stage} className="space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">{getCrmStageLabel(fila.stage)}</span>
                  <span className="font-medium tabular-nums text-foreground">{fila.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${Math.round((fila.count / maximo) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lo unico que esta pantalla senala como problema: leads suyos que se estan enfriando.
            Es accionable de una — por eso el boton lleva directo a la lista del dia. */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <Snowflake className="size-4 text-sky-500" />
            Se te están enfriando
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{data.enfriandose}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Leads tuyos, todavía vivos, con más de 5 días sin que nadie los toque. Son los que se
            pierden sin que nadie se dé cuenta.
          </p>
          {data.enfriandose > 0 ? (
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
