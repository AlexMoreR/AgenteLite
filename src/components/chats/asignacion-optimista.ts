"use client";

import { useSyncExternalStore } from "react";

export type AsignadoOptimista = { id: string; name: string | null; email: string } | null;

/**
 * A QUIEN SE LE ACABA DE ASIGNAR UN CHAT, mientras el servidor se pone al dia.
 *
 * Vive FUERA del componente a proposito. Estaba adentro, en `useState`, y el `router.refresh()`
 * que sale justo despues de asignar puede desmontarlo: cuando eso pasa, el valor optimista se
 * pierde y la ficha vuelve a mostrar lo viejo -"Sin asignar"- hasta que llega el dato del
 * servidor.
 *
 * Y lo que hace la asesora cuando ve que su toque "no hizo nada" es volver a tocar. Medido en
 * produccion el 29-09-2026: el mismo chat tomado dos veces con 12 segundos de diferencia, pese al
 * candado que ya impide reasignarle a quien ya lo tiene -porque para el candado, la ficha decia
 * que no lo tenia nadie-. Y con el menu abierto, un segundo toque puede caer en otra opcion.
 *
 * Guardado por conversacion: al cambiar de chat deja de aplicar solo, sin tener que limpiarlo.
 */

const porConversacion = new Map<string, AsignadoOptimista>();
const oyentes = new Set<() => void>();

function avisar() {
  for (const oyente of oyentes) {
    oyente();
  }
}

export function recordarAsignacion(conversationId: string, valor: AsignadoOptimista) {
  porConversacion.set(conversationId, valor);
  avisar();
}

/**
 * El servidor ya dice lo mismo: se suelta la marca.
 *
 * Sin esto, la marca ganaria para siempre y una asignacion hecha desde OTRO lado -el menu de la
 * lista, otra pestaña, un jefe- no se veria nunca en esta ficha.
 */
export function olvidarSiYaLlego(conversationId: string, delServidor: AsignadoOptimista) {
  const guardado = porConversacion.get(conversationId);
  if (guardado === undefined) {
    return;
  }
  if ((guardado?.id ?? null) === (delServidor?.id ?? null)) {
    porConversacion.delete(conversationId);
    avisar();
  }
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Lo que hay que mostrar: la marca si existe, y si no lo que dice el servidor. */
export function useAsignadoMostrado(conversationId: string, delServidor: AsignadoOptimista) {
  const version = useSyncExternalStore(
    suscribir,
    () => porConversacion.get(conversationId),
    () => undefined,
  );
  return version !== undefined ? version : delServidor;
}
