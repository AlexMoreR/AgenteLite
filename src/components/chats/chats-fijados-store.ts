"use client";

import { useSyncExternalStore } from "react";

/**
 * Los chats fijados de quien mira la bandeja, en el navegador (ver lib/chats-fijados).
 *
 * Fuera de los componentes a proposito, igual que asignacion-optimista: la lista y el menu de cada
 * fila los leen sin pasarlos de mano en mano, y al fijar desde el menu la lista se reordena en el
 * acto, sin esperar a que se vuelva a pedir la bandeja.
 */

let fijados: readonly string[] = [];
const oyentes = new Set<() => void>();

function avisar() {
  for (const oyente of oyentes) {
    oyente();
  }
}

/** Lo que dice el servidor al cargar la pagina. */
export function inicializarFijados(claves: readonly string[]) {
  if (claves.length === fijados.length && claves.every((clave, i) => clave === fijados[i])) {
    return;
  }
  fijados = [...claves];
  avisar();
}

export function ponerFijados(claves: readonly string[]) {
  fijados = [...claves];
  avisar();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

const vacio: readonly string[] = [];

export function useChatsFijados(): readonly string[] {
  return useSyncExternalStore(
    suscribir,
    () => fijados,
    () => vacio,
  );
}
