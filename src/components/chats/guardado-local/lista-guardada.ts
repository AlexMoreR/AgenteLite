"use client";

/*
  La lista de chats guardada en el celular (P5, T4), para pintarla mientras carga la pantalla de
  Chats en vez de las siluetas grises.

  Guarda SOLO lo que pinta la fila (filaParaGuardar: nada de rawPayload, medios ni ids internos), las
  primeras 40 filas, con dueño, version y fecha. Se lee solo si es del mismo dueño, de esta version y
  de menos de 24 h. Es de solo lectura: cuando llega la lista del servidor la reemplaza entera, asi
  un chat borrado, reasignado o sin acceso desaparece en ese momento.

  Cualquier error se traga: sin lista guardada se ven las siluetas de siempre.
*/
import { filasVisibles } from "@/features/chats/domain/chat-abierto-fuera-de-la-vista";
import type { SharedInboxConversationItem } from "../chat-inbox-types";
import { alCambiarElDueno, duenoDelGuardado } from "./dueno";
import {
  esGuardadoVigente,
  filaParaGuardar,
  recortarLista,
  VERSION_DEL_GUARDADO,
  type FilaGuardada,
} from "./reglas";

const PREFIJO = "aglite:lista-guardada:v3:";
const ESPERA_SIN_CAMBIOS_MS = 1000;
const ESPERA_DESOCUPADO_MS = 2000;

type ListaGuardadaEnElCelular = {
  version: string;
  guardadoEn: number;
  vistaKey: string;
  filas: FilaGuardada[];
};

let temporizador: ReturnType<typeof setTimeout> | null = null;
let pendiente: { dueno: string; vistaKey: string; filas: readonly SharedInboxConversationItem[] } | null = null;

alCambiarElDueno(() => {
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  pendiente = null;
});

function llave(dueno: string) {
  return `${PREFIJO}${dueno}`;
}

/** Lo que se escribe en el navegador: solo filas limpias, recortadas. */
export function armarListaParaGuardar(
  vistaKey: string,
  filas: readonly SharedInboxConversationItem[],
  ahora: number = Date.now(),
): ListaGuardadaEnElCelular {
  const limpias: FilaGuardada[] = [];
  for (const fila of recortarLista(filas)) {
    const limpia = filaParaGuardar(fila);
    if (limpia) limpias.push(limpia);
  }
  return { version: VERSION_DEL_GUARDADO, guardadoEn: ahora, vistaKey, filas: limpias };
}

function escribir() {
  temporizador = null;
  const lista = pendiente;
  pendiente = null;
  if (!lista) return;
  try {
    const dueno = duenoDelGuardado();
    // Si el dueño cambio entre medio, lo pendiente era del anterior: no se escribe.
    if (!dueno || dueno !== lista.dueno) return;
    window.localStorage.setItem(llave(dueno), JSON.stringify(armarListaParaGuardar(lista.vistaKey, lista.filas)));
  } catch {
    // Sin espacio o sin permiso: la proxima vez se ven las siluetas.
  }
}

/**
 * Guarda la lista despues de 1 s sin cambios y cuando el navegador esta desocupado (nunca en medio
 * del scroll). Sin dueño no hace nada.
 */
export function guardarListaEnElCelular(vistaKey: string, filas: readonly SharedInboxConversationItem[]) {
  try {
    const dueno = typeof window === "undefined" ? null : duenoDelGuardado();
    if (!dueno) return;
    pendiente = { dueno, vistaKey, filas };
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        temporizador = null;
        window.requestIdleCallback(escribir, { timeout: ESPERA_DESOCUPADO_MS });
        return;
      }
      escribir();
    }, ESPERA_SIN_CAMBIOS_MS);
  } catch {
    // Nunca rompe la bandeja.
  }
}

/** Quita un chat de la lista guardada (sin acceso: ver sin-acceso.ts). Nunca lanza. */
export function quitarDeLaListaDelCelular(chatKey: string) {
  try {
    if (typeof window === "undefined") return;
    if (pendiente) {
      pendiente = { ...pendiente, filas: pendiente.filas.filter((fila) => fila.id !== chatKey) };
    }
    const dueno = duenoDelGuardado();
    if (!dueno) return;
    const crudo = window.localStorage.getItem(llave(dueno));
    if (!crudo) return;
    const lista = JSON.parse(crudo) as ListaGuardadaEnElCelular | null;
    if (!lista || !Array.isArray(lista.filas) || !lista.filas.some((fila) => fila?.id === chatKey)) return;
    window.localStorage.setItem(
      llave(dueno),
      JSON.stringify({ ...lista, filas: lista.filas.filter((fila) => fila?.id !== chatKey) }),
    );
  } catch {
    // Se corrige igual con la proxima lista del servidor.
  }
}

/** La lista guardada si es de este dueño, de esta version y de menos de 24 h; si no, null. */
export function leerListaDelCelular(ahora: number = Date.now()): { vistaKey: string; filas: FilaGuardada[] } | null {
  try {
    if (typeof window === "undefined") return null;
    const dueno = duenoDelGuardado();
    if (!dueno) return null;
    const crudo = window.localStorage.getItem(llave(dueno));
    if (!crudo) return null;
    const lista = JSON.parse(crudo) as Partial<ListaGuardadaEnElCelular> | null;
    if (!lista || !esGuardadoVigente(lista, ahora) || !Array.isArray(lista.filas)) return null;
    // La fila del chat abierto fuera del filtro (marcada) sigue escondida al leer.
    const filas = filasVisibles(
      lista.filas.filter(
        (fila): fila is FilaGuardada => Boolean(fila) && typeof fila.id === "string" && typeof fila.label === "string",
      ),
    );
    return filas.length > 0 ? { vistaKey: typeof lista.vistaKey === "string" ? lista.vistaKey : "", filas } : null;
  } catch {
    return null;
  }
}
