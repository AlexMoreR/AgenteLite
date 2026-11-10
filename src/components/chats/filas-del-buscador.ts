/*
  LA LISTA DEL BUSCADOR DE CHATS, en el orden en que se muestra (Alex, 10-11-2026):
  primero los chats que coinciden por NOMBRE o NUMERO, en el orden de la bandeja; despues, al
  final, los que coinciden solo por el TEXTO de un mensaje, en el orden en que los devolvio
  /list?soloPorMensaje=1. Un chat que ya salio arriba no se repite abajo.

  Puro y sin React, para poder probarlo (scripts/check-busqueda-por-texto.mjs).
*/

type FilaConId = { id: string };

export function filasDelBuscador<T extends FilaConId>(input: {
  /** Los que coinciden por nombre o numero (ya filtrados y ordenados). */
  porNombreYNumero: readonly T[];
  /** Los que trajo la segunda llamada, por el texto de un mensaje. */
  porMensaje: readonly T[];
  /** Las filas que ya tiene la bandeja: si el chat esta, se usa esa (es la mas fresca). */
  actuales: ReadonlyMap<string, T>;
  /** El mismo filtro de estado que pasan las de arriba. */
  pasa: (fila: T) => boolean;
}): T[] {
  if (input.porMensaje.length === 0) return input.porNombreYNumero as T[];
  const yaEstan = new Set(input.porNombreYNumero.map((fila) => fila.id));
  const filas = [...input.porNombreYNumero];
  for (const encontrada of input.porMensaje) {
    if (!encontrada.id || yaEstan.has(encontrada.id)) continue;
    const fila = input.actuales.get(encontrada.id) ?? encontrada;
    if (!input.pasa(fila)) continue;
    yaEstan.add(fila.id);
    filas.push(fila);
  }
  return filas;
}
