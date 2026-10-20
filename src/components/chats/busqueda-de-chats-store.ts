"use client";

import { useSyncExternalStore } from "react";

/*
  EL BUSCADOR DE CHATS COMO EL DE WHATSAPP (Alex, 19-10-2026).

  Dos datos chicos que comparten la caja del buscador (appsidebar), la bandeja (shared-inbox) y el
  panel del chat:

  1. BUSQUEDAS RECIENTES: los ultimos chats que se abrieron DESDE el buscador, con su foto, como la
     fila de arriba de WhatsApp. Viven en este dispositivo (localStorage): son una comodidad de quien
     busca, no un dato del negocio.

  2. MENSAJE A ENFOCAR: al tocar un resultado de la seccion "Mensajes" se abre el chat y hay que
     llevar la vista hasta ESE mensaje. Lo pide la bandeja y lo cumple el panel cuando el mensaje
     aparece en pantalla.
*/

export type ChatReciente = {
  chatKey: string;
  nombre: string;
  telefono: string;
  avatarUrl: string | null;
  href: string;
};

const CLAVE_RECIENTES = "aglite:busqueda:recientes:v1";
const MAXIMO_RECIENTES = 8;
const listeners = new Set<() => void>();
let recientesEnMemoria: ChatReciente[] | null = null;
const SIN_RECIENTES: ChatReciente[] = [];

function avisar() {
  for (const listener of listeners) listener();
}

function leerRecientes(): ChatReciente[] {
  if (recientesEnMemoria) return recientesEnMemoria;
  try {
    const crudo = window.localStorage.getItem(CLAVE_RECIENTES);
    const lista = crudo ? (JSON.parse(crudo) as unknown) : [];
    recientesEnMemoria = Array.isArray(lista)
      ? lista.filter(
          (fila): fila is ChatReciente =>
            Boolean(fila) && typeof fila.chatKey === "string" && typeof fila.href === "string",
        )
      : [];
  } catch {
    recientesEnMemoria = [];
  }
  return recientesEnMemoria;
}

/** Anota un chat abierto desde el buscador (queda primero; sin repetidos). */
export function anotarChatReciente(chat: ChatReciente) {
  const siguiente = [chat, ...leerRecientes().filter((fila) => fila.chatKey !== chat.chatKey)].slice(
    0,
    MAXIMO_RECIENTES,
  );
  recientesEnMemoria = siguiente;
  try {
    window.localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(siguiente));
  } catch {
    // Sin almacenamiento solo se pierde la fila de recientes al recargar.
  }
  avisar();
}

export function borrarChatsRecientes() {
  recientesEnMemoria = [];
  try {
    window.localStorage.removeItem(CLAVE_RECIENTES);
  } catch {
    // nada
  }
  avisar();
}

function suscribir(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatsRecientes(): ChatReciente[] {
  return useSyncExternalStore(
    suscribir,
    () => (typeof window === "undefined" ? SIN_RECIENTES : leerRecientes()),
    () => SIN_RECIENTES,
  );
}

/* ---------------------------------------------------------------- mensaje a enfocar */

export type MensajeAEnfocar = { chatKey: string; messageId: string; pedidoEn: number };

let mensajeAEnfocar: MensajeAEnfocar | null = null;

export function pedirIrAlMensaje(chatKey: string, messageId: string) {
  mensajeAEnfocar = { chatKey, messageId, pedidoEn: Date.now() };
  avisar();
}

export function soltarMensajeAEnfocar() {
  if (!mensajeAEnfocar) return;
  mensajeAEnfocar = null;
  avisar();
}

export function leerMensajeAEnfocar() {
  return mensajeAEnfocar;
}

export function useMensajeAEnfocar(): MensajeAEnfocar | null {
  return useSyncExternalStore(suscribir, leerMensajeAEnfocar, () => null);
}
