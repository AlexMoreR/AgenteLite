"use client";

import { useSyncExternalStore } from "react";

/**
 * Lo que puede hacer quien mira la bandeja, al alcance del menú de cada fila.
 *
 * Mismo esquema que chats-fijados-store: el menú de las 1.800 filas lo lee sin que haya que
 * pasarlo de mano en mano por la lista. El servidor igual vuelve a comprobarlo en cada acción;
 * esto solo decide qué opciones se muestran.
 */

let puedeBloquear = false;
const oyentes = new Set<() => void>();

export function inicializarPermisosDeLaBandeja(permisos: { puedeBloquear: boolean }) {
  if (permisos.puedeBloquear === puedeBloquear) {
    return;
  }
  puedeBloquear = permisos.puedeBloquear;
  for (const oyente of oyentes) {
    oyente();
  }
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Bloquear contactos: solo dueño y admin. */
export function usePuedeBloquear(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => puedeBloquear,
    () => false,
  );
}
