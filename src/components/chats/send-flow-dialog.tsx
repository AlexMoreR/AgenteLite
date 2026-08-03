"use client";

import * as React from "react";
import { Loader2, Search, Workflow } from "lucide-react";
import { toast } from "sonner";

import { listFlowsForChatAction, sendFlowToChatAction, type FlowChoice } from "@/app/actions/flow-send-actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Mandar un flujo entero (el catalogo) desde el chat, con un toque.
 *
 * Antes la asesora buscaba el PDF en su celular y lo subia de nuevo en cada conversacion, aunque
 * el flujo con ese mismo catalogo ya estuviera armado. Aca elige uno de la lista y se manda solo,
 * igual que lo manda el agente.
 */
export function SendFlowDialog({
  open,
  onClose,
  source,
  conversationId,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  source: "agent" | "official";
  conversationId: string;
  agentId?: string;
}) {
  const [flujos, setFlujos] = React.useState<FlowChoice[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [busqueda, setBusqueda] = React.useState("");
  const [enviando, setEnviando] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setBusqueda("");
      return;
    }
    let cancelado = false;
    setCargando(true);
    void listFlowsForChatAction()
      .then((items) => {
        if (!cancelado) setFlujos(items);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [open]);

  const visibles = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? flujos.filter((flujo) => flujo.title.toLowerCase().includes(q)) : flujos;
  }, [flujos, busqueda]);

  const enviar = async (flujo: FlowChoice) => {
    if (enviando) {
      return;
    }
    setEnviando(flujo.id);
    // Un flujo puede llevar varios pasos con pausas entre medio: el aviso se queda hasta el final
    // para que la asesora no crea que se colgo y lo mande dos veces.
    const aviso = toast.loading(`Enviando "${flujo.title}"…`);
    try {
      const resultado = await sendFlowToChatAction({
        source,
        conversationId,
        flowId: flujo.id,
        agentId,
      });

      if (!resultado.ok) {
        toast.error(resultado.error, { id: aviso });
        return;
      }

      if (resultado.fallidos > 0 || resultado.omitidos > 0) {
        // Nunca decir "listo" a medias: si un paso no salio, la asesora tiene que saberlo para
        // mandarlo a mano. En WhatsApp lo ya enviado no se puede deshacer.
        const partes = [`Se enviaron ${resultado.enviados}`];
        if (resultado.fallidos > 0) partes.push(`${resultado.fallidos} fallaron`);
        if (resultado.omitidos > 0) partes.push(`${resultado.omitidos} sin enviar (audio)`);
        toast.warning(partes.join(" · "), { id: aviso, duration: 10000 });
      } else {
        toast.success(`"${flujo.title}" enviado`, { id: aviso });
      }

      onClose();
    } catch {
      toast.error("No se pudo enviar el flujo.", { id: aviso });
    } finally {
      setEnviando(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(valor) => !valor && !enviando && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar flujos</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar…"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-[45vh] min-h-[120px] overflow-y-auto">
          {cargando ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {flujos.length === 0 ? "Todavía no hay flujos creados." : "Ninguno coincide."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visibles.map((flujo) => (
                <li key={flujo.id}>
                  <button
                    type="button"
                    onClick={() => void enviar(flujo)}
                    disabled={Boolean(enviando)}
                    className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-muted disabled:opacity-60"
                  >
                    <Workflow className="size-4 shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{flujo.title}</span>
                    {enviando === flujo.id ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
