/*
  Deslizar con el mouse la fila de pastillas de Chats (Alex, 10-11-2026).

  En el celular la fila se desliza con el dedo (scroll nativo). En el computador no habia como:
  la barra esta escondida. Aca van las cuentas puras, para probarlas sin navegador; el manejo de
  los eventos vive en appsidebar.tsx.
*/

/** Cuanto tiene que moverse el mouse de lado (en px) para que deje de ser un clic y sea arrastre. */
export const UMBRAL_DE_ARRASTRE_PX = 5;

/** Mas de 5 px de lado es arrastre; 5 o menos sigue siendo un clic (un temblor del mouse no cuenta). */
export function esArrastre(desplazamientoX: number): boolean {
  return Math.abs(desplazamientoX) > UMBRAL_DE_ARRASTRE_PX;
}

/** Lo que se lee de la fila (scrollLeft, scrollWidth, clientWidth). */
export type MedidasDeLaFila = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/** La fila tiene mas pastillas de las que caben (con 1 px de gracia por los redondeos). */
export function filaDesborda(medidas: Pick<MedidasDeLaFila, "scrollWidth" | "clientWidth">): boolean {
  return medidas.scrollWidth - medidas.clientWidth > 1;
}

/** Pixeles por "linea" y por "pagina" cuando el navegador manda la rueda en esas unidades. */
const PX_POR_LINEA = 16;

/**
 * Cuanto mover la fila con un giro de rueda, y si hay que frenar el desplazamiento de la pagina.
 *
 * - Si el evento trae mas movimiento lateral que vertical (touchpad o rueda lateral), manda ese;
 *   si no, la rueda de arriba/abajo mueve la fila de lado.
 * - Solo se frena la pagina cuando la fila de verdad se mueve: en los extremos, o si todo cabe,
 *   no se toca nada y la rueda sigue bajando la lista de chats como siempre.
 */
export function movimientoDeLaRueda(
  rueda: { deltaX: number; deltaY: number; deltaMode?: number },
  medidas: MedidasDeLaFila,
): { mover: number; frenarPagina: boolean } {
  const quieto = { mover: 0, frenarPagina: false };
  const maximo = medidas.scrollWidth - medidas.clientWidth;
  if (!filaDesborda(medidas)) return quieto;

  const crudo = Math.abs(rueda.deltaX) > Math.abs(rueda.deltaY) ? rueda.deltaX : rueda.deltaY;
  // deltaMode 1 = lineas, 2 = paginas (la fila entera); 0 = pixeles.
  const escala = rueda.deltaMode === 1 ? PX_POR_LINEA : rueda.deltaMode === 2 ? medidas.clientWidth : 1;
  const delta = crudo * escala;
  if (delta === 0) return quieto;

  const destino = Math.min(maximo, Math.max(0, medidas.scrollLeft + delta));
  const mover = destino - medidas.scrollLeft;
  // Menos de 1 px es el redondeo de estar ya en el extremo: no se frena la pagina.
  if (Math.abs(mover) < 1) return quieto;
  return { mover, frenarPagina: true };
}
