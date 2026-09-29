/**
 * El slug de un producto, que desde el 28-09-2026 ya NO es una direccion.
 *
 * Este archivo tenia cuatro funciones y tres eran de la tienda publica -armaban `/camillas/combo-
 * camillas-cav-16` y sacaban el id de vuelta de esa direccion-. Esa tienda venia copiada de otro
 * proyecto y no aplicaba acá, asi que se borro entera.
 *
 * Lo que queda es lo unico que se usaba de verdad: pasar un nombre a slug al crear o editar un
 * producto. El slug sigue existiendo como identificador legible -lo usan el admin, Producto V2 y
 * el MCP-, pero ya no apunta a ninguna pagina. Por eso puede ser unico POR WORKSPACE en vez de
 * global, que es lo que hacia falta para que dos negocios tengan cada uno su catalogo.
 */
export function slugifyProductSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
