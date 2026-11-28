/*
  Bases de datos de un Espacio (28-nov-2026, pedido de Alex): reglas puras de columnas y celdas.

  Una base de datos es una tarjeta del tipo «Base de datos» (se crea solo en el espacio la primera vez).
  Sus columnas son todas de texto; la columna # (el índice) no se guarda como columna: es el número de la
  fila, que se pone solo y no se reusa. Nace con # y dos columnas de texto.

  La IA no la lee al mirar el espacio: solo con leer_base_de_datos, cuando el dueño se lo pide.
*/

import { claveDeNombre } from "./reglas";

export const TIPO_BASE_DE_DATOS = "Base de datos";
export const MAX_COLUMNAS = 30;
export const MAX_NOMBRE_COLUMNA = 60;
export const MAX_TEXTO_CELDA = 2000;
export const MAX_FILAS = 5000;

export type ColumnaDeBase = { id: string; nombre: string };
export type ValoresDeFila = Record<string, string>;

export const COLUMNAS_INICIALES: ColumnaDeBase[] = [
  { id: "c1", nombre: "Columna 1" },
  { id: "c2", nombre: "Columna 2" },
];

export function esTipoBaseDeDatos(nombre: string | null | undefined): boolean {
  return typeof nombre === "string" && claveDeNombre(nombre) === claveDeNombre(TIPO_BASE_DE_DATOS);
}

/** Las columnas guardadas (JSON), sin nada raro: cada una con id y nombre de texto, sin ids repetidos. */
export function leerColumnas(guardadas: unknown): ColumnaDeBase[] {
  if (!Array.isArray(guardadas)) return [];
  const vistas = new Set<string>();
  const columnas: ColumnaDeBase[] = [];
  for (const columna of guardadas) {
    if (!columna || typeof columna !== "object") continue;
    const { id, nombre } = columna as { id?: unknown; nombre?: unknown };
    if (typeof id !== "string" || !id || vistas.has(id) || typeof nombre !== "string") continue;
    vistas.add(id);
    columnas.push({ id, nombre });
  }
  return columnas;
}

/** Los valores guardados de una fila (JSON): solo textos. */
export function leerValores(guardados: unknown): ValoresDeFila {
  if (!guardados || typeof guardados !== "object" || Array.isArray(guardados)) return {};
  const valores: ValoresDeFila = {};
  for (const [clave, valor] of Object.entries(guardados as Record<string, unknown>)) {
    if (typeof valor === "string") valores[clave] = valor;
  }
  return valores;
}

function nombreDeColumna(pedido: unknown): string {
  const nombre = typeof pedido === "string" ? pedido.replace(/\s+/g, " ").trim() : "";
  if (!nombre) throw new Error("La columna necesita un nombre.");
  if (nombre.length > MAX_NOMBRE_COLUMNA) throw new Error(`El nombre de la columna puede tener hasta ${MAX_NOMBRE_COLUMNA} letras.`);
  return nombre;
}

function revisarRepetida(columnas: ColumnaDeBase[], nombre: string, menos: string | null) {
  const clave = claveDeNombre(nombre);
  if (clave === "#" || columnas.some((columna) => columna.id !== menos && claveDeNombre(columna.nombre) === clave)) {
    throw new Error(`Ya hay una columna «${nombre}».`);
  }
}

export function agregarColumna(columnas: ColumnaDeBase[], pedido: unknown): { columnas: ColumnaDeBase[]; nueva: ColumnaDeBase } {
  if (columnas.length >= MAX_COLUMNAS) throw new Error(`Una base de datos puede tener hasta ${MAX_COLUMNAS} columnas.`);
  const nombre = nombreDeColumna(pedido);
  revisarRepetida(columnas, nombre, null);
  const mayor = columnas.reduce((tope, columna) => {
    const numero = /^c(\d+)$/.exec(columna.id);
    return numero ? Math.max(tope, Number(numero[1])) : tope;
  }, 0);
  const nueva = { id: `c${mayor + 1}`, nombre };
  return { columnas: [...columnas, nueva], nueva };
}

export function renombrarColumna(columnas: ColumnaDeBase[], id: string, pedido: unknown): ColumnaDeBase[] {
  if (!columnas.some((columna) => columna.id === id)) throw new Error("Esa columna ya no existe.");
  const nombre = nombreDeColumna(pedido);
  revisarRepetida(columnas, nombre, id);
  return columnas.map((columna) => (columna.id === id ? { ...columna, nombre } : columna));
}

export function quitarColumna(columnas: ColumnaDeBase[], id: string): ColumnaDeBase[] {
  if (!columnas.some((columna) => columna.id === id)) throw new Error("Esa columna ya no existe.");
  if (columnas.length <= 1) throw new Error("La base de datos tiene que quedar con al menos una columna.");
  return columnas.filter((columna) => columna.id !== id);
}

/** La columna por su id o por su nombre (sin mayúsculas ni tildes): así la IA puede usar los nombres. */
export function columnaPorClave(columnas: ColumnaDeBase[], clave: string): ColumnaDeBase | null {
  return (
    columnas.find((columna) => columna.id === clave) ??
    columnas.find((columna) => claveDeNombre(columna.nombre) === claveDeNombre(clave)) ??
    null
  );
}

/**
 * Lo que se guarda de una fila: { idColumna: texto } solo de columnas que existen. Las claves pueden ser
 * el id o el nombre de la columna. Una clave que no es columna da error (para no perder datos callado).
 */
export function valoresParaGuardar(columnas: ColumnaDeBase[], entrada: unknown): ValoresDeFila {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Cada fila va como { columna: texto }.");
  }
  const valores: ValoresDeFila = {};
  for (const [clave, valor] of Object.entries(entrada as Record<string, unknown>)) {
    const columna = columnaPorClave(columnas, clave);
    if (!columna) {
      throw new Error(`No hay una columna «${clave}». Las columnas son: ${columnas.map((c) => c.nombre).join(", ")}.`);
    }
    const texto = valor === null || valor === undefined ? "" : String(valor);
    if (texto.length > MAX_TEXTO_CELDA) throw new Error(`Una celda puede tener hasta ${MAX_TEXTO_CELDA} letras.`);
    valores[columna.id] = texto;
  }
  return valores;
}
