/*
  El chat abierto que no cumple el filtro de la lista (pastillas que coinciden, parte 2).

  La pagina de Chats agrega el chat abierto (?chatKey=) a la lista aunque no haya venido en la
  tanda, porque el panel de la derecha lo saca de ahi. Si ademas NO cumple el filtro (la lista
  "Maria" con 0 mostraba un chat de otra asesora), esa fila se MARCA con `fueraDeLaVista: true`:
  no se saca, porque el panel la necesita, pero la lista no la debe contar ni dibujar.

  Si cumple el filtro y solo no vino en la tanda (el chat viejo del enlace desde "Mi dia"), no se
  marca: sigue primero, como hoy.

  Funciones puras: sin base ni red. Pruebas en chat-abierto-fuera-de-la-vista.test.ts.
*/

export type FilaConMarcaDeVista = { fueraDeLaVista?: boolean };

/** True solo si el chat abierto no vino en la tanda Y tampoco cumple el filtro de la lista. */
export function debeMarcarseFueraDeLaVista({
  vinoEnLaTanda,
  cumpleElFiltro,
}: {
  vinoEnLaTanda: boolean;
  cumpleElFiltro: boolean;
}): boolean {
  return !vinoEnLaTanda && !cumpleElFiltro;
}

/** Las filas que la lista dibuja y cuenta: todas menos las marcadas como fuera de la vista. */
export function filasVisibles<T extends FilaConMarcaDeVista>(filas: T[]): T[] {
  return filas.filter((fila) => fila.fueraDeLaVista !== true);
}

/**
 * Una fila que llego de `/list` o de la tanda SI cumple el filtro: se deja con
 * `fueraDeLaVista: false` explicito, para que pise la marca que traia la misma fila antes.
 */
export function dentroDeLaVista<T extends FilaConMarcaDeVista>(fila: T): T & { fueraDeLaVista: false } {
  return { ...fila, fueraDeLaVista: false };
}
