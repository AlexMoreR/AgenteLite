"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addConversationNoteAction } from "@/app/actions/chats-actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Nota interna: queda en el chat y el cliente NO la ve.
 *
 * Las asesoras se pasaban estos datos por WhatsApp entre ellas ("a esta ya le cotice", "pidio
 * factura a nombre del esposo") y se perdian: quien tomaba el chat despues no tenia como
 * enterarse. Queda con el nombre de quien la escribio, para poder preguntarle.
 */
export function InternalNoteDialog({
  open,
  onClose,
  conversationId,
  source = "agent",
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  source?: "agent" | "official";
}) {
  const router = useRouter();
  const [texto, setTexto] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);

  React.useEffect(() => {
    if (!open) setTexto("");
  }, [open]);

  const guardar = async () => {
    if (guardando || !texto.trim()) {
      return;
    }
    setGuardando(true);
    try {
      const resultado = await addConversationNoteAction({ conversationId, source, text: texto });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "No se pudo guardar la nota.");
        return;
      }
      toast.success("Nota guardada");
      onClose();
      router.refresh();
    } catch {
      toast.error("No se pudo guardar la nota.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(valor) => !valor && !guardando && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nota interna</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          Queda en el chat para el equipo. <span className="font-medium text-foreground">El cliente no la ve.</span>
        </p>

        <Textarea
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Ej. Ya le cotizaron el combo. Pidió factura a nombre del esposo."
          rows={4}
          maxLength={1000}
          autoFocus
          className="resize-none text-[15px]"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">{texto.trim().length}/1000</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="rounded-xl border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || !texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {guardando ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Guardar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
