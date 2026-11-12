"use client";

import { Pin, X } from "lucide-react";
import type { MensajeFijado } from "@/lib/chats/mensaje-fijado";
import { getMediaPreviewLabel } from "./chat-inbox-format";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

/*
  LA FRANJA DEL MENSAJE FIJADO (Chats, parte 4), arriba de los mensajes, como en WhatsApp.

  Es solo del CRM: la clienta no ve nada. Va en el mismo lugar que los avisos de cierre y de
  llamada, dentro del contenedor que mira el observador que pega la vista al final: si la franja
  achica el area de mensajes, el chat vuelve a quedar pegado abajo y no brinca.

  Tocarla lleva al mensaje (igual que tocar una cita). La X lo desfija.
*/

// Mas de esto no entra en una linea ni en la compu; el resto lo corta `truncate`.
const LARGO_MAXIMO = 140;

/**
 * Lo que dice la franja: el texto del fijado en una linea (recortado), o "Foto", "Documento"...
 * si no tiene texto. null = no hay fijado y la franja no se dibuja. Pura, para probarla con Node.
 */
export function textoDeLaFranja(fijado: MensajeFijado | null | undefined): string | null {
  if (!fijado) return null;
  const texto = (fijado.texto ?? "").replace(/\s+/g, " ").trim();
  if (texto) {
    return texto.length > LARGO_MAXIMO ? `${texto.slice(0, LARGO_MAXIMO).trimEnd()}…` : texto;
  }
  return getMediaPreviewLabel(fijado.tipo as SharedInboxMessageItem["type"]) ?? "Mensaje";
}

export function FranjaMensajeFijado({
  fijado,
  alTocar,
  alDesfijar,
}: {
  fijado: MensajeFijado | null | undefined;
  alTocar: (fijado: MensajeFijado) => void;
  alDesfijar?: (fijado: MensajeFijado) => void;
}) {
  const texto = textoDeLaFranja(fijado);
  if (!fijado || !texto) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/60 pl-3 pr-1">
      <button
        type="button"
        onClick={() => alTocar(fijado)}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Ir al mensaje fijado: ${texto}`}
      >
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground">{texto}</span>
      </button>
      {alDesfijar ? (
        <button
          type="button"
          onClick={() => alDesfijar(fijado)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Desfijar mensaje"
          title="Desfijar"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
