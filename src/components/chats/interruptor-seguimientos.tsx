"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fijarSeguimientosAutomaticosAction, leerSeguimientosAutomaticosAction } from "@/app/actions/chats-actions";
import { cn } from "@/lib/utils";

/**
 * Interruptor "Seguimientos automáticos" de un chat (encendido = el robot puede mandarle seguimientos).
 *
 * Es por conversación y NO toca la IA del chat. Al apagarlo se cancelan los seguimientos pendientes de ese
 * cliente y queda una nota interna en el chat. Carga su estado al abrir el chat y muestra siempre lo que
 * REALMENTE quedó en el servidor; si falla, vuelve a como estaba y avisa.
 */
export function InterruptorDeSeguimientos({
  conversationId,
  conEtiqueta = false,
  className,
}: {
  conversationId: string;
  /** Muestra "Seg." dentro de la bolita (en el celular el interruptor solo no se entiende). */
  conEtiqueta?: boolean;
  className?: string;
}) {
  const [apagados, setApagados] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enCursoRef = useRef(false);

  useEffect(() => {
    let vigente = true;
    leerSeguimientosAutomaticosAction(conversationId)
      .then((respuesta) => {
        if (vigente && respuesta.ok) setApagados(respuesta.apagados);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [conversationId]);

  const cambiar = async (encendidos: boolean) => {
    if (enCursoRef.current || apagados === null) return;
    const antes = apagados;
    if (antes === !encendidos) return;
    enCursoRef.current = true;
    setGuardando(true);
    setApagados(!encendidos);

    let respuesta: Awaited<ReturnType<typeof fijarSeguimientosAutomaticosAction>> | null = null;
    try {
      respuesta = await fijarSeguimientosAutomaticosAction({ conversationId, apagar: !encendidos });
    } catch {
      respuesta = null;
    }
    enCursoRef.current = false;
    setGuardando(false);
    if (respuesta?.ok) {
      setApagados(respuesta.apagados);
      toast.success(respuesta.apagados ? "Seguimientos automáticos apagados en este chat" : "Seguimientos automáticos encendidos en este chat");
    } else {
      setApagados(antes);
      toast.error(respuesta?.error ?? "No se pudo cambiar. Intenta de nuevo.");
    }
  };

  const titulo = apagados ? "Seguimientos automáticos: apagados" : "Seguimientos automáticos: encendidos";
  return (
    <label
      className={cn("inline-flex min-h-10 cursor-pointer items-center gap-1.5 px-1", (guardando || apagados === null) && "opacity-70", className)}
      title={apagados === null ? "Seguimientos automáticos" : titulo}
    >
      <Switch
        checked={apagados === false}
        thumbLabel={conEtiqueta ? "Seg." : undefined}
        disabled={guardando || apagados === null}
        onCheckedChange={(encendidos) => void cambiar(encendidos)}
        aria-label={apagados ? "Encender seguimientos automáticos" : "Apagar seguimientos automáticos"}
        aria-busy={guardando}
      />
    </label>
  );
}
