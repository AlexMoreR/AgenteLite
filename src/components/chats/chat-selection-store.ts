"use client";

import { useSyncExternalStore } from "react";
import type { SharedInboxConversationItem } from "./shared-inbox";

export type PendingChatSelection = {
  id: string;
  chatKey?: string | null;
  source?: "agent" | "official";
  agentId?: string | null;
  label: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  lastMessage?: string | null;
  lastMessageType?: SharedInboxConversationItem["lastMessageType"] | null;
  lastMessageDirection?: SharedInboxConversationItem["lastMessageDirection"] | null;
  lastMessageAt?: string | Date | null;
  channelType?: SharedInboxConversationItem["channelType"];
  cacheKey?: string | null;
  phoneNumber?: string | null;
  hasCache?: boolean;
};

type Listener = () => void;

let pendingSelection: PendingChatSelection | null = null;
// El usuario CERRO el chat explicitamente (boton volver, atras del navegador) o la seleccion se
// descarto por no resolverse. Hace falta distinguirlo de "todavia no eligio nada": abrir un chat
// ya no navega, asi que el chatKey de la URL que llego en el primer render queda congelado; sin
// esta bandera, cerrar el chat volveria a caer en ese valor viejo y el chat se reabriria solo.
let selectionClosed = false;
const listeners = new Set<Listener>();

function areSelectionsEqual(left: PendingChatSelection | null, right: PendingChatSelection | null) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.chatKey === right.chatKey &&
    left.source === right.source &&
    left.agentId === right.agentId &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    areTagsEqual(left.tags, right.tags) &&
    left.lastMessage === right.lastMessage &&
    left.lastMessageType === right.lastMessageType &&
    left.lastMessageDirection === right.lastMessageDirection &&
    left.lastMessageAt === right.lastMessageAt &&
    left.channelType === right.channelType &&
    left.cacheKey === right.cacheKey &&
    left.phoneNumber === right.phoneNumber &&
    left.hasCache === right.hasCache
  );
}

function areTagsEqual(
  left?: Array<{
    label: string;
    color: string;
  }> | null,
  right?: Array<{
    label: string;
    color: string;
  }> | null,
) {
  if (left === right) {
    return true;
  }

  if ((left?.length ?? 0) !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < (left?.length ?? 0); index += 1) {
    const leftTag = left?.[index];
    const rightTag = right?.[index];

    if (!leftTag || !rightTag || leftTag.label !== rightTag.label || leftTag.color !== rightTag.color) {
      return false;
    }
  }

  return true;
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setPendingConversationSelection(nextSelection: PendingChatSelection | null) {
  const wasClosed = selectionClosed;
  // Elegir un chat cancela el "cerrado": volvemos a tener un chat abierto.
  selectionClosed = false;

  if (areSelectionsEqual(pendingSelection, nextSelection) && !wasClosed) {
    return;
  }

  pendingSelection = nextSelection;
  notify();
}

/** Cierra el chat abierto: vuelve al estado vacio (movil: a la lista). */
export function clearPendingConversationSelection() {
  if (pendingSelection === null && selectionClosed) {
    return;
  }

  pendingSelection = null;
  selectionClosed = true;
  notify();
}

export function getPendingConversationSelection() {
  return pendingSelection;
}

export function getSelectionClosed() {
  return selectionClosed;
}

/**
 * Vuelve al estado neutro: sin seleccion y SIN marcar "cerrado". Para el desmontaje de la
 * bandeja. Usar clearPendingConversationSelection() ahi dejaria el store en "cerrado", y al
 * volver a entrar a chats por un link con ?chatKey= ese chat se ignoraria.
 */
export function resetConversationSelection() {
  if (pendingSelection === null && !selectionClosed) {
    return;
  }

  pendingSelection = null;
  selectionClosed = false;
  notify();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingConversationSelection() {
  return useSyncExternalStore(subscribe, getPendingConversationSelection, () => null);
}

/**
 * FUENTE UNICA DE VERDAD de "que chat esta abierto".
 *
 * El dato vive hoy en dos lados: la seleccion del cliente (este store, que se setea al hacer
 * click y hace que el chat aparezca al instante) y el chatKey de la URL, que llega como prop
 * desde el server component. La regla es: **manda la seleccion del cliente; la URL es el
 * respaldo** (primer render y deep links).
 *
 * Antes esta misma expresion estaba repetida en ~6 lugares de shared-inbox. Cada copia era una
 * chance de que un consumidor mirara una fuente distinta que el resto: exactamente el bug que
 * dejo chats roto (el chat cargaba pero se comparaba contra el id viejo y se descartaba). Si
 * manana cambia de donde sale el chat abierto, se cambia ACA y no en cada uso.
 */
export function useOpenChatKey(urlChatKey: string) {
  const pending = usePendingConversationSelection();
  // Snapshot booleano aparte: si solo cambia "cerrado" y la seleccion ya era null, el snapshot
  // de la seleccion no cambia y useSyncExternalStore no re-renderiza. Sin esto, cerrar el chat
  // no se veria en pantalla.
  const closed = useSyncExternalStore(subscribe, getSelectionClosed, () => false);

  if (pending?.chatKey) {
    return pending.chatKey.trim();
  }

  // Cerrado explicitamente: NO caemos al chatKey de la URL, que quedo congelado del primer
  // render (abrir un chat ya no navega). Si cayeramos, el chat se reabriria solo al cerrarlo.
  return closed ? "" : urlChatKey.trim();
}
