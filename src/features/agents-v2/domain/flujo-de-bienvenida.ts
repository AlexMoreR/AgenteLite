/**
 * "Flujo: Bienvenida" adentro del nodo Bienvenida: ese flujo ES el saludo.
 *
 * Antes se escribia "/Bienvenida", que es la convencion de los guiones del embudo. En el nodo se
 * leia mal: una barra suelta no dice que eso sea un flujo, y no se distinguia del mensaje. Se
 * escribe con nombre completo y el nodo lo muestra como una etiqueta, no como texto.
 *
 * La forma vieja se sigue entendiendo a proposito: lo que ya esta escrito no se rompe.
 *
 * Vive aparte -sin Prisma ni nada de servidor- porque lo usan los dos lados: el lienzo, para
 * pintar la etiqueta, y el publish, para saber que flujo mandar.
 */

/*
  Un renglon entero, no un pedazo suelto.

  Con ^...$ por renglon (bandera m) el nombre del flujo llega completo aunque tenga espacios
  -"Catalogo Butacos mani pedy"- y de paso se puede escribir el saludo en varios renglones con el
  flujo en uno propio.
*/
const LINEA_DE_FLUJO = /^[ \t]*(?:flujo[ \t]*:[ \t]*(.+)|\/(.+))[ \t]*$/gim;

/** El nombre escrito en el renglon de flujo, o null si no hay ninguno. */
export function nombreDelFlujoEnBienvenida(texto: string): string | null {
  LINEA_DE_FLUJO.lastIndex = 0;
  const encontrado = LINEA_DE_FLUJO.exec(texto ?? "");
  const nombre = (encontrado?.[1] ?? encontrado?.[2] ?? "").trim();
  return nombre || null;
}

/**
 * El saludo sin el renglon del flujo.
 *
 * Hace falta porque ese renglon es una instruccion nuestra: si no se saca, el cliente recibe
 * literalmente "Flujo: Bienvenida" como primer mensaje del negocio.
 */
export function textoSinLaLineaDeFlujo(texto: string): string {
  LINEA_DE_FLUJO.lastIndex = 0;
  return (texto ?? "").replace(LINEA_DE_FLUJO, "").trim();
}
