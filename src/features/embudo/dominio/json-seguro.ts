/**
 * JSON que Postgres acepte. Una columna `Json` rechaza ("invalid input syntax for type json") el
 * carácter nulo (\u0000) y las mitades sueltas de un emoji (surrogates solitarios). Esto pasa al
 * cortar un texto con `slice(0, 80)` justo en medio de un emoji. Aquí se limpian, a cualquier
 * profundidad, sin cambiar el resto del valor.
 */

const NULOS = /\u0000/g;
const SURROGATE_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function textoSeguro(texto: string): string {
  return texto.replace(NULOS, "").replace(SURROGATE_SUELTO, "");
}

/** Corta a `max` unidades sin partir un emoji por la mitad. */
export function cortarTexto(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  let fin = max;
  const ultimo = texto.charCodeAt(fin - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) fin -= 1;
  return texto.slice(0, fin);
}

export function jsonSeguro<T>(valor: T): T {
  if (typeof valor === "string") return textoSeguro(valor) as unknown as T;
  if (Array.isArray(valor)) return valor.map((item) => jsonSeguro(item)) as unknown as T;
  if (valor instanceof Date) return valor;
  if (valor && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, item] of Object.entries(valor as Record<string, unknown>)) {
      if (item === undefined) continue;
      salida[textoSeguro(clave)] = jsonSeguro(item);
    }
    return salida as T;
  }
  return valor;
}
