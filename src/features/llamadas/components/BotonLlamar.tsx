"use client";

import { Phone, PhoneOff } from "lucide-react";

import { useLlamadaEnCurso } from "./LlamadaEnCurso";

/**
 * Llamar al cliente desde la cabecera del chat.
 *
 * Está acá y no solo en el módulo de Llamadas porque es donde las asesoras pasan el día: leen la
 * conversación, deciden que es más rápido hablar, y llaman sin cambiar de pantalla. La llamada
 * queda flotando y el chat sigue debajo, así que pueden mirar lo que el cliente escribió mientras
 * hablan y anotar al terminar.
 *
 * Es SOLO el botón: la llamada, su panel y su audio viven en LlamadaEnCurso.tsx, una sola vez para
 * todo el CRM, para que no se corte al cambiar de chat o de pantalla.
 *
 * El registro en el CRM no depende de este botón: lo hace el aviso de WaCalls al terminar la
 * llamada, se marque desde donde se marque.
 */
export function BotonLlamar({
  telefono,
  nombre,
  avatarUrl,
  channelId,
}: {
  /**
   * Con qué se marca: un teléfono, o el identificador oculto de WhatsApp cuando es lo único que
   * el cliente nos dio. Las dos cosas se pueden llamar.
   */
  telefono: string | null;
  nombre: string;
  avatarUrl?: string | null;
  /** Canal del chat: la llamada sale por SU numero, el mismo con el que el cliente viene hablando. */
  channelId?: string | null;
}) {
  const { ocupada, marcar } = useLlamadaEnCurso();

  /*
    Sin NADA con que marcar el boton se muestra APAGADO, no se esconde.

    Es el caso de los leads que llegan solo con un identificador de WhatsApp, donde el "telefono"
    son quince digitos que no existen: son el 15% de la base y WhatsApp no los traduce -se le
    pregunto por diez y contesto vacio en los diez (25-09-2026)-.

    Antes el boton simplemente desaparecia, y desde afuera eso se lee como "el CRM esta roto"
    (Alex: "no aparece el boton para llamar, que rabia"). Apagado y con su explicacion, la asesora
    entiende en un segundo que no hay a donde marcar y que la salida es pedirle el numero.
  */
  if (!telefono) {
    return (
      <button
        type="button"
        disabled
        title="Este cliente llegó con número oculto de WhatsApp, así que no tenemos a dónde marcar. Pedile el número por el chat."
        aria-label="No se puede llamar: el cliente llegó con número oculto"
        className="inline-flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-full text-muted-foreground opacity-40"
      >
        <PhoneOff className="h-5 w-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => marcar({ telefono, nombre, avatarUrl, channelId })}
      disabled={ocupada}
      title={ocupada ? "Ya hay una llamada en curso" : `Llamar a ${nombre}`}
      aria-label={ocupada ? "Ya hay una llamada en curso" : `Llamar a ${nombre}`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sky-600 transition hover:bg-muted disabled:opacity-40"
    >
      <Phone className="h-5 w-5" />
    </button>
  );
}
