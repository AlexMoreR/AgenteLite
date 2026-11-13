"use client";

import * as React from "react";
import { Search, Workflow } from "lucide-react";
import { toast } from "sonner";

import { listFlowsForChatAction, type FlowChoice } from "@/app/actions/flow-send-actions";
import { enviarFlujoPorRuta } from "@/lib/chats/enviar-por-ruta";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { avisarEnvioDeFlujoEnCurso } from "@/components/chats/franja-envio-de-flujo";

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
  onEnviado,
}: {
  open: boolean;
  onClose: () => void;
  source: "agent" | "official";
  conversationId: string;
  agentId?: string;
  /** El servidor termino de mandar el flujo: la bandeja trae los mensajes de ese chat. */
  onEnviado?: (envio: { conversationId: string }) => void;
}) {
  const [flujos, setFlujos] = React.useState<FlowChoice[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [busqueda, setBusqueda] = React.useState("");

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

  const enviar = (flujo: FlowChoice) => {
    /**
     * Se manda y se sale: la pantalla no espera.
     *
     * Un flujo puede llevar varios pasos con pausas entre medio, y antes la ventana se quedaba
     * trabada esos segundos sin dejar contestar a nadie. El envio ya corre entero del lado del
     * servidor, asi que la pantalla no tiene por que quedarse mirando: se cierra al toque y el
     * aviso de abajo cuenta como termino.
     */
    onClose();
    enviarFlujoAlChat({ source, conversationId, flowId: flujo.id, titulo: flujo.title, agentId, alTerminar: onEnviado });
  };

  return (
    <Dialog open={open} onOpenChange={(valor) => !valor && onClose()}>
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
                    onClick={() => enviar(flujo)}
                    className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-muted"
                  >
                    <Workflow className="size-4 shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{flujo.title}</span>
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

/**
 * Manda un flujo al chat con el aviso de abajo (enviando / enviado / cuantos fallaron). Lo usan este
 * dialogo y el boton "Enviar flujo" que propone la estrella, asi los dos se comportan igual.
 */
export function enviarFlujoAlChat(input: {
  source: "agent" | "official";
  conversationId: string;
  flowId: string;
  titulo: string;
  agentId?: string;
  /*
    Se llama cuando el servidor termino (aunque algun paso haya fallado: los que salieron hay que
    mostrarlos). Antes la revalidacion de los pasos con archivo rearmaba la pantalla; ahora la
    bandeja trae los mensajes de ese chat con /live.
  */
  alTerminar?: (envio: { conversationId: string }) => void;
}) {
  const aviso = toast.loading(`Enviando "${input.titulo}"…`);

  // Por la ruta fija /enviar-flujo (la misma sendFlowToChatAction por dentro): un despliegue no la rompe.
  void enviarFlujoPorRuta({ source: input.source, conversationId: input.conversationId, flowId: input.flowId, agentId: input.agentId })
    .then((resultado) => {
      if (!resultado.ok) {
        toast.error(resultado.error, { id: aviso });
        return;
      }

      /*
        Desde la parte 2 lo manda el servidor: la respuesta trae envioId y total y todavia no salio
        nada. No se dice «listo»: la franja de arriba de la caja de escribir cuenta «N de M» (y la ven
        todas las que tienen este chat abierto). Sin envioId (un servidor viejo) sigue como antes.
      */
      if (resultado.envioId) {
        avisarEnvioDeFlujoEnCurso({
          conversationId: input.conversationId,
          envioId: resultado.envioId,
          total: resultado.total ?? 0,
        });
        if (resultado.omitidos > 0) {
          toast.warning(`Enviando "${input.titulo}" · ${resultado.omitidos} sin enviar (audio)`, { id: aviso, duration: 6000 });
        } else {
          toast.dismiss(aviso);
        }
        return;
      }

      try {
        input.alTerminar?.({ conversationId: input.conversationId });
      } catch {
        // El refresco es de respaldo: si falla, el aviso de abajo igual cuenta como termino.
      }

      if (resultado.fallidos > 0 || resultado.omitidos > 0) {
        // Nunca decir "listo" a medias: si un paso no salio, la asesora tiene que saberlo para
        // mandarlo a mano. En WhatsApp lo ya enviado no se puede deshacer.
        const partes = [`Se enviaron ${resultado.enviados}`];
        if (resultado.fallidos > 0) partes.push(`${resultado.fallidos} fallaron`);
        if (resultado.omitidos > 0) partes.push(`${resultado.omitidos} sin enviar (audio)`);
        toast.warning(partes.join(" · "), { id: aviso, duration: 10000 });
        return;
      }

      toast.success(`"${input.titulo}" enviado`, { id: aviso });
    })
    .catch(() => {
      toast.error("No se pudo enviar el flujo.", { id: aviso });
    });
}
