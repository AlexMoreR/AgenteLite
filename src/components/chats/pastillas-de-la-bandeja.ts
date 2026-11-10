/*
  LAS PASTILLAS DE LA BANDEJA (Todas, Mias, Sin responder): cual va marcada y que pasa al tocar una.

  Funciones puras, sin React, para que la barra de la bandeja y sus pruebas usen las mismas
  reglas. Correr las pruebas: npm run test:pastillas-bandeja

  Ojo: hasta el 10-11-2026 la pastilla de `sin_responder:si` se llamaba "No leido". Ahora se llama
  "Sin responder", y "No leido" es otra (`no_leido:si`: mensajes del cliente que nadie abrio). El
  orden de la fila y las ocultas viven en features/chats/domain/orden-de-las-pastillas.ts.

  Reglas:
  - Solo una va marcada a la vez. Con la condicion `sin_responder:si` puesta, la marcada es
    "Sin responder" (nunca Todas ni Mias). Si no, la de la asignada ('all' o 'mine'). Con una lista
    guardada abierta no va ninguna: la pintada es la lista.
  - Todas o Mias quitan `sin_responder:si` y cierran la lista abierta, igual que antes.
  - Sin responder deja solo `sin_responder:si`, con la asignada que esa persona ve por defecto
    (el jefe Todas, la asesora Mias), y cierra la lista abierta.
  - Tocar la que ya esta marcada no cambia nada: nunca quedan todas sin marcar.
*/
import type { AssignedFilter } from "./chat-inbox-types";

export type PastillaDeLaBandeja = "todas" | "mias" | "sin_responder";

/** Lo minimo que estas reglas leen de una condicion del filtro. */
type CondicionConCampo = { campo: string; operador: string };
type FiltrosConCondiciones = { condiciones: readonly CondicionConCampo[] };

export type EstadoDeLasPastillas<F extends FiltrosConCondiciones> = {
  asignada: AssignedFilter;
  filtros: F;
  /** Hay una lista guardada abierta (la pintada es la lista). */
  listaActiva: boolean;
  /** Ve al equipo (jefe): su vista por defecto es Todas; la asesora, Mias. */
  esJefe: boolean;
};

function esSinResponder(condicion: CondicionConCampo): boolean {
  return condicion.campo === "sin_responder" && condicion.operador === "si";
}

function esNoLeido(condicion: CondicionConCampo): boolean {
  return condicion.campo === "no_leido" && condicion.operador === "si";
}

/** La pastilla que va marcada, o null si no va ninguna (lista abierta, Sin asignar, una asesora). */
export function pastillaMarcada({
  asignada,
  filtros,
  listaActiva,
}: {
  asignada: AssignedFilter;
  filtros: FiltrosConCondiciones;
  listaActiva: boolean;
}): PastillaDeLaBandeja | null {
  if (filtros.condiciones.some(esSinResponder)) return "sin_responder";
  if (listaActiva) return null;
  if (asignada === "all") return "todas";
  if (asignada === "mine") return "mias";
  return null;
}

/** El nuevo `{ asignada, filtros }` despues de tocar una pastilla. */
export function alTocarPastilla<F extends FiltrosConCondiciones>(
  pastilla: PastillaDeLaBandeja,
  estadoActual: EstadoDeLasPastillas<F>,
): { asignada: AssignedFilter; filtros: F } {
  const { asignada, filtros, listaActiva, esJefe } = estadoActual;

  // La ya marcada: el mismo estado, asi nunca quedan todas sin marcar.
  if (pastillaMarcada({ asignada, filtros, listaActiva }) === pastilla) {
    return { asignada, filtros };
  }

  if (pastilla === "sin_responder") {
    return {
      asignada: esJefe ? "all" : "mine",
      filtros: { ...filtros, condiciones: [{ campo: "sin_responder", operador: "si" }] },
    };
  }

  // Todas o Mias: con una lista abierta la cierran (sin condiciones); si no, solo quitan Sin responder.
  return {
    asignada: pastilla === "todas" ? "all" : "mine",
    filtros: {
      ...filtros,
      condiciones: listaActiva ? [] : filtros.condiciones.filter((condicion) => !esSinResponder(condicion)),
    },
  };
}

/**
 * Los filtros con que se piden los numeros de /counts: los mismos sin `sin_responder:si` ni
 * `no_leido:si`, asi Todas, Mias y Sin asignar no bajan a cero cuando una de esas pastillas esta
 * puesta (sus numeros los calcula /counts aparte). Las demas condiciones quedan intactas.
 */
export function filtrosParaContar<F extends FiltrosConCondiciones>(filtros: F): F {
  return {
    ...filtros,
    condiciones: filtros.condiciones.filter((condicion) => !esSinResponder(condicion) && !esNoLeido(condicion)),
  };
}
