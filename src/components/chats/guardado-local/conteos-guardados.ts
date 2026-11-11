"use client";

/*
  Los numeros de las pastillas guardados en el equipo (Alex, 10-11-2026: "lista de chats sin brincos").

  /counts tarda varios segundos (medido: 4 s en Magilus). Antes la fila de pastillas salia sin numeros
  y, cuando llegaban, cada pastilla se ensanchaba y la fila brincaba. Ahora se guarda lo ultimo que se
  vio para cada combinacion de linea + estado + filtros, y al abrir la bandeja se pinta eso; el /counts
  de siempre lo actualiza por debajo.

  Con dueño (negocio + usuario, ver dueno.ts) y bajo el prefijo "aglite:lista-guardada": al cambiar de
  usuario o de negocio se borra junto con la lista guardada. Nunca se muestra con mas de 24 h.
  Cualquier error se traga: sin guardado, los numeros llegan con /counts como antes.
*/
import type { EsperaDeChats } from "@/features/chats/domain/espera-de-chats";

import { duenoDelGuardado } from "./dueno";
import { esGuardadoVigente, VERSION_DEL_GUARDADO } from "./reglas";

const PREFIJO = "aglite:lista-guardada:conteos:";
/** Cuantas combinaciones de filtros se guardan (las mas recientes). */
const MAXIMO_DE_VISTAS = 12;

export type ConteosDeLaBandeja = {
  mine: number;
  unassigned: number;
  all: number;
  sinResponder?: number;
  noLeido?: number;
};

export type ConteosGuardados = { counts: ConteosDeLaBandeja; espera: EsperaDeChats | null };

/** La espera ("espera N min", el numero de Esperando) se vuelve vieja rapido: solo se usa con menos de esto. */
export const MAX_MINUTOS_DE_LA_ESPERA_GUARDADA = 15;

type Entrada = ConteosGuardados & { guardadoEn: number; version: string };

function llave(dueno: string) {
  return `${PREFIJO}${dueno}`;
}

function leerTodo(dueno: string): Record<string, Entrada> {
  try {
    const crudo = window.localStorage.getItem(llave(dueno));
    const datos = crudo ? (JSON.parse(crudo) as unknown) : null;
    return datos && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, Entrada>) : {};
  } catch {
    return {};
  }
}

function esConteo(valor: unknown): valor is ConteosDeLaBandeja {
  if (!valor || typeof valor !== "object") return false;
  const conteo = valor as Record<string, unknown>;
  return ["mine", "unassigned", "all"].every((campo) => typeof conteo[campo] === "number");
}

/** Lo ultimo que se vio para esta vista de conteo, o null (sin dueño, de otra version o de mas de 24 h). */
export function leerConteosGuardados(firma: string, ahora: number = Date.now()): ConteosGuardados | null {
  try {
    if (typeof window === "undefined") return null;
    const dueno = duenoDelGuardado();
    if (!dueno) return null;
    const entrada = leerTodo(dueno)[firma];
    if (!entrada || !esGuardadoVigente(entrada, ahora) || !esConteo(entrada.counts)) return null;
    const esperaVigente = ahora - entrada.guardadoEn <= MAX_MINUTOS_DE_LA_ESPERA_GUARDADA * 60_000;
    return { counts: entrada.counts, espera: esperaVigente ? entrada.espera ?? null : null };
  } catch {
    return null;
  }
}

/** Guarda los numeros de esta vista. Nunca lanza. */
export function guardarConteos(firma: string, conteos: ConteosGuardados, ahora: number = Date.now()) {
  try {
    if (typeof window === "undefined") return;
    const dueno = duenoDelGuardado();
    if (!dueno || !esConteo(conteos.counts)) return;
    const todo = leerTodo(dueno);
    todo[firma] = { ...conteos, guardadoEn: ahora, version: VERSION_DEL_GUARDADO };
    const recientes = Object.entries(todo)
      .filter(([, entrada]) => entrada && typeof entrada.guardadoEn === "number")
      .sort((a, b) => b[1].guardadoEn - a[1].guardadoEn)
      .slice(0, MAXIMO_DE_VISTAS);
    window.localStorage.setItem(llave(dueno), JSON.stringify(Object.fromEntries(recientes)));
  } catch {
    // Sin espacio o sin permiso: la proxima vez los numeros llegan con /counts.
  }
}
