"use client";

import { Phone } from "lucide-react";
import { toast } from "sonner";

import { PanelDeLlamada } from "./PanelDeLlamada";
import { useLlamada } from "./useLlamada";

/**
 * Llamar al cliente desde la cabecera del chat.
 *
 * Está acá y no solo en el módulo de Llamadas porque es donde las asesoras pasan el día: leen la
 * conversación, deciden que es más rápido hablar, y llaman sin cambiar de pantalla. La llamada
 * queda flotando y el chat sigue debajo, así que pueden mirar lo que el cliente escribió mientras
 * hablan y anotar al terminar.
 *
 * El registro en el CRM no depende de este botón: lo hace el aviso de WaCalls al terminar la
 * llamada, se marque desde donde se marque.
 */
export function BotonLlamar({
  telefono,
  nombre,
  avatarUrl,
  compacto = false,
}: {
  /** Número marcable, o null si el contacto solo tiene un LID de WhatsApp. */
  telefono: string | null;
  nombre: string;
  avatarUrl?: string | null;
  /** En el menú de tres puntos el botón va con texto, no como ícono suelto. */
  compacto?: boolean;
}) {
  // Se desestructura en vez de guardar el objeto entero: la referencia del audio va aparte de
  // los valores que sí se leen al dibujar, y así no parece que estuvieramos mirando una
  // referencia durante el render.
  const { estado, silenciado, segundos, llamar, colgar, alternarSilencio, audioRef } = useLlamada({
    onError: (mensaje) => toast.error(mensaje),
  });

  // Sin número marcable no se ofrece: es el caso de los leads que llegan solo con un LID de
  // WhatsApp, donde el "teléfono" son quince dígitos que no existen.
  if (!telefono) {
    return null;
  }

  const ocupada = estado !== "libre";

  return (
    <>
      <button
        type="button"
        onClick={() => void llamar(telefono)}
        disabled={ocupada}
        title={ocupada ? "Ya hay una llamada en curso" : `Llamar a ${nombre}`}
        aria-label={`Llamar a ${nombre}`}
        className={
          compacto
            ? "inline-flex items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
            : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sky-600 transition hover:bg-muted disabled:opacity-40"
        }
      >
        <Phone className="h-4 w-4" />
        {compacto ? <span>Llamar</span> : null}
      </button>

      <PanelDeLlamada
        estado={estado}
        nombre={nombre}
        telefono={telefono}
        avatarUrl={avatarUrl}
        silenciado={silenciado}
        segundos={segundos}
        onColgar={() => void colgar()}
        onAlternarSilencio={() => void alternarSilencio()}
      />

      {/* El audio del cliente. Sin controles y fuera de la vista: la barra flotante ya tiene los
          botones, y un reproductor suelto ahi invita a pausar la llamada, que no es una idea. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </>
  );
}
