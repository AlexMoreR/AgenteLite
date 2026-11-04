import { createHash } from "node:crypto";

/*
  Carta de colores digital (parte 1 de «Carta de colores digital dentro del CRM»).

  Solo reglas puras: sin Prisma ni Next. La pantalla, el armado de las imágenes y el botón del chat
  vienen en las partes siguientes y usan estas funciones. Los modelos están en prisma/schema.prisma
  (MaterialDeColores y ColorDeCarta).
*/

export type TipoMaterialDeColor = "CUERO" | "TELA";

export type MaterialBase = {
  nombre: string;
  tipo: TipoMaterialDeColor;
  orden: number;
};

/** Los materiales con los que arranca la carta de cada negocio. NO traen colores: los carga el equipo. */
export const MATERIALES_BASE: readonly MaterialBase[] = Object.freeze([
  { nombre: "Cuerotex", tipo: "CUERO", orden: 0 },
  { nombre: "Prana", tipo: "CUERO", orden: 1 },
  { nombre: "Corsos", tipo: "CUERO", orden: 2 },
  { nombre: "Telas", tipo: "TELA", orden: 3 },
]);

/** Cuántos colores van en cada imagen de la carta. */
export const COLORES_POR_IMAGEN = 12;

/** Texto que acompaña a la carta cuando se manda en el chat. */
export const TEXTO_CARTA_DE_COLORES = "Escríbeme el código del color que te gustó 😊";

/** Largo máximo del código de un color (lo que el cliente escribe en el chat). */
export const LARGO_MAXIMO_CODIGO = 20;

export type ColorParaCarta = {
  id: string;
  codigo: string;
  nombre: string;
  fotoUrl: string | null;
  oculto: boolean;
  orden: number;
};

/** Compara códigos como los lee una persona: "2" va antes que "10". */
function compararCodigos(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

/** Los colores que salen en la carta: sin los ocultos, por orden y luego por código. */
export function coloresVisibles<T extends ColorParaCarta>(colores: readonly T[]): T[] {
  return colores
    .filter((color) => !color.oculto)
    .sort((a, b) => a.orden - b.orden || compararCodigos(a.codigo, b.codigo));
}

/** Parte la carta en páginas de 12 colores (una imagen por página). Sin colores visibles, no hay páginas. */
export function partirEnPaginas<T extends ColorParaCarta>(colores: readonly T[]): T[][] {
  const visibles = coloresVisibles(colores);
  const paginas: T[][] = [];
  for (let inicio = 0; inicio < visibles.length; inicio += COLORES_POR_IMAGEN) {
    paginas.push(visibles.slice(inicio, inicio + COLORES_POR_IMAGEN));
  }
  return paginas;
}

/** Deja el código como se guarda: sin espacios al principio ni al final, y los de adentro, uno solo. */
export function normalizarCodigo(codigo: string): string {
  return String(codigo ?? "").trim().replace(/\s+/g, " ");
}

export type CodigoValidado = { ok: true; codigo: string } | { ok: false; error: string };

/** Revisa el código antes de guardarlo. Devuelve el código ya normalizado o el motivo, en español sencillo. */
export function validarCodigo(codigo: string): CodigoValidado {
  const limpio = normalizarCodigo(codigo);
  if (!limpio) return { ok: false, error: "Escribe el código del color." };
  if (limpio.length > LARGO_MAXIMO_CODIGO) {
    return { ok: false, error: `El código puede tener máximo ${LARGO_MAXIMO_CODIGO} caracteres.` };
  }
  return { ok: true, codigo: limpio };
}

/**
  ¿Ya hay otro color con ese código en el mismo material? Se compara sin importar mayúsculas ni espacios
  de más. idActual es el color que se está editando (no cuenta como repetido consigo mismo).
*/
export function codigoRepetido(
  colores: readonly Pick<ColorParaCarta, "id" | "codigo">[],
  codigo: string,
  idActual?: string,
): boolean {
  const buscado = normalizarCodigo(codigo).toLocaleLowerCase("es");
  if (!buscado) return false;
  return colores.some(
    (color) => color.id !== idActual && normalizarCodigo(color.codigo).toLocaleLowerCase("es") === buscado,
  );
}

/**
  Huella corta de lo que sale en la carta de un material (id, código, nombre, foto y orden de los colores
  visibles, en el orden en que salen). Va en el nombre del archivo de las imágenes: si algo cambia, cambia
  la huella y las imágenes se arman de nuevo.
*/
export function huellaDeMaterial(colores: readonly ColorParaCarta[]): string {
  const datos = coloresVisibles(colores).map((color) => [
    color.id,
    color.codigo,
    color.nombre,
    color.fotoUrl ?? "",
    color.orden,
  ]);
  return createHash("sha256").update(JSON.stringify(datos)).digest("hex").slice(0, 12);
}
