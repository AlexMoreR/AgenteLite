"use client";

import * as React from "react";
import { Phone, PhoneMissed } from "lucide-react";

import { ultimaLlamadaDelContactoAction, type UltimaLlamada } from "@/app/actions/call-actions";
import { RegisterCallDialog } from "@/features/llamadas/components/RegisterCallDialog";

const HORA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" });
const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" });

/** "hoy 3:40 p. m.", "ayer 9:15 a. m." o "12 sep". */
function cuando(iso: string) {
  const fecha = new Date(iso);
  const dia = DIA.format(fecha);
  const ahora = new Date();
  if (dia === DIA.format(ahora)) {
    return `hoy ${HORA.format(fecha)}`;
  }
  if (dia === DIA.format(new Date(ahora.getTime() - 24 * 60 * 60 * 1000))) {
    return `ayer ${HORA.format(fecha)}`;
  }
  return FECHA.format(fecha);
}

/**
 * Que paso en la ultima llamada con este cliente, arriba del chat.
 *
 * Pedido de Alex (14-sep-2026): quien abre el chat tiene que saber, antes de escribir, si al cliente
 * ya se lo llamo y como quedo. Y si la llamada se hablo pero nadie dijo como quedo, se clasifica
 * ACA con "¿Cómo quedó?", sin ir a la pantalla de Llamadas.
 *
 * Se recarga solo cuando WaCalls avisa una llamada nueva de este chat (aviso "llamada").
 */
export function AvisoDeLlamada({
  contactId,
  conversationId,
  nombre,
}: {
  contactId: string;
  conversationId: string | null;
  nombre: string;
}) {
  const [llamada, setLlamada] = React.useState<UltimaLlamada | null>(null);
  const [abierto, setAbierto] = React.useState(false);

  const cargar = React.useCallback(() => {
    ultimaLlamadaDelContactoAction(contactId)
      .then(setLlamada)
      .catch(() => undefined);
  }, [contactId]);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  React.useEffect(() => {
    const alAviso = (evento: Event) => {
      const detalle = (evento as CustomEvent<{ type?: string; conversationId?: string | null }>).detail;
      if (detalle?.type === "llamada" && (!detalle.conversationId || detalle.conversationId === conversationId)) {
        cargar();
      }
    };
    window.addEventListener("official-realtime-poke", alAviso);
    return () => window.removeEventListener("official-realtime-poke", alAviso);
  }, [cargar, conversationId]);

  if (!llamada) {
    return null;
  }

  // El resumen automatico ("Llamada saliente · no contestó") dice mas que la etiqueta de la lista
  // ("No contestó - reintentar"); lo que escribio la asesora al clasificar va aparte, entre comillas.
  const automatico = llamada.resumen?.startsWith("Llamada ") ? llamada.resumen : null;
  const escrito = llamada.resumen && !automatico ? llamada.resumen : null;
  const titulo = llamada.pendiente || llamada.noContesto ? (automatico ?? llamada.etiqueta) : llamada.etiqueta;
  const Icono = llamada.noContesto ? PhoneMissed : Phone;

  return (
    <div
      className={`shrink-0 border-b px-3 py-2 ${
        llamada.pendiente
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
          : "border-border bg-muted/60"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Icono
          className={`size-4 shrink-0 ${
            llamada.pendiente
              ? "text-amber-600 dark:text-amber-400"
              : llamada.noContesto
                ? "text-rose-500"
                : "text-sky-600 dark:text-sky-400"
          }`}
        />
        <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground">
          <span className="font-medium">{titulo}</span>
          <span className="text-muted-foreground">
            {` · intento ${llamada.intento} · ${cuando(llamada.calledAt)}`}
            {llamada.pendiente ? " · falta decir cómo quedó" : ""}
          </span>
          {escrito ? <span className="text-muted-foreground">{` · “${escrito}”`}</span> : null}
        </p>
        {llamada.pendiente ? (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            ¿Cómo quedó?
          </button>
        ) : null}
      </div>
      <RegisterCallDialog
        open={abierto}
        onOpenChange={setAbierto}
        preset={{ contactId, name: nombre, pendingAttemptId: llamada.pendiente ? llamada.id : null }}
        alGuardar={cargar}
      />
    </div>
  );
}
