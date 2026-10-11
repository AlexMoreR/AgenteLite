import Link from "next/link";

import { marcarPrioridadAtendidaAction } from "@/app/actions/supervisor-accionable-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  ETIQUETA_DE_ESTADO,
  ETIQUETA_DE_GRAVEDAD,
  duracion,
  enlaceAlChat,
  horaBogota,
  type Accion,
  type EsperandoFueraDeHorario,
  type Tarjeta,
} from "../dominio/reglas";
import type { PanelAccionable } from "../servicios/accionable";

const COLOR_DE_GRAVEDAD: Record<Tarjeta["gravedad"], string> = {
  CRITICO: "border-red-500/60 bg-red-500/5",
  IMPORTANTE: "border-amber-500/60 bg-amber-500/5",
  OBSERVACION: "border-border",
};

const COLOR_DE_ESTADO: Record<Accion["estado"], string> = {
  AVISADA: "text-foreground",
  SEGUNDO_AVISO: "text-amber-600",
  RESUELTA_ABAJO: "text-emerald-600",
  ESCALADA: "text-red-600",
  ATENDIDA_POR_ALEXANDER: "text-muted-foreground",
  RESUELTA_TRAS_ESCALAR: "text-muted-foreground",
  YA_NO_APLICA: "text-muted-foreground",
};

function Fila({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <p className="text-sm">
      <span className="font-medium text-muted-foreground">{titulo}: </span>
      <span className="text-foreground">{valor}</span>
    </p>
  );
}

function TarjetaDePrioridad({ tarjeta }: { tarjeta: Tarjeta }) {
  return (
    <li className={`space-y-1.5 rounded-md border px-3 py-2 ${COLOR_DE_GRAVEDAD[tarjeta.gravedad]}`}>
      <p className="text-sm font-semibold">
        [{ETIQUETA_DE_GRAVEDAD[tarjeta.gravedad]}] {tarjeta.quePaso}
      </p>
      <Fila titulo="Cliente / venta" valor={tarjeta.cliente} />
      <Fila titulo="Responsable" valor={tarjeta.responsable} />
      <Fila titulo="Qué intentó el Supervisor" valor={tarjeta.intentos} />
      <Fila titulo="Por qué te toca" valor={tarjeta.porQue} />
      <Fila titulo="Riesgo" valor={tarjeta.riesgo} />
      <Fila titulo="Solución recomendada" valor={tarjeta.solucion} />
      <p className="text-sm font-semibold text-foreground">Tu acción: {tarjeta.accionDeAlexander}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href={tarjeta.enlace}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
        >
          {tarjeta.conversationId ? "Abrir chat" : "Ver en el Supervisor"}
        </Link>
        <form action={marcarPrioridadAtendidaAction}>
          <input type="hidden" name="id" value={tarjeta.id} />
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Marcar resuelto / atendido
          </button>
        </form>
      </div>
    </li>
  );
}

function detalleDelEstado(a: Accion): string {
  switch (a.estado) {
    case "AVISADA":
      return `Avisada ${horaBogota(a.avisadaEn)} · vence ${horaBogota(a.venceEn)}`;
    case "SEGUNDO_AVISO":
      return `Plazo vencido ${horaBogota(a.venceEn)} · segundo aviso ${horaBogota(a.segundoAvisoEn)}${a.segundoAvisoA ? ` (y ${a.segundoAvisoA})` : ""}`;
    case "RESUELTA_ABAJO":
      return `Resuelta por ${a.resueltaPorNombre ?? a.responsableNombre} en ${a.minutosHastaResolver ?? "?"} min`;
    case "ESCALADA":
      return `Escalada ${horaBogota(a.escaladaEn)} (${a.gravedadEscalada ? ETIQUETA_DE_GRAVEDAD[a.gravedadEscalada].toLowerCase() : "importante"})`;
    case "RESUELTA_TRAS_ESCALAR":
      return `Respondida ${horaBogota(a.resueltaEn)}, después de escalar`;
    case "ATENDIDA_POR_ALEXANDER":
      return `Atendida por Alexander ${horaBogota(a.atendidaEn)}`;
    default:
      return ETIQUETA_DE_ESTADO[a.estado];
  }
}

/**
 * Arriba de la pantalla del Supervisor (con el interruptor `supervisor:accionable:<ws>`):
 * "Prioridades de Alexander" (máx. 3, solo escaladas reales y críticos del bot/embudo/sistema) y,
 * debajo, lo que está en manos de las asesoras con su estado.
 */
/** "N clientes esperando fuera de horario · los atiende Ingrid ahora / se avisan a las 8 a. m." */
function resumenFueraDeHorario(esperando: EsperandoFueraDeHorario[]): string {
  const conSupervisora = esperando.filter((e) => e.ahoraSupervisora).length;
  const resto = esperando.length - conSupervisora;
  const partes = [
    conSupervisora ? `${conSupervisora} ${conSupervisora === 1 ? "lo atiende" : "los atiende"} ${/^Lo atiende (.+) ahora$/.exec(esperando.find((e) => e.ahoraSupervisora)?.quien ?? "")?.[1] ?? "la supervisora"} ahora` : null,
    resto ? `${resto} se ${resto === 1 ? "avisa" : "avisan"} a las 8 a. m.` : null,
  ].filter(Boolean);
  return `${esperando.length} ${esperando.length === 1 ? "cliente esperando" : "clientes esperando"} fuera de horario · ${partes.join(" · ")}`;
}

function ListaFueraDeHorario({ esperando }: { esperando: EsperandoFueraDeHorario[] }) {
  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <p className="text-sm font-semibold text-foreground">🌙 {resumenFueraDeHorario(esperando)}</p>
      <ul className="space-y-1.5">
        {esperando.slice(0, 20).map((e) => (
          <li key={e.conversationId} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p>
                <span className="font-medium">{e.cliente}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {e.nivel === "caliente" ? "Caliente" : "Preguntó precio"} · {e.asesora} · espera {duracion(e.minutos)}
                </span>
              </p>
              {e.ultimoMensaje ? <p className="text-xs text-foreground/80">«{e.ultimoMensaje}»</p> : null}
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{e.quien}</p>
            </div>
            <Link
              href={enlaceAlChat(e.conversationId)}
              className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Abrir chat
            </Link>
          </li>
        ))}
      </ul>
      {esperando.length > 20 ? <p className="text-xs text-muted-foreground">…y {esperando.length - 20} más.</p> : null}
    </div>
  );
}

export function PanelAccionableView({ panel }: { panel: PanelAccionable }) {
  const { prioridades, enManos, metricas, esperando } = panel;
  const activas = enManos.filter((a) => a.estado === "AVISADA" || a.estado === "SEGUNDO_AVISO");
  const cerradas = enManos.filter((a) => !(a.estado === "AVISADA" || a.estado === "SEGUNDO_AVISO"));
  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Prioridades de Alexander</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {prioridades.visibles.length === 0 && esperando.length ? (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Nada escalado a ti, pero no está todo al día: {resumenFueraDeHorario(esperando)}. La lista está abajo.
            </p>
          ) : prioridades.visibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada escalado. Lo que está pasando lo tienen las asesoras (abajo) y el Supervisor lo está verificando.
            </p>
          ) : (
            <ul className="space-y-2">
              {prioridades.visibles.map((t) => (
                <TarjetaDePrioridad key={t.id} tarjeta={t} />
              ))}
            </ul>
          )}
          {prioridades.resto.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{prioridades.resto.length} escalada(s) más, menos urgentes</summary>
              <ul className="mt-2 space-y-2">
                {prioridades.resto.map((t) => (
                  <TarjetaDePrioridad key={t.id} tarjeta={t} />
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>En manos de las asesoras · hoy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Avisos: {metricas.avisadas} · resueltos por ellas: {metricas.resueltasAbajo}
            {metricas.medianaMinutos !== null ? ` (mediana ${metricas.medianaMinutos} min)` : ""} · escalados: {metricas.escaladas}
            {metricas.porAsesora.length
              ? ` · ${metricas.porAsesora.map((p) => `${p.nombre}: ${p.resueltas}/${p.avisadas} resueltos, ${p.incumplidas} plazos vencidos`).join(" · ")}`
              : ""}
          </p>
          {esperando.length ? <ListaFueraDeHorario esperando={esperando} /> : null}
          {activas.length === 0 && !esperando.length ? <p className="text-muted-foreground">Ningún aviso pendiente.</p> : null}
          <ul className="space-y-1.5">
            {[...activas, ...cerradas.slice(0, 15)].map((a) => (
              <li key={`${a.id}:${a.detectadaEn}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p>
                    <span className="font-medium">{a.cliente}</span>
                    {a.telefono && a.telefono !== a.cliente ? <span className="text-muted-foreground"> · {a.telefono}</span> : null}
                    <span className="text-muted-foreground"> · {a.motivo} · {a.responsableNombre}</span>
                  </p>
                  {a.frase ? <p className="text-xs text-foreground/80">«{a.frase}»</p> : null}
                  <p className={`text-xs font-medium ${COLOR_DE_ESTADO[a.estado]}`}>{detalleDelEstado(a)}</p>
                </div>
                {a.conversationId ? (
                  <Link
                    href={enlaceAlChat(a.conversationId)}
                    className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
                  >
                    Abrir chat
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

/** Mi Día: lo que el Supervisor le pidió a esta asesora, con plazo y mensaje sugerido. */
export function PedidosDelSupervisor({ acciones }: { acciones: Accion[] }) {
  if (!acciones.length) return null;
  return (
    <details open className="rounded-xl border border-red-500/40 bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Te pidió el Supervisor ({acciones.length}) · responde antes del plazo
      </summary>
      <ul className="space-y-2 pt-3">
        {acciones.map((a) => (
          <li key={a.id} className="space-y-1 rounded-md border border-border bg-background/60 px-3 py-2 text-sm">
            <p>
              <span className="font-medium">{a.cliente}</span>
              {a.telefono && a.telefono !== a.cliente ? <span className="text-muted-foreground"> · {a.telefono}</span> : null}
              <span className="text-muted-foreground"> · {a.motivo}</span>
            </p>
            {a.frase ? <p className="text-xs text-foreground/80">Dijo: «{a.frase}»</p> : null}
            {a.mensajeSugerido ? <p className="text-xs">Responde: “{a.mensajeSugerido}”</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs font-semibold ${a.estado === "SEGUNDO_AVISO" ? "text-red-600" : "text-amber-600"}`}>
                {a.estado === "SEGUNDO_AVISO" ? `Plazo vencido (${horaBogota(a.venceEn)}) · responde YA` : `Plazo: antes de las ${horaBogota(a.venceEn)}`}
              </p>
              {a.conversationId ? (
                <Link
                  href={enlaceAlChat(a.conversationId)}
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted"
                >
                  Abrir chat
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
