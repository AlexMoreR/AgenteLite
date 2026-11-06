/**
 * LISTO PARA PAGAR (parte 1): reconocer cuándo el V3 pidió asesora por una SEÑAL DE COMPRA y armar
 * el aviso distinto para la asesora, con el mensaje de cierre listo para copiar y mandar.
 *
 * Sin base de datos: todo aquí es texto. El bot no le manda nada de esto al cliente; lo manda la
 * asesora si quiere.
 */

/** Frases (sin tildes, en minúsculas) que el V3 pone en el motivo cuando hay señal de compra. */
const FRASES_DE_SENAL = ["senal de compra", "separar o comprar", "datos de compra", "cuenta para consignar"];

/** Quita tildes y pasa a minúsculas, para comparar sin importar cómo vino escrito. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ¿El motivo del aviso es una señal de compra? */
export function esListoParaPagar(motivo: string | null | undefined): boolean {
  if (!motivo) {
    return false;
  }
  const limpio = normalizar(motivo);
  return FRASES_DE_SENAL.some((frase) => limpio.includes(frase));
}

/** La mitad del precio, redondeada y con puntos de miles (989000 → "494.500"). Sin precio válido, null. */
export function mitadDelPrecio(precio: number | null | undefined): string | null {
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) {
    return null;
  }
  const mitad = Math.round(precio / 2);
  return String(mitad).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** El mensaje que la asesora le puede mandar al cliente para cerrar. */
export function mensajeDeCierre(precio: number | null | undefined): string {
  const mitad = mitadDelPrecio(precio);
  const cincuenta = mitad ? `el 50 % (${mitad})` : "el 50 %";
  return `¡Listo! Te lo aparto con ${cincuenta} y el resto antes del despacho. Te paso la cuenta: ¿en qué color lo quieres?`;
}

/** Las líneas de arriba del aviso por WhatsApp a la asesora. */
export function armarEncabezadoDelAviso(input: { cliente: string; telefono: string; motivo: string }): string[] {
  return [
    esListoParaPagar(input.motivo) ? "🔥 *LISTO PARA PAGAR*" : "🔔 *Necesita atención*",
    "",
    `👤 ${input.cliente}`,
    `📱 ${input.telefono}`,
    `📌 ${input.motivo}`,
  ];
}
