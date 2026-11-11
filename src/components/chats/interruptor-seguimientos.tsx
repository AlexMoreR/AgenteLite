"use client";

import { useEffect, useRef, useState } from "react";
import { esperarLaApertura, tomarSeguimientosDeLaApertura } from "@/components/chats/datos-de-la-apertura";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fijarSeguimientosAutomaticosAction, leerSeguimientosAutomaticosAction } from "@/app/actions/chats-actions";
import { cn } from "@/lib/utils";

/*
  El estado de cada chat, guardado 60 s en el navegador.

  Se pedia en CADA cambio de chat, y dos veces (la cabecera ancha y la barra del celular montan cada
  una su interruptor): una server action que va en fila con la ficha y la ultima llamada, y que demoraba
  el primer clic en el chat. Volver a un chat que se vio hace menos de un minuto ya no pregunta; los dos
  interruptores del mismo chat comparten el mismo pedido.

  Lo que se cambia AQUI se guarda al instante y lo ven los dos interruptores: nunca queda el dato viejo
  despues de tocarlo. Lo que cambie otra persona en otra pestaña puede tardar hasta 60 s en verse.
*/
const VIDA_DEL_ESTADO_MS = 60_000;
const estadoPorChat = new Map<string, { apagados: boolean; en: number }>();
const pedidosEnVuelo = new Map<string, Promise<boolean | null>>();
const oyentes = new Set<() => void>();

function estadoFresco(conversationId: string): boolean | null {
  const guardado = estadoPorChat.get(conversationId);
  return guardado && Date.now() - guardado.en < VIDA_DEL_ESTADO_MS ? guardado.apagados : null;
}

function guardarEstado(conversationId: string, apagados: boolean) {
  estadoPorChat.set(conversationId, { apagados, en: Date.now() });
  for (const oyente of oyentes) oyente();
}

function pedirEstado(conversationId: string): Promise<boolean | null> {
  const enVuelo = pedidosEnVuelo.get(conversationId);
  if (enVuelo) return enVuelo;
  const desde = Date.now();
  /*
    Al abrir el chat el estado viaja dentro de /live (velocidad, 10-nov-2026): se espera esa
    respuesta y, si lo trajo, no sale la accion de servidor (iba en fila detras de las demas).
  */
  const pedido = esperarLaApertura()
    .then(() => {
      const deLaApertura = tomarSeguimientosDeLaApertura(conversationId);
      return deLaApertura !== null
        ? ({ ok: true, apagados: deLaApertura } as Awaited<ReturnType<typeof leerSeguimientosAutomaticosAction>>)
        : leerSeguimientosAutomaticosAction(conversationId);
    })
    .then((respuesta) => {
      if (!respuesta.ok) return null;
      // Si mientras viajaba se cambio el interruptor, manda lo que se cambio (es mas nuevo).
      const guardado = estadoPorChat.get(conversationId);
      if (guardado && guardado.en >= desde) return guardado.apagados;
      guardarEstado(conversationId, respuesta.apagados);
      return respuesta.apagados;
    })
    .catch(() => null)
    .finally(() => {
      pedidosEnVuelo.delete(conversationId);
    });
  pedidosEnVuelo.set(conversationId, pedido);
  return pedido;
}

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
  const [apagados, setApagados] = useState<boolean | null>(() => estadoFresco(conversationId));
  const [guardando, setGuardando] = useState(false);
  const enCursoRef = useRef(false);

  useEffect(() => {
    let vigente = true;
    // Fresco: ya se dibujo con el (estado inicial; el control se monta de nuevo con cada chat).
    if (estadoFresco(conversationId) === null) {
      void pedirEstado(conversationId).then((valor) => {
        if (vigente && valor !== null) setApagados(valor);
      });
    }
    // El otro interruptor del mismo chat (cabecera ancha / barra del celular) lo cambio.
    const alCambiar = () => {
      if (enCursoRef.current) return;
      const valor = estadoFresco(conversationId);
      if (valor !== null) setApagados(valor);
    };
    oyentes.add(alCambiar);
    return () => {
      vigente = false;
      oyentes.delete(alCambiar);
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
      guardarEstado(conversationId, respuesta.apagados);
      toast.success(respuesta.apagados ? "Seguimientos automáticos apagados en este chat" : "Seguimientos automáticos encendidos en este chat");
    } else {
      setApagados(antes);
      // No se sabe que quedo en el servidor: la proxima vez se vuelve a preguntar.
      estadoPorChat.delete(conversationId);
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
