"use client";

import { Mic, MicOff, PhoneOff } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import type { EstadoLlamada } from "./useLlamada";

/**
 * La barra de la llamada en curso.
 *
 * Va FLOTANDO sobre la pantalla, no dentro de un diálogo: mientras habla, la asesora tiene que
 * poder seguir leyendo el chat, mirar la ficha y escribir la nota. Un diálogo modal tapaba
 * justamente lo que necesita ver, y cerrarlo habría cortado la llamada.
 *
 * Se ancla abajo en el celular y arriba a la derecha en pantallas grandes, que es donde no tapa
 * ni el compositor de mensajes ni la cabecera del chat.
 */
export function PanelDeLlamada({
  estado,
  nombre,
  telefono,
  avatarUrl,
  silenciado,
  segundos,
  onColgar,
  onAlternarSilencio,
}: {
  estado: EstadoLlamada;
  nombre: string;
  telefono: string;
  avatarUrl?: string | null;
  silenciado: boolean;
  segundos: number;
  onColgar: () => void;
  onAlternarSilencio: () => void;
}) {
  if (estado === "libre") {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3 sm:inset-x-auto sm:right-4 sm:bottom-auto sm:top-20 sm:justify-end">
      <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)]">
        <ContactAvatar
          avatarUrl={avatarUrl ?? null}
          label={nombre}
          className="h-10 w-10 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
          fallbackClassName="rounded-full bg-muted text-muted-foreground"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{nombre}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${
                estado === "hablando" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
              }`}
              aria-hidden="true"
            />
            <span className="tabular-nums">{textoDeEstado(estado, segundos, telefono)}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onAlternarSilencio}
          disabled={estado !== "hablando"}
          aria-pressed={silenciado}
          title={silenciado ? "Activar el micrófono" : "Silenciar mi micrófono"}
          className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
            silenciado
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {silenciado ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>

        <button
          type="button"
          onClick={onColgar}
          title="Colgar"
          aria-label="Colgar"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-700"
        >
          <PhoneOff className="size-4" />
        </button>
      </div>
    </div>
  );
}

function textoDeEstado(estado: EstadoLlamada, segundos: number, telefono: string) {
  if (estado === "hablando") {
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    return `${minutos}:${String(resto).padStart(2, "0")}`;
  }
  if (estado === "cortando") {
    return "Cortando…";
  }
  if (estado === "sonando") {
    return "Sonando…";
  }
  return telefono || "Marcando…";
}
