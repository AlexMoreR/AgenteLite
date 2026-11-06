/*
  Que filas de la lista de chats se dibujan (05-11-2026, "la bandeja se pega al bajar").

  La lista ya pintaba solo las filas visibles, pero suponia que todas median 96 px y no era asi:
  las que tienen etiquetas median mas que las que no. Al bajar, el navegador corregia la posicion
  (scroll anchoring), eso disparaba otro calculo y la pantalla temblaba o se quedaba quieta.

  Ahora TODAS las filas miden exactamente ALTO_DE_FILA (la fila reserva siempre el lugar de las
  etiquetas) y la cuenta es exacta: los espacios de arriba y abajo mas las filas dibujadas suman
  siempre el alto total de la lista.
*/

/** Alto fijo de cada fila de la lista, en px (incluye la linea divisoria de abajo). */
export const ALTO_DE_FILA = 108;
/** Con esta cantidad de chats o menos se dibujan todos (no vale la pena recortar). */
export const UMBRAL_PARA_RECORTAR = 36;
/** Filas extra que se dibujan arriba y abajo de lo visible, para que al bajar rapido no se vea vacio. */
export const FILAS_DE_MARGEN = 6;
/**
 * Alto que se supone mientras la caja todavia no se midio (el primer dibujo). Sin esto, ese primer
 * dibujo pintaba TODAS las filas cargadas de una vez.
 */
export const ALTO_VISIBLE_SUPUESTO = 900;

export type VentanaDeLaLista = {
  /** Primera fila dibujada (incluida). */
  inicio: number;
  /** Ultima fila dibujada (excluida). */
  fin: number;
  /** Alto del espacio vacio de arriba, en px. */
  espacioArriba: number;
  /** Alto del espacio vacio de abajo, en px. */
  espacioAbajo: number;
};

export function calcularVentanaDeLaLista({
  total,
  scrollTop,
  altoVisible,
  altoDeFila = ALTO_DE_FILA,
  margen = FILAS_DE_MARGEN,
  umbral = UMBRAL_PARA_RECORTAR,
}: {
  total: number;
  scrollTop: number;
  altoVisible: number;
  altoDeFila?: number;
  margen?: number;
  umbral?: number;
}): VentanaDeLaLista {
  const filas = Math.max(0, Math.floor(total));
  // Pocas filas: se dibujan todas.
  if (filas <= umbral || altoDeFila <= 0) {
    return { inicio: 0, fin: filas, espacioArriba: 0, espacioAbajo: 0 };
  }
  // Todavia no se sabe cuanto mide la caja: se supone un alto de pantalla comun.
  const alto = altoVisible > 0 ? altoVisible : ALTO_VISIBLE_SUPUESTO;

  // El rebote del scroll en iPhone da valores negativos o pasados del fondo: se recortan.
  const scrollMaximo = Math.max(0, filas * altoDeFila - alto);
  const scroll = Math.min(Math.max(0, scrollTop), scrollMaximo);

  const visibles = Math.ceil(alto / altoDeFila) + 1;
  const primeraVisible = Math.floor(scroll / altoDeFila);
  const inicio = Math.max(0, Math.min(filas - 1, primeraVisible - margen));
  const fin = Math.min(filas, primeraVisible + visibles + margen);

  return {
    inicio,
    fin,
    espacioArriba: inicio * altoDeFila,
    espacioAbajo: (filas - fin) * altoDeFila,
  };
}

/*
  Que chats se precargan (06-11-2026, "que abran al instante como WhatsApp").

  Antes eran siempre los 5 de arriba. Ahora son los que se VEN en pantalla, con tope: en un celular
  de 700 px de alto son unos 8 y en una pantalla de 900 px unos 10. Con la lista oculta (mide 0, en
  el celular con un chat abierto) no se precarga nada, para no competir con el chat abierto.
*/

/** Como mucho, cuantos chats se precargan por pantalla. */
export const TOPE_DE_PRECARGA = 15;

export function clavesAPrecargar({
  claves,
  primeraFila,
  altoVisible,
  altoDeFila = ALTO_DE_FILA,
  tope = TOPE_DE_PRECARGA,
  excluidas,
}: {
  /** Las claves de los chats, en el orden en que se dibujan. */
  claves: ReadonlyArray<string>;
  /** Primera fila visible (la que esta arriba de la caja). */
  primeraFila: number;
  /** Alto de la caja de la lista, en px. Con 0 la lista esta oculta. */
  altoVisible: number;
  altoDeFila?: number;
  tope?: number;
  /** Chats que no se precargan (los que aparecieron por un cambio de pestaña o filtro). */
  excluidas?: ReadonlySet<string>;
}): string[] {
  if (!(altoVisible > 0) || !(altoDeFila > 0) || claves.length === 0 || tope <= 0) {
    return [];
  }
  const inicio = Math.min(Math.max(0, Math.floor(primeraFila) || 0), claves.length - 1);
  // La fila de arriba puede estar cortada: se cuenta una mas.
  const fin = Math.min(claves.length, inicio + Math.ceil(altoVisible / altoDeFila) + 1);

  const resultado: string[] = [];
  const vistas = new Set<string>();
  for (let fila = inicio; fila < fin && resultado.length < tope; fila += 1) {
    const clave = claves[fila]?.trim() ?? "";
    if (!clave || vistas.has(clave) || excluidas?.has(clave)) {
      continue;
    }
    vistas.add(clave);
    // Los oficiales no se precargan: su cargador los marca leidos (ver chat-conversation-warmup).
    if (clave.startsWith("official:")) {
      continue;
    }
    resultado.push(clave);
  }
  return resultado;
}
