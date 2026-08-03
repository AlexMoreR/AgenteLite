"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { snoozeLeadAction } from "@/app/actions/crm-actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SNOOZE_PRESETS } from "@/lib/lead-snooze";
import { CHAT_SNOOZED_EVENT, type ChatSnoozedDetail } from "@/components/chats/chat-inbox-types";

/**
 * Posponer el lead SIN salir del chat.
 *
 * Posponer ya existia en Mi dia, pero el momento en que la asesora se da cuenta de que no hay
 * nada mas que hacer hoy es leyendo la conversacion, no mirando la lista. Tenerlo que hacer
 * desde otra pantalla era volver atras a buscar el lead que acababa de dejar.
 *
 * Va pegado a "Resolver" porque son las dos salidas del chat: resolver es "esto se termino",
 * posponer es "esto sigue, pero no hoy".
 */
export function SnoozeChatControl({
  contactId,
  conversationId,
  source = "agent",
}: {
  contactId: string;
  conversationId: string;
  source?: "agent" | "official";
}) {
  const router = useRouter();
  const [menuAbierto, setMenuAbierto] = React.useState(false);
  const [dialogoAbierto, setDialogoAbierto] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [personalizado, setPersonalizado] = React.useState("");

  const posponer = async (hasta: Date) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const resultado = await snoozeLeadAction({ contactId, hasta: hasta.toISOString() });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "No se pudo posponer.");
        return;
      }
      toast.success("Pospuesto. Vuelve solo cuando toque.");
      setDialogoAbierto(false);
      // La bandeja escucha esto para sacarlo de la lista al instante: su refresco solo agrega y
      // actualiza, nunca quita, asi que sin el aviso el chat pospuesto seguia a la vista.
      window.dispatchEvent(
        new CustomEvent<ChatSnoozedDetail>(CHAT_SNOOZED_EVENT, {
          detail: { conversationId, source },
        }),
      );
      router.refresh();
    } catch {
      toast.error("No se pudo posponer.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Popover open={menuAbierto} onOpenChange={setMenuAbierto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Más acciones"
            title="Más acciones"
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-border px-1.5 text-muted-foreground transition hover:bg-muted"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1.5">
          {/* Base UI: el onSelect del menu se ignora en silencio, por eso va onClick. */}
          <button
            type="button"
            onClick={() => {
              setMenuAbierto(false);
              setDialogoAbierto(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
          >
            <AlarmClock className="size-4 text-[#8b5cf6]" />
            Posponer
          </button>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogoAbierto} onOpenChange={(valor) => !valor && !ocupado && setDialogoAbierto(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Posponer</DialogTitle>
          </DialogHeader>

          <p className="text-[13px] text-muted-foreground">
            Se va de Mi día y vuelve solo cuando toque. La conversación no se cierra.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_PRESETS.map((opcion) => (
              <button
                key={opcion.label}
                type="button"
                disabled={ocupado}
                onClick={() => void posponer(new Date(Date.now() + opcion.minutos * 60 * 1000))}
                className="rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                {opcion.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={personalizado}
              onChange={(evento) => setPersonalizado(evento.target.value)}
              className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-card px-2.5 text-[13px] text-foreground outline-none"
              aria-label="Posponer hasta una fecha y hora"
            />
            <button
              type="button"
              disabled={ocupado || !personalizado}
              onClick={() => {
                const elegido = new Date(personalizado);
                if (!Number.isFinite(elegido.getTime())) {
                  toast.error("Elegí una fecha válida.");
                  return;
                }
                void posponer(elegido);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-[13px] font-medium text-background transition disabled:opacity-40"
            >
              {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Posponer
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
