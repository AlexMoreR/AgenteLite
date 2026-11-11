/*
  LISTA QUIETA: mientras el mouse o el dedo estan sobre la lista de chats, ninguna fila cambia de lugar.

  Paso que la lista se reordeno justo antes de un clic (entro un mensaje y otro chat subio) y la
  asesora abrio el chat equivocado. Mientras la lista esta "sujeta", lo que se dibuja es la lista tal
  como estaba (la base) y lo que llega del tiempo real queda en espera:

  - Una fila que ya estaba se actualiza EN SU LUGAR (texto, contador, hora): misma posicion, mismo
    alto (las filas miden ALTO_DE_FILA fijo).
  - Una fila que se fue (se cerro, cambio de asesora) se queda con lo ultimo que se supo de ella:
    sacarla correria hacia arriba todas las de abajo.
  - Un chat nuevo o un cambio de orden NO se dibuja: `hayCambios` avisa que hay algo pendiente.
  - Lo que aparece DESPUES de la ultima fila de la base (la pagina siguiente al bajar) si se agrega
    al final: agregar abajo no mueve ninguna fila de arriba, y sin eso la lista no cargaria mas
    mientras se baja con el mouse encima.

  Al soltar, la lista vuelve a ser la nueva tal cual.
*/

/** Cuanto se queda quieta la lista despues de levantar el dedo (y mientras siga deslizandose). */
export const MARGEN_AL_SOLTAR_MS = 600;

export type ListaQuieta<T> = {
  /** Lo que se dibuja. */
  filas: T[];
  /** Hay chats nuevos o un orden distinto esperando a que se suelte la lista. */
  hayCambios: boolean;
  /** Cuantas filas se agregaron al final (la pagina siguiente): hay que sumarlas a la base. */
  agregadasAlFinal: number;
};

export function acomodarListaQuieta<T extends { id: string }>(base: readonly T[], nueva: readonly T[]): ListaQuieta<T> {
  if (base.length === 0) {
    return { filas: [...nueva], hayCambios: false, agregadasAlFinal: 0 };
  }

  const nuevaPorId = new Map(nueva.map((fila) => [fila.id, fila]));
  const enLaBase = new Set(base.map((fila) => fila.id));

  // La ultima fila de la lista nueva que ya estaba en la base: lo de despues es la pagina siguiente.
  let ultima = -1;
  for (let indice = 0; indice < nueva.length; indice += 1) {
    if (enLaBase.has(nueva[indice].id)) ultima = indice;
  }

  // Mismo orden = hasta esa fila, la lista nueva tiene exactamente las de la base y en el mismo orden.
  const hayCambios = ultima + 1 !== base.length || base.some((fila, indice) => nueva[indice]?.id !== fila.id);
  // Si ninguna fila de la base sigue (la lista se reemplazo entera) no se agrega nada al final.
  const alFinal = ultima >= 0 ? nueva.slice(ultima + 1) : [];

  if (!hayCambios && alFinal.length === 0) {
    // Nada se movio: se dibuja la lista nueva tal cual (mismos objetos, mismo orden).
    return { filas: [...nueva], hayCambios: false, agregadasAlFinal: 0 };
  }

  return {
    filas: [...base.map((fila) => nuevaPorId.get(fila.id) ?? fila), ...alFinal],
    hayCambios,
    agregadasAlFinal: alFinal.length,
  };
}
