"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock, Loader2, MessageCircle, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { claimLeadOnOpenAction, snoozeLeadAction } from "@/app/actions/crm-actions";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SNOOZE_PRESETS } from "@/lib/lead-snooze";
import type { MiDiaLead } from "../services/getMiDiaData";

/**
 * La ficha del lead ANTES de entrar al chat.
 *
 * Tocar el lead mandaba directo a la conversacion, y la asesora tenia que leer todo el hilo para
 * acordarse de quien era. Aca ve de un vistazo lo que necesita para decidir: en que etapa esta,
 * cuanto hace que no se le habla, quien hablo ultimo y como termino la ultima llamada.
 *
 * Y lo mas importante: puede POSPONERLO. La lista decide sola que es urgente, pero ella sabe lo
 * que el sistema no —que quedo de llamar despues del almuerzo, que la clienta pidio el lunes—.
 * Sin eso, el mismo lead le queda arriba pinchandola todo el dia.
 */
export function MiDiaLeadDialog({
  lead,
  onClose,
}: {
  lead: MiDiaLead | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState(false);
  const [personalizado, setPersonalizado] = React.useState("");

  React.useEffect(() => {
    if (!lead) setPersonalizado("");
  }, [lead]);

  if (!lead) {
    return null;
  }

  const abrirChat = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      if (!lead.esMio) {
        await claimLeadOnOpenAction(lead.conversationId);
      }
    } finally {
      router.push(`/cliente/chats?chatKey=${encodeURIComponent(lead.chatKey)}`);
    }
  };

  const posponer = async (hasta: Date) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const resultado = await snoozeLeadAction({
        contactId: lead.contactId,
        hasta: hasta.toISOString(),
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "No se pudo posponer.");
        return;
      }
      toast.success("Pospuesto. Vuelve solo cuando toque.");
      onClose();
      router.refresh();
    } catch {
      toast.error("No se pudo posponer.");
    } finally {
      setOcupado(false);
    }
  };

  const desdeAhora = (minutos: number) => posponer(new Date(Date.now() + minutos * 60 * 1000));

  const estado = lead.callDue
    ? `Llamada agendada${lead.lastCallResultLabel ? ` · ${lead.lastCallResultLabel}` : ""}`
    : lead.waitingOnUs
      ? "Te escribió y no le respondiste"
      : "Sin respuesta · toca hacer seguimiento";

  return (
    <Dialog open onOpenChange={(valor) => !valor && !ocupado && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Lead</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <ContactAvatar avatarUrl={lead.avatarUrl} label={lead.name} className="size-12 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">{lead.name}</p>
            <p className="truncate text-[13px] text-muted-foreground">{lead.phoneNumber}</p>
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl bg-muted/60 p-3 text-[13px]">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5" />
            Sin contacto hace {lead.hoursSinceContact < 24
              ? `${Math.max(1, lead.hoursSinceContact)} h`
              : `${Math.floor(lead.hoursSinceContact / 24)} días`}
          </p>
          <p className={`flex items-center gap-1.5 font-medium ${lead.callDue ? "text-amber-600" : lead.waitingOnUs ? "text-rose-600" : "text-foreground"}`}>
            {lead.callDue ? <PhoneCall className="size-3.5" /> : <MessageCircle className="size-3.5" />}
            {estado}
          </p>
          <p className="pt-1 text-muted-foreground">
            <span className="font-medium text-foreground">Último mensaje: </span>
            {lead.lastMessagePreview}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void abrirChat()}
          disabled={ocupado}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
          Abrir el chat
        </button>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <CalendarClock className="size-4 text-muted-foreground" />
            Posponer — se va de tu día y vuelve solo
          </p>

          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_PRESETS.map((opcion) => (
              <button
                key={opcion.label}
                type="button"
                onClick={() => void desdeAhora(opcion.minutos)}
                disabled={ocupado}
                className="rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                {opcion.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
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
              className="shrink-0 rounded-xl bg-foreground px-3 py-2 text-[13px] font-medium text-background transition disabled:opacity-40"
            >
              Posponer
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
