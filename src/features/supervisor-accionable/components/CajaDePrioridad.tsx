"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { marcarPrioridadAtendidaAction } from "@/app/actions/supervisor-accionable-actions";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { cajaCorta, textoDeRecordatorios } from "../dominio/caja-corta";
import { ETIQUETA_DE_GRAVEDAD, anclaDePrioridad, type ChatDelPatron, type Tarjeta } from "../dominio/reglas";

const COLOR_DE_CAJA: Record<Tarjeta["gravedad"], string> = {
  CRITICO: "border-red-500/60 bg-red-500/5",
  IMPORTANTE: "border-amber-500/60 bg-amber-500/5",
  OBSERVACION: "border-border bg-muted/30",
};

const COLOR_DE_INSIGNIA: Record<Tarjeta["gravedad"], string> = {
  CRITICO: "bg-red-600 text-white",
  IMPORTANTE: "bg-amber-400 text-amber-950",
  OBSERVACION: "bg-muted text-muted-foreground",
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
 * Una alerta de "Prioridades de Alexander": caja pequeña que se toca para abrir el detalle completo en
 * una ventana a pantalla completa. Si se llega con `#prioridad-…` (aviso al celular), se abre sola.
 */
export function CajaDePrioridad({ tarjeta }: { tarjeta: Tarjeta }) {
  const [abierta, setAbierta] = useState(false);
  const caja = cajaCorta(tarjeta);
  const ancla = anclaDePrioridad(tarjeta.id);

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
        className={`block min-h-11 w-full space-y-1 rounded-md border px-3 py-2 text-left transition hover:brightness-95 ${COLOR_DE_CAJA[tarjeta.gravedad]}`}
      >
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_DE_INSIGNIA[tarjeta.gravedad]}`}>{caja.insignia}</span>
        {tarjeta.repeticiones && tarjeta.repeticiones > 1 ? (
          <span className="ml-1.5 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-foreground">×{tarjeta.repeticiones} · el más reciente</span>
        ) : null}
        <span className="block text-sm font-semibold text-foreground">{caja.frase}</span>
        {caja.leads !== null ? <span className="block text-sm text-foreground/80">👥 Leads afectados: {caja.leads}</span> : null}
        <span className="block text-sm text-foreground/80">👤 Responsable: {caja.responsable}</span>
        {caja.desde ? <span className="block text-sm text-foreground/80">📅 Desde: {caja.desde}</span> : null}
        {caja.recordatorios !== null ? <span className="block text-sm text-foreground/80">{textoDeRecordatorios(caja.recordatorios)}</span> : null}
      </button>

      <Dialog open={abierta} onOpenChange={setAbierta}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 content-start rounded-none sm:top-4 sm:left-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl"
        >
          <DialogHeader>
            <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_DE_INSIGNIA[tarjeta.gravedad]}`}>{caja.insignia}</span>
            <DialogTitle className="text-base leading-snug">
              [{ETIQUETA_DE_GRAVEDAD[tarjeta.gravedad]}] {tarjeta.quePaso}
            </DialogTitle>
            <DialogDescription>Detalle completo de la alerta</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
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
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
            <form action={marcarPrioridadAtendidaAction} className="contents">
              <input type="hidden" name="id" value={tarjeta.id} />
              <button type="submit" className={`${BOTON} bg-foreground text-background hover:bg-foreground/90`}>
                Resuelto / atendido
              </button>
            </form>
            <DialogClose className={`${BOTON} bg-background text-muted-foreground`}>Cerrar</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
