/**
 * EL PRECIO AL POR MAYOR NO LO DA EL AGENTE (Alex, 03-10-2026).
 *
 * El agente nunca menciona ni ofrece el precio mayorista. Si una clienta pide 3 o más unidades, o
 * pregunta por precio al por mayor, el agente avisa a una asesora y no da el precio: una compra
 * por cantidad la negocia una persona. Vale para todos los productos, tengan reglas o no.
 *
 * Es código puro: se prueba con frases sueltas, sin base.
 */

/** Desde cuántas unidades es "por cantidad". */
export const UNIDADES_POR_CANTIDAD = 3;

const PIDE_MAYOR = [
  /\bal\s+(por\s+)?mayor\b/,
  /\bpor\s+mayor\b/,
  /\bmayorista/,
  /\bal\s+mayoreo\b/,
  /\bmayoreo\b/,
  /\bprecio\s+(de|por)\s+cantidad\b/,
  /\bpor\s+cantidad(es)?\b/,
  /\bpara\s+revend/,
  /\bdistribuidor/,
  /\bdistribuir\b/,
  /\bal\s+detal\s+y\s+al\s+por\s+mayor\b/,
];

const NUMEROS_EN_LETRAS: Record<string, number> = {
  tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  quince: 15, veinte: 20, treinta: 30, cincuenta: 50, cien: 100, docena: 12, docenas: 24,
};

/**
 * Lo que se cuenta por unidades. "3 sillas" o "cinco camillas" es una compra por cantidad; "3
 * días", "a las 3", "3 cuotas" o "3 millones" no lo son, y por eso el número tiene que ir pegado a
 * algo que se compra.
 */
const COSAS_QUE_SE_COMPRAN = new Set([
  "unidad", "und", "ud", "pieza", "juego", "set", "kit", "combo", "silla", "sillon", "camilla", "butaco",
  "carrito", "auxiliar", "escalera", "lavacabeza", "mesa", "tocador", "puesto", "estacion", "tarima",
  "poltrona", "divan", "banco", "banca", "espejo", "mueble", "taburete", "lampara", "manicurista",
  "pedicure", "barbera", "camillas", "producto", "articulo",
]);

function normalizar(texto: string) {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function singular(palabra: string) {
  return palabra.replace(/(es|s)$/, "");
}

/** ¿La clienta pide precio al por mayor o una compra de 3 o más unidades? */
export function pidePorMayor(mensaje: string): boolean {
  const texto = normalizar(mensaje);
  if (PIDE_MAYOR.some((patron) => patron.test(texto))) {
    return true;
  }

  const palabras = texto.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  for (let i = 0; i < palabras.length; i += 1) {
    const palabra = palabras[i];
    const cantidad = /^\d{1,4}$/.test(palabra) ? Number(palabra) : NUMEROS_EN_LETRAS[palabra];
    if (!cantidad || cantidad < UNIDADES_POR_CANTIDAD || cantidad > 5000) continue;
    // "el combo de 4 piezas", "camilla con 3 cuerpos": el número describe el producto, no pide cantidad.
    if (["de", "con"].includes(palabras[i - 1] ?? "")) continue;
    // "3 sillas", "3 de las sillas", "5 combos completos": se mira lo que sigue, saltando un "de".
    const siguientes = palabras.slice(i + 1, i + 4).filter((p) => !["de", "las", "los", "el", "la", "mas"].includes(p));
    const cosa = siguientes[0];
    if (cosa && (COSAS_QUE_SE_COMPRAN.has(cosa) || COSAS_QUE_SE_COMPRAN.has(singular(cosa)))) {
      return true;
    }
  }
  return false;
}

/** Lo que se le dice a la clienta: que la atiende una persona, sin precio. */
export const RESPUESTA_POR_MAYOR =
  "¡Con gusto! 😊 Las compras de varias unidades las atiende directamente una asesora. Ya le aviso para que te escriba.";
