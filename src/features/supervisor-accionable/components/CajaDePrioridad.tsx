"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { marcarPrioridadAtendidaAction } from "@/app/actions/supervisor-accionable-actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import type { CajaCorta } from "../dominio/caja-corta";
import type { ChatDelPatron, Tarjeta } from "../dominio/reglas";

const COLOR_DE_GRAVEDAD: Record<Tarjeta["gravedad"], string> = {
  CRITICO: "border-red-500/60 bg-red-500/5",
  IMPORTANTE: "border-amber-500/60 bg-amber-500/5",
  OBSERVACION: "border-border",
};

/** Botón táctil (≥ 44 px de alto) para el celular. */
const BOTON = "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-semibold transition hover:bg-muted";

const COLOR_DE_SITUACION: Record<ChatDelPatron["situacion"], string> = {
  SIN_RESPUESTA: "text-red-600",
  RESUELTA: "text-emerald-600",
  CERRADA: "text-muted-foreground",
};

function Fila({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <p className="text-sm">
      <span className="font-medium text-muted-foreground">{titulo}: </span>
      <span className="text-foreground">{valor}</span>
    </p>
  );
}

/** Patrón de repetición: los chats que lo armaron, desplegables, cada uno con su "Abrir chat". */
function ChatsDelPatron({ chats }: { chats: ChatDelPatron[] }) {
  const sinRespuesta = chats.filter((c) => c.situacion === "SIN_RESPUESTA").length;
  return (
    <details className="group rounded-md border border-border bg-background/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span>
          Ver los {chats.length} chats
          {sinRespuesta ? <span className="font-medium text-red-600"> · {sinRespuesta} sin respuesta</span> : null}
        </span>
        <span aria-hidden className="text-muted-foreground transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="space-y-1.5 border-t border-border px-2 py-2">
        {chats.map((c) => (
          <li key={c.conversationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-foreground">{c.cliente}</p>
              {c.plazo || c.espera ? <p className="text-xs text-muted-foreground">{[c.plazo, c.espera].filter(Boolean).join(" · ")}</p> : null}
              <p className={`text-xs font-semibold ${COLOR_DE_SITUACION[c.situacion]}`}>{c.estado}</p>
            </div>
            <Link href={c.enlace} className={`${BOTON} shrink-0 bg-card text-foreground`}>
              Abrir chat
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Una prioridad de Alexander: caja pequeña que se toca en cualquier parte y abre una ventana a
 * pantalla completa con todo el detalle. Si la página llega con `#<ancla>` (push al celular), la
 * ventana de esa prioridad se abre sola.
 */
export function CajaDePrioridad({ tarjeta, corta, ancla }: { tarjeta: Tarjeta; corta: CajaCorta; ancla: string }) {
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    const abrirSiToca = () => {
      if (decodeURIComponent(window.location.hash.slice(1)) === ancla) setAbierta(true);
    };
    abrirSiToca();
    window.addEventListener("hashchange", abrirSiToca);
    return () => window.removeEventListener("hashchange", abrirSiToca);
  }, [ancla]);

  return (
    <li id={ancla} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className={`flex min-h-11 w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition hover:bg-muted/50 ${COLOR_DE_GRAVEDAD[tarjeta.gravedad]}`}
      >
        <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-bold ${corta.colorInsignia}`}>{corta.insignia}</span>
        <span className="text-sm font-semibold text-foreground">{corta.frase}</span>
        {corta.leads !== null ? <span className="text-sm text-foreground/80">👥 Leads afectados: {corta.leads}</span> : null}
        <span className="text-sm text-foreground/80">👤 Responsable: {corta.responsable}</span>
        {corta.desde ? <span className="text-sm text-foreground/80">📅 Desde: {corta.desde}</span> : null}
        {corta.recordatorios !== null ? (
          <span className="text-sm text-foreground/80">
            🔁 Ya se le recordó {corta.recordatorios} {corta.recordatorios === 1 ? "vez" : "veces"}
          </span>
        ) : null}
      </button>

      <Dialog open={abierta} onOpenChange={setAbierta}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 content-start gap-3 rounded-none p-4 sm:top-4 sm:left-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-xl sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${corta.colorInsignia}`}>{corta.insignia}</span>
              <DialogTitle className="text-base font-semibold">{corta.frase}</DialogTitle>
              <DialogDescription className="sr-only">Detalle completo de la alerta</DialogDescription>
            </div>
            <button type="button" onClick={() => setAbierta(false)} className={`${BOTON} shrink-0 bg-card text-foreground`}>
              Cerrar
            </button>
          </div>

          <div className="space-y-1.5 rounded-md border border-border bg-background/60 px-3 py-2">
            <p className="text-sm font-semibold">
              [{corta.insignia}] {tarjeta.quePaso}
            </p>
            <Fila titulo="Cliente / venta" valor={tarjeta.cliente} />
            <Fila titulo="Responsable" valor={tarjeta.responsable} />
            <Fila titulo="Qué intentó el Supervisor" valor={tarjeta.intentos} />
            <Fila titulo="Por qué te toca" valor={tarjeta.porQue} />
            <Fila titulo="Riesgo" valor={tarjeta.riesgo} />
            <Fila titulo="Solución recomendada" valor={tarjeta.solucion} />
            <p className="text-sm font-semibold text-foreground">Tu acción: {tarjeta.accionDeAlexander}</p>
          </div>

          {tarjeta.chats?.length ? <ChatsDelPatron chats={tarjeta.chats} /> : null}
          {!tarjeta.conversationId && !tarjeta.claveAlerta && tarjeta.chats && !tarjeta.chats.length ? (
            <p className="text-xs text-muted-foreground">Los chats de este patrón ya salieron del registro (más de 8 días).</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {tarjeta.conversationId ? (
              <Link href={tarjeta.enlace} className={`${BOTON} bg-card text-foreground`}>
                Abrir chat
              </Link>
            ) : tarjeta.claveAlerta ? (
              // Enlace normal (no Link): carga la página con ?alerta= para que el servidor la deje abierta y el navegador baje al ancla.
              <a href={tarjeta.enlace} className={`${BOTON} bg-card text-foreground`}>
                Ver el incidente
              </a>
            ) : null}
            <form action={marcarPrioridadAtendidaAction}>
              <input type="hidden" name="id" value={tarjeta.id} />
              <button type="submit" className={`${BOTON} bg-background font-medium text-muted-foreground`}>
                Resuelto / atendido
              </button>
            </form>
            <button type="button" onClick={() => setAbierta(false)} className={`${BOTON} bg-card text-foreground`}>
              Cerrar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
