/**
 * Búsqueda del producto en el PANEL DE ENVÍO del chat (ficha "Contacto" → "ENVÍO").
 *
 * La asesora escribe el código ("CMB005") o parte del nombre ("divan", "camilla 3") y la lista se
 * filtra en la pantalla, sobre los productos que ya llegaron. No importan mayúsculas ni tildes, y
 * cada palabra escrita tiene que aparecer en el código o en el nombre.
 */

export type ProductoBuscable = { codigo: string; nombre: string };

/** Separador entre código y nombre, como en el pedido: "CMB005 · Combo Camilla Diván". */
export const SEPARADOR_CODIGO_NOMBRE = " · ";

/** Minúsculas, sin tildes y con los espacios juntos. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que ve la asesora: el código primero y luego el nombre. Sin código, solo el nombre. */
export function etiquetaDeProducto(producto: ProductoBuscable): string {
  const codigo = producto.codigo.trim();
  const nombre = producto.nombre.trim();
  if (!codigo) return nombre;
  if (!nombre) return codigo;
  return `${codigo}${SEPARADOR_CODIGO_NOMBRE}${nombre}`;
}

/** Si el producto sale con lo escrito. Texto vacío: sale. */
export function coincideProducto(producto: ProductoBuscable, texto: string): boolean {
  const palabras = normalizarTexto(texto).split(" ").filter(Boolean);
  if (palabras.length === 0) return true;
  const donde = normalizarTexto(`${producto.codigo} ${producto.nombre}`);
  return palabras.every((palabra) => donde.includes(palabra));
}

/** Los productos que salen con lo escrito, en el mismo orden en que llegaron. */
export function buscarProductosDeEnvio<T extends ProductoBuscable>(productos: readonly T[], texto: string): T[] {
  return productos.filter((producto) => coincideProducto(producto, texto));
}
