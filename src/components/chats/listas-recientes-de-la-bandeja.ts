/*
  LAS ULTIMAS LISTAS DE LA BANDEJA, en memoria (maximo 5, una por vista).

  Volver a un filtro que se miro hace menos de 30 s no pide nada: se muestra la guardada. De 30 s a
  5 min se muestra la guardada y se pide UNA vez para refrescarla (el mismo pedido de siempre, no
  uno de mas). Mas de 5 min: se descarta.

  Un mensaje que entra o sale (chat-list-update) las ENVEJECE: se siguen mostrando al volver, pero
  siempre se piden de nuevo, porque solo el servidor sabe si un chat sigue en un filtro. Antes las
  borraba todas, y con la bandeja movida volver a Todas o a Mias siempre iba al servidor con la
  lista atenuada. Resolver o posponer (un chat SI sale de la lista) las borra: `olvidar`.

  Es generico en la fila para poder probarlo sin la pantalla (listas-recientes-de-la-bandeja.test.ts).
*/

export type ListaGuardada<Fila> = {
  items: Fila[];
  hasMore: boolean;
  offset: number;
  cursor: string | null;
  at: number;
};

/** Menos que esto: se muestra y no se pide nada. */
export const LISTA_FRESCA_MS = 30_000;
/** Menos que esto: se muestra y se pide de nuevo. Mas: se descarta. */
export const LISTA_VIGENTE_MS = 5 * 60_000;
const MAXIMO_DE_LISTAS = 5;

// Una sola bandeja por pestaña: el tipo de la fila lo pone quien lee.
const listasRecientes = new Map<string, ListaGuardada<unknown>>();

export function guardarListaReciente<Fila>(clave: string, lista: ListaGuardada<Fila>) {
  listasRecientes.delete(clave);
  listasRecientes.set(clave, lista);
  while (listasRecientes.size > MAXIMO_DE_LISTAS) {
    const masVieja = listasRecientes.keys().next().value;
    if (masVieja === undefined) break;
    listasRecientes.delete(masVieja);
  }
}

export function leerListaReciente<Fila>(clave: string): ListaGuardada<Fila> | undefined {
  return listasRecientes.get(clave) as ListaGuardada<Fila> | undefined;
}

/** Borra todas: un chat salio de la lista (resuelto, pospuesto). */
export function olvidarListasRecientes() {
  listasRecientes.clear();
}

/**
 * Las deja "viejas pero mostrables": se pintan en el acto al volver y siempre se vuelven a pedir.
 * No cambia cual vence primero ni el orden del tope de 5.
 */
export function envejecerListasRecientes(ahora: number = Date.now()) {
  const limite = ahora - LISTA_FRESCA_MS;
  for (const [clave, lista] of listasRecientes) {
    // `set` sobre una clave que ya esta no la mueve: el orden del tope sigue igual.
    if (lista.at > limite) listasRecientes.set(clave, { ...lista, at: limite });
  }
}

/** Para las pruebas: cuantas hay. */
export function cuantasListasRecientes() {
  return listasRecientes.size;
}
