"use client";

import { Phone } from "lucide-react";

/**
 * El marcador de WhatsApp, embebido.
 *
 * Va en un iframe y no en una pestaña aparte a propósito: el audio de la llamada vive en la
 * página de WaCalls (es WebRTC, corre en el navegador), así que sacar a la asesora de la app
 * significaba que mientras habla no tiene delante ni la ficha del cliente ni dónde anotar. Acá
 * llama y registra en la misma pantalla.
 *
 * `allow="microphone"` es obligatorio: sin eso el navegador le niega el micrófono al recuadro y
 * la llamada conecta muda.
 */
export function MarcadorView({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
        <Phone className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">El marcador todavía no está configurado</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Falta conectar el servicio de llamadas. Las llamadas que se hagan por fuera se siguen
          registrando igual.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <iframe
        src={url}
        title="Marcador de llamadas"
        allow="microphone; autoplay"
        className="h-[70vh] w-full rounded-xl border border-border bg-card"
      />
      <p className="text-[11px] text-muted-foreground">
        La primera vez te va a pedir usuario y contraseña del marcador. Después queda conectado.
      </p>
    </div>
  );
}
