/**
 * EL NÚMERO DE COTIZACIÓN DE GESTIÓN, obligatorio para marcar Ganado.
 *
 * Regla de Alex (02-10-2026): no se puede marcar Ganado sin el número de la cotización de Gestión
 * (magilus.com), igual que no se puede descartar sin motivo. Una venta es plata recibida, y la
 * cotización es la prueba que la liga a lo que se vendió.
 *
 * Funciona en el navegador y en el servidor: el formulario avisa antes de guardar y el servidor
 * lo vuelve a comprobar, porque una acción se puede llamar a mano.
 */

export const EJEMPLO_DE_COTIZACION = "COT-00123";

export const AVISO_FALTA_COTIZACION = `Escribe el número de cotización de Gestión (ej. ${EJEMPLO_DE_COTIZACION}).`;

/**
 * Lleva lo que escribió la persona al formato de Gestión, o null si no es un número de cotización.
 *
 * Acepta las formas en que se escribe a las apuradas -"cot-123", "COT 00123", "123"- y las deja
 * todas como `COT-00123`. Sin esto, la misma cotización quedaría guardada de tres maneras y el
 * informe no las podría cruzar.
 */
export function normalizarCotizacion(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const partes = /^(?:COT-?)?(\d{1,8})$/.exec(limpio);
  if (!partes) {
    return null;
  }
  const numero = partes[1].replace(/^0+/, "");
  if (!numero) {
    return null;
  }
  return `COT-${numero.padStart(5, "0")}`;
}
