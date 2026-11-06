/**
 * LISTO PARA PAGAR: reglas puras (sin base de datos) del aviso prioritario a la asesora.
 *
 * Cuando el V3 pide asesora porque el cliente dio una señal de compra (dijo para cuándo lo
 * necesita, pidió apartarlo, entregó datos o pidió la cuenta), el aviso no es un "Necesita
 * atención" más: sale con 🔥, sin la espera de 10 minutos, y seguido del mensaje de cierre que la
 * asesora puede copiar y mandar tal cual.
 */

/** Frases del motivo del V3 que significan "el cliente ya quiere pagar". Sin tildes ni mayúsculas. */
const FRASES_DE_COMPRA = ["senal de compra", "separar o comprar", "datos de compra", "cuenta para consignar"];

/** Minúsculas y sin tildes, para comparar sin depender de cómo lo escribió el libro. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ¿El motivo con el que el V3 pidió asesora es una señal de compra? */
export function esListoParaPagar(motivo: string | null | undefined): boolean {
  if (!motivo) {
    return false;
  }
  const limpio = normalizar(motivo);
  return FRASES_DE_COMPRA.some((frase) => limpio.includes(frase));
}

/** La mitad del precio, redondeada y con puntos de miles (989000 → "494.500"). Null sin precio válido. */
export function mitadDelPrecio(precio: number | null | undefined): string | null {
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) {
    return null;
  }
  const mitad = Math.round(precio / 2);
  return String(mitad).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** El WhatsApp de cierre que la asesora le manda al cliente, con el 50 % si se sabe el precio. */
export function mensajeDeCierre(precio: number | null | undefined): string {
  const mitad = mitadDelPrecio(precio);
  const anticipo = mitad ? `el 50 % (${mitad})` : "el 50 %";
  return `¡Listo! Te lo aparto con ${anticipo} y el resto antes del despacho. Te paso la cuenta: ¿en qué color lo quieres?`;
}

/** Las líneas de arriba del aviso por WhatsApp: 🔥 si es señal de compra, 🔔 si no. */
export function armarEncabezadoDelAviso(input: { cliente: string; telefono: string; motivo: string }): string[] {
  return [
    esListoParaPagar(input.motivo) ? "🔥 *LISTO PARA PAGAR*" : "🔔 *Necesita atención*",
    "",
    `👤 ${input.cliente}`,
    `📱 ${input.telefono}`,
    `📌 ${input.motivo}`,
  ];
}
