"use client";

import { ChevronDown, Mic, MicOff, PhoneOff } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import type { EstadoLlamada } from "./useLlamada";

/**
 * La llamada en curso, con las dos formas que tiene WhatsApp.
 *
 * Arranca en PANTALLA COMPLETA —foto grande, cronómetro, botones grandes— porque cuando una
 * llamada empieza es lo único que importa y hay que poder colgar sin apuntar a un botón de nueve
 * píxeles. Y se MINIMIZA a una barra cuando la asesora necesita volver a leer el chat, que es la
 * mitad de la razón de tener el teléfono adentro del CRM.
 *
 * No hay botón de "Altavoz": el navegador de un celular no deja elegir por dónde sale el audio
 * (eso es cosa del sistema), así que un botón ahí sería un adorno que no hace nada.
 */

export function PanelDeLlamada({
  estado,
  nombre,
  telefono,
  avatarUrl,
  silenciado,
  segundos,
  expandido,
  onMinimizar,
  onExpandir,
  onColgar,
  onAlternarSilencio,
}: {
  estado: EstadoLlamada;
  nombre: string;
  telefono: string;
  avatarUrl?: string | null;
  silenciado: boolean;
  segundos: number;
  expandido: boolean;
  onMinimizar: () => void;
  onExpandir: () => void;
  onColgar: () => void;
  onAlternarSilencio: () => void;
}) {
  if (estado === "libre") {
    return null;
  }

  const detalle = textoDeEstado(estado, segundos, telefono);

  if (!expandido) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:justify-end">
        <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)]">
          {/* Toda la zona del nombre vuelve a la pantalla grande: es el gesto que uno intenta. */}
          <button
            type="button"
            onClick={onExpandir}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label="Volver a la llamada"
          >
            <ContactAvatar
              avatarUrl={avatarUrl ?? null}
              label={nombre}
              className="h-10 w-10 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
              fallbackClassName="rounded-full bg-muted text-muted-foreground"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{nombre}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`inline-block size-1.5 shrink-0 rounded-full ${
                    estado === "hablando" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                  }`}
                  aria-hidden="true"
                />
                <span className="tabular-nums">{detalle}</span>
              </span>
            </span>
          </button>

          <BotonMicrofono silenciado={silenciado} activo={estado === "hablando"} onClick={onAlternarSilencio} />
          <BotonColgar onClick={onColgar} tamano="chico" />
        </div>
      </div>
    );
  }

  return (
    /**
     * Fondo oscuro fijo, no el del tema: una llamada es un estado excepcional y conviene que se
     * note de un vistazo que la pantalla está "tomada". Es la misma convención de cualquier app
     * de teléfono.
     */
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-slate-900 text-white">
      <div className="flex w-full items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onMinimizar}
          aria-label="Minimizar la llamada y volver al chat"
          title="Volver al chat"
          className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <ChevronDown className="size-6" />
        </button>
        <span className="text-xs text-white/60">Llamada de WhatsApp</span>
        <span className="size-11" aria-hidden="true" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <ContactAvatar
          avatarUrl={avatarUrl ?? null}
          label={nombre}
          className="size-32 rounded-full border-2 border-white/15 bg-white/10 text-3xl text-white"
          fallbackClassName="rounded-full bg-white/10 text-white"
        />
        <div className="space-y-1">
          <h2 className="text-balance text-2xl font-semibold">{nombre}</h2>
          <p className="text-sm tabular-nums text-white/70">{detalle}</p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center gap-10 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onAlternarSilencio}
            disabled={estado !== "hablando"}
            aria-pressed={silenciado}
            className={`inline-flex size-16 items-center justify-center rounded-full transition disabled:opacity-40 ${
              silenciado ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {silenciado ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </button>
          <span className="text-xs text-white/70">{silenciado ? "Silenciado" : "Silenciar"}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <BotonColgar onClick={onColgar} tamano="grande" />
          <span className="text-xs text-white/70">Finalizar</span>
        </div>
      </div>
    </div>
  );
}

function BotonMicrofono({
  silenciado,
  activo,
  onClick,
}: {
  silenciado: boolean;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!activo}
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
  );
}

function BotonColgar({ onClick, tamano }: { onClick: () => void; tamano: "chico" | "grande" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Colgar"
      aria-label="Colgar"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-700 ${
        tamano === "grande" ? "size-16" : "size-9"
      }`}
    >
      <PhoneOff className={tamano === "grande" ? "size-6" : "size-4"} />
    </button>
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
