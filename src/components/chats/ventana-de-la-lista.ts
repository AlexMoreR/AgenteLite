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
