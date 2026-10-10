"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fijarPausaDeIAEnChatAction } from "@/app/actions/chats-actions";
import { estadoTrasRespuestaIA } from "@/lib/chat-envio-seguro";
import { cn } from "@/lib/utils";

/**
 * Interruptor de la IA de un chat (encendido = la IA responde).
 *
 * Antes era un FormActionSwitch: cambiaba en pantalla, mandaba "inviertelo" sin esperar respuesta
 * y, si fallaba, no decia nada. Con la pantalla vieja o con un doble toque la IA quedaba al reves de
 * lo que veia la asesora: ella creia haberla pausado y el bot le seguia respondiendo al cliente.
 *
 * Ahora:
 * - manda el estado ELEGIDO (pausar=1 / pausar=0), no "inviertelo";
 * - mientras responde el servidor no acepta otro toque;
 * - muestra el estado REAL que devolvio el servidor; si fallo, vuelve a como estaba y avisa.
 */
export function InterruptorDeIA({
  conversationId,
  automationPaused,
  source = "agent",
  conEtiqueta = false,
  className,
}: {
  conversationId: string;
  automationPaused: boolean;
  source?: "agent" | "official";
  /** Muestra "IA" al lado (en el celular el interruptor solo no se entendia). */
  conEtiqueta?: boolean;
  className?: string;
}) {
  const [pausada, setPausada] = useState(automationPaused);
  const [guardando, setGuardando] = useState(false);
  const enCursoRef = useRef(false);

  // Si llega un dato nuevo del servidor (otra asesora la cambio, o /live), se muestra ese. Mientras
  // hay un cambio en camino, manda lo que pidio la asesora (la respuesta trae el estado real).
  const [datoPrevio, setDatoPrevio] = useState(automationPaused);
  if (automationPaused !== datoPrevio) {
    setDatoPrevio(automationPaused);
    if (!guardando) {
      setPausada(automationPaused);
    }
  }

  const cambiar = async (activa: boolean) => {
    if (enCursoRef.current) {
      return;
    }
    const pausadaAntes = pausada;
    const pedidoPausada = !activa;
    if (pedidoPausada === pausadaAntes) {
      return;
    }
    enCursoRef.current = true;
    setGuardando(true);
    setPausada(pedidoPausada);

    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.set("source", source);
    formData.set("pausar", pedidoPausada ? "1" : "0");

    let respuesta: Awaited<ReturnType<typeof fijarPausaDeIAEnChatAction>> | null = null;
    try {
      respuesta = await fijarPausaDeIAEnChatAction(formData);
    } catch {
      respuesta = null;
    }

    const resultado = estadoTrasRespuestaIA(pausadaAntes, pedidoPausada, respuesta);
    setPausada(resultado.pausada);
    enCursoRef.current = false;
    setGuardando(false);
    if (resultado.aviso) {
      toast.error(resultado.aviso);
    } else {
      toast.success(resultado.pausada ? "IA pausada en este chat" : "IA activa en este chat");
    }
  };

  return (
    <label
      className={cn("inline-flex min-h-10 cursor-pointer items-center gap-1.5 px-1", guardando && "opacity-70", className)}
      title={pausada ? "IA pausada en este chat" : "IA activa en este chat"}
    >
      {conEtiqueta ? (
        <span className="text-[12px] font-semibold text-muted-foreground" aria-hidden="true">
          IA
        </span>
      ) : null}
      <Switch
        checked={!pausada}
        disabled={guardando}
        onCheckedChange={(activa) => void cambiar(activa)}
        aria-label={pausada ? "Reactivar IA" : "Pausar IA"}
        aria-busy={guardando}
      />
    </label>
  );
}
