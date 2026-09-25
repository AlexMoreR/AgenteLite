"use client";

import { useState } from "react";
import { Phone, PhoneOff } from "lucide-react";

import { looksLikeLidNumber } from "@/lib/whatsapp-lid";
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
  // Se desestructura en vez de guardar el objeto entero: la referencia del audio va aparte de
  // los valores que sí se leen al dibujar, y así no parece que estuvieramos mirando una
  // referencia durante el render.
  const { estado, silenciado, segundos, llamar, colgar, alternarSilencio, audioRef } = useLlamada({
    channelId,
    onError: (mensaje) => toast.error(mensaje),
  });

  // Cada llamada arranca en pantalla completa; minimizar es una decision de la asesora DENTRO de
  // esa llamada, no una preferencia que deba sobrevivir a la siguiente. Se decide al marcar y no
  // reaccionando al estado despues, que era una vuelta de mas.
  const [expandido, setExpandido] = useState(true);

  /*
    Los leads de anuncios llegan con un identificador oculto en vez de telefono, y a ese
    identificador SI se le puede llamar: probado el 25-09-2026 llamando al numero de Alex por su
    identificador -timbro, contesto, y el audio se establecio-. Son el 15% de la base.
  */
  const esOculto = looksLikeLidNumber(telefono);

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

  const ocupada = estado !== "libre";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setExpandido(true);
          void llamar(telefono, esOculto);
        }}
        disabled={ocupada}
        title={ocupada ? "Ya hay una llamada en curso" : `Llamar a ${nombre}`}
        aria-label={`Llamar a ${nombre}`}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sky-600 transition hover:bg-muted disabled:opacity-40"
      >
        <Phone className="h-5 w-5" />
      </button>

      <PanelDeLlamada
        estado={estado}
        nombre={nombre}
        telefono={telefono}
        avatarUrl={avatarUrl}
        silenciado={silenciado}
        segundos={segundos}
        expandido={expandido}
        onMinimizar={() => setExpandido(false)}
        onExpandir={() => setExpandido(true)}
        onColgar={() => void colgar()}
        onAlternarSilencio={() => void alternarSilencio()}
      />

      {/* El audio del cliente. Sin controles y fuera de la vista: la barra flotante ya tiene los
          botones, y un reproductor suelto ahi invita a pausar la llamada, que no es una idea. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </>
  );
}
