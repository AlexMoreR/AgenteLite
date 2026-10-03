import { prisma } from "@/lib/prisma";

/**
 * EL CATÁLOGO PARA EL AGENTE V3: los productos activos de Gestión.
 *
 * Decisión de Alex (03-10-2026). El V3 contesta por reglas, y sus reglas hablan de UN producto (el
 * Combo Camillas). Si una clienta preguntaba por otro —un lavacabezas, una silla de manicure—, el
 * V3 no tenía nada que decir. Ahora, cuando ninguna regla aplica y la clienta nombra un producto
 * activo del catálogo, el agente le responde con lo que dice Gestión (nombre, precio, foto) y la
 * descripción de venta del CRM, y avisa a una asesora para que siga ella.
 *
 * Y lo inactivo (oculto o borrado en Gestión) no se ofrece: ni por el catálogo ni por las reglas.
 */

export type ProductoDelCatalogoV3 = {
  id: string;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  precio: number;
  precioMayorista: number;
  cantidadMinimaMayorista: number;
  descripcion: string | null;
  foto: string | null;
};

const VIDA_MS = 5 * 60_000;
const enMemoria = new Map<string, { productos: ProductoDelCatalogoV3[]; leidoEn: number }>();

export async function catalogoActivo(workspaceId: string): Promise<ProductoDelCatalogoV3[]> {
  const guardado = enMemoria.get(workspaceId);
  if (guardado && Date.now() - guardado.leidoEn < VIDA_MS) {
    return guardado.productos;
  }
  const filas = await prisma.product.findMany({
    where: { workspaceId, activo: true },
    select: {
      id: true,
      name: true,
      code: true,
      price: true,
      wholesalePrice: true,
      minWholesaleQty: true,
      description: true,
      thumbnailUrl: true,
      category: { select: { name: true } },
      images: { orderBy: { order: "asc" }, take: 1, select: { url: true } },
    },
  });
  const productos = filas.map((fila) => ({
    id: fila.id,
    nombre: fila.name,
    codigo: fila.code,
    categoria: fila.category?.name ?? null,
    precio: Number(fila.price),
    precioMayorista: Number(fila.wholesalePrice),
    cantidadMinimaMayorista: fila.minWholesaleQty,
    descripcion: fila.description?.trim() || null,
    foto: fila.thumbnailUrl?.trim() || fila.images[0]?.url || null,
  }));
  enMemoria.set(workspaceId, { productos, leidoEn: Date.now() });
  return productos;
}

/** Los ids de producto de este negocio que NO están activos (para no ofrecerlos por reglas). */
export async function productosInactivos(workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const filas = await prisma.product.findMany({
    where: { workspaceId, id: { in: ids }, activo: false },
    select: { id: true },
  });
  return new Set(filas.map((fila) => fila.id));
}

/* ------------------------------------------------------------------ reconocer */

/** Palabras que no distinguen un producto de otro. */
const RELLENO = new Set([
  "de", "del", "la", "el", "los", "las", "y", "con", "para", "en", "un", "una", "por", "tipo", "sin",
  "x", "cm", "mas", "o", "a", "al", "lo", "que", "me", "te", "se", "mi", "tu", "su", "es", "hay",
  "tienen", "tiene", "tienes", "venden", "vende", "precio", "precios", "valor", "cuanto", "cuesta",
  "vale", "quiero", "quisiera", "busco", "necesito", "info", "informacion", "hola", "buenas", "buenos",
  "dias", "tardes", "noches", "gracias", "favor", "porfa", "porfavor", "si", "no", "ok", "bien",
  "combo", "combos", "nuevo", "nueva",
  // Lo que describe el NEGOCIO de la clienta, no un producto: "algo para mi spa" no pide la camilla
  // "para spa en madera".
  "spa", "salon", "belleza", "estetica", "peluqueria", "barberia", "negocio", "local", "mueble",
  "muebles", "mobiliario", "algo", "interesa",
]);

function palabras(texto: string): string[] {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(" ")
    .filter((palabra) => palabra.length >= 3 && !RELLENO.has(palabra))
    // "lavacabezas" y "lavacabeza", "sillas" y "silla": se comparan sin el plural.
    .map((palabra) => palabra.replace(/(es|s)$/, ""));
}

export type Coincidencia =
  | { tipo: "uno"; producto: ProductoDelCatalogoV3 }
  | { tipo: "varios"; productos: ProductoDelCatalogoV3[]; total: number }
  | null;

/**
 * ¿La clienta nombró un producto del catálogo?
 *
 * El código exacto (CMB05, LCF16) gana siempre. Si no, se cuentan las palabras del nombre que
 * aparecen en el mensaje y se quedan los que más tienen. Uno solo: se responde con ese. Varios: se
 * le pregunta cuál, que es lo que Alex pide cuando el producto es ambiguo (no elegir uno a ciegas).
 */
export function reconocerEnElCatalogo(mensaje: string, catalogo: ProductoDelCatalogoV3[]): Coincidencia {
  const delMensaje = new Set(palabras(mensaje));
  if (delMensaje.size === 0) return null;

  const crudo = mensaje.toUpperCase().replace(/\s+/g, "");
  const porCodigo = catalogo.filter(
    (producto) => producto.codigo && producto.codigo.length >= 3 && crudo.includes(producto.codigo.toUpperCase().replace(/\s+/g, "")),
  );
  if (porCodigo.length === 1) return { tipo: "uno", producto: porCodigo[0] };

  let mejor = 0;
  let candidatos: ProductoDelCatalogoV3[] = [];
  for (const producto of catalogo) {
    const delNombre = new Set(palabras(producto.nombre));
    let puntos = 0;
    for (const palabra of delNombre) {
      if (delMensaje.has(palabra)) puntos += 1;
    }
    if (puntos === 0) continue;
    if (puntos > mejor) {
      mejor = puntos;
      candidatos = [producto];
    } else if (puntos === mejor) {
      candidatos.push(producto);
    }
  }
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return { tipo: "uno", producto: candidatos[0] };
  const ordenados = [...candidatos].sort((a, b) => a.precio - b.precio);
  return { tipo: "varios", productos: ordenados.slice(0, 5), total: candidatos.length };
}

/* ------------------------------------------------------------------ responder */

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** "LAVACABEZA FIBRA DE VIDRIO" → "Lavacabeza fibra de vidrio": Gestión guarda los nombres en mayúsculas. */
export function nombreLegible(nombre: string) {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (limpio !== limpio.toUpperCase()) return limpio;
  const minusculas = limpio.toLowerCase();
  return minusculas.charAt(0).toUpperCase() + minusculas.slice(1);
}

/** La descripción, recortada en una frase: un chat no es una ficha técnica. */
function resumen(descripcion: string | null, maximo = 350) {
  if (!descripcion) return null;
  const limpia = descripcion.replace(/\s+/g, " ").trim();
  if (limpia.length <= maximo) return limpia;
  const corte = limpia.slice(0, maximo);
  const punto = corte.lastIndexOf(". ");
  return `${punto > 120 ? corte.slice(0, punto + 1) : corte.trimEnd()}…`;
}

export function textoDeUnProducto(producto: ProductoDelCatalogoV3) {
  const lineas = [`*${nombreLegible(producto.nombre)}*${producto.codigo ? ` (${producto.codigo})` : ""}`];
  lineas.push(`💰 Precio: *${PESOS.format(producto.precio)}*`);
  // El precio al por mayor NUNCA lo da el agente (Alex, 03-10-2026): una compra por cantidad la
  // negocia una asesora. Por eso no sale aunque Gestión lo tenga (ver servicios/mayorista.ts).
  const descripcion = resumen(producto.descripcion);
  if (descripcion) lineas.push("", descripcion);
  lineas.push("", "Ya le aviso a una asesora para que te ayude con tu pedido 😊");
  return lineas.join("\n");
}

export function textoDeVariasOpciones(productos: ProductoDelCatalogoV3[], total: number) {
  const lineas = ["Tenemos estas opciones:"];
  productos.forEach((producto, indice) => {
    lineas.push(`${indice + 1}. *${nombreLegible(producto.nombre)}* — ${PESOS.format(producto.precio)}`);
  });
  if (total > productos.length) lineas.push(`…y ${total - productos.length} más.`);
  lineas.push("", "¿Cuál te interesa? Ya le aviso a una asesora para que te ayude 😊");
  return lineas.join("\n");
}
