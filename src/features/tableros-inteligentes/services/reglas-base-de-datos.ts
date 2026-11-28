/*
  Bases de datos de un Espacio (28-nov-2026, pedido de Alex): reglas puras de columnas y celdas.

  Una base de datos es una tarjeta del tipo «Base de datos» (se crea solo en el espacio la primera vez).
  La columna # (el índice) no se guarda como columna: es el número de la fila, que se pone solo y no se
  reusa. Nace con # y dos columnas de texto.

  Cada columna tiene un tipo (como en Notion): texto, número, fecha (AAAA-MM-DD) o lista de opciones. Todo
  se guarda como texto; el tipo decide qué se acepta al escribir y cómo se ordena. Cambiar el tipo NO
  borra lo que ya hay: lo que no calza se ve marcado hasta que se corrija. Una lista suma sola las
  opciones nuevas que se escriban.

  La IA no la lee al mirar el espacio: solo con leer_base_de_datos, cuando el dueño se lo pide.
*/

import { claveDeNombre } from "./reglas";

export const TIPO_BASE_DE_DATOS = "Base de datos";
export const MAX_COLUMNAS = 30;
export const MAX_NOMBRE_COLUMNA = 60;
export const MAX_TEXTO_CELDA = 2000;
export const MAX_FILAS = 5000;
export const MAX_OPCIONES = 100;

export const TIPOS_DE_COLUMNA = ["texto", "numero", "fecha", "lista"] as const;
export type TipoDeColumna = (typeof TIPOS_DE_COLUMNA)[number];
export const NOMBRE_DEL_TIPO_DE_COLUMNA: Record<TipoDeColumna, string> = {
  texto: "Texto",
  numero: "Número",
  fecha: "Fecha",
  lista: "Lista de opciones",
};

export type ColumnaDeBase = { id: string; nombre: string; tipo: TipoDeColumna; opciones?: string[] };
export type ValoresDeFila = Record<string, string>;

export const COLUMNAS_INICIALES: ColumnaDeBase[] = [
  { id: "c1", nombre: "Columna 1", tipo: "texto" },
  { id: "c2", nombre: "Columna 2", tipo: "texto" },
];

export function esTipoBaseDeDatos(nombre: string | null | undefined): boolean {
  return typeof nombre === "string" && claveDeNombre(nombre) === claveDeNombre(TIPO_BASE_DE_DATOS);
}

export function esTipoDeColumna(valor: unknown): valor is TipoDeColumna {
  return typeof valor === "string" && (TIPOS_DE_COLUMNA as readonly string[]).includes(valor);
}

/** Las columnas guardadas (JSON), sin nada raro. Las de antes del tipo (28-nov-2026) son de texto. */
export function leerColumnas(guardadas: unknown): ColumnaDeBase[] {
  if (!Array.isArray(guardadas)) return [];
  const vistas = new Set<string>();
  const columnas: ColumnaDeBase[] = [];
  for (const columna of guardadas) {
    if (!columna || typeof columna !== "object") continue;
    const { id, nombre, tipo, opciones } = columna as { id?: unknown; nombre?: unknown; tipo?: unknown; opciones?: unknown };
    if (typeof id !== "string" || !id || vistas.has(id) || typeof nombre !== "string") continue;
    vistas.add(id);
    const tipoBueno = esTipoDeColumna(tipo) ? tipo : "texto";
    columnas.push({
      id,
      nombre,
      tipo: tipoBueno,
      ...(tipoBueno === "lista"
        ? { opciones: Array.isArray(opciones) ? opciones.filter((opcion): opcion is string => typeof opcion === "string") : [] }
        : {}),
    });
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

function idNuevo(columnas: ColumnaDeBase[]) {
  const mayor = columnas.reduce((tope, columna) => {
    const numero = /^c(\d+)$/.exec(columna.id);
    return numero ? Math.max(tope, Number(numero[1])) : tope;
  }, 0);
  return `c${mayor + 1}`;
}

/** Un nombre que no está: «Columna 3», o «Nombre (copia)», «Nombre (copia 2)»... */
export function nombreLibre(columnas: ColumnaDeBase[], base?: string): string {
  const usados = new Set(columnas.map((columna) => claveDeNombre(columna.nombre)));
  if (base) {
    for (let vez = 1; ; vez += 1) {
      const nombre = `${base} (copia${vez > 1 ? ` ${vez}` : ""})`.slice(0, MAX_NOMBRE_COLUMNA);
      if (!usados.has(claveDeNombre(nombre))) return nombre;
    }
  }
  for (let numero = columnas.length + 1; ; numero += 1) {
    if (!usados.has(claveDeNombre(`Columna ${numero}`))) return `Columna ${numero}`;
  }
}

/** Agrega una columna; `posicion` es el lugar (0 = primera); sin ella va al final. */
export function agregarColumna(
  columnas: ColumnaDeBase[],
  pedido: unknown,
  opciones: { posicion?: number; tipo?: TipoDeColumna } = {},
): { columnas: ColumnaDeBase[]; nueva: ColumnaDeBase } {
  if (columnas.length >= MAX_COLUMNAS) throw new Error(`Una base de datos puede tener hasta ${MAX_COLUMNAS} columnas.`);
  const nombre = nombreDeColumna(pedido);
  revisarRepetida(columnas, nombre, null);
  const tipo = opciones.tipo ?? "texto";
  const nueva: ColumnaDeBase = { id: idNuevo(columnas), nombre, tipo, ...(tipo === "lista" ? { opciones: [] } : {}) };
  const lugar =
    typeof opciones.posicion === "number" && Number.isInteger(opciones.posicion)
      ? Math.min(Math.max(opciones.posicion, 0), columnas.length)
      : columnas.length;
  return { columnas: [...columnas.slice(0, lugar), nueva, ...columnas.slice(lugar)], nueva };
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

/** Una copia de la columna (mismo tipo y opciones), justo a su derecha. Los datos los copia el servicio. */
export function duplicarColumna(columnas: ColumnaDeBase[], id: string): { columnas: ColumnaDeBase[]; nueva: ColumnaDeBase } {
  const indice = columnas.findIndex((columna) => columna.id === id);
  if (indice < 0) throw new Error("Esa columna ya no existe.");
  if (columnas.length >= MAX_COLUMNAS) throw new Error(`Una base de datos puede tener hasta ${MAX_COLUMNAS} columnas.`);
  const original = columnas[indice];
  const nueva: ColumnaDeBase = {
    ...original,
    id: idNuevo(columnas),
    nombre: nombreLibre(columnas, original.nombre),
    ...(original.opciones ? { opciones: [...original.opciones] } : {}),
  };
  return { columnas: [...columnas.slice(0, indice + 1), nueva, ...columnas.slice(indice + 1)], nueva };
}

/**
 * Cambia el tipo de una columna. Lo que ya está escrito no se toca. Al pasar a lista, sus opciones son
 * los textos distintos que ya tiene (`existentes`, en el orden en que aparecen).
 */
export function cambiarTipoDeColumna(
  columnas: ColumnaDeBase[],
  id: string,
  tipo: unknown,
  existentes: readonly string[] = [],
): ColumnaDeBase[] {
  if (!esTipoDeColumna(tipo)) throw new Error("El tipo de columna es texto, numero, fecha o lista.");
  if (!columnas.some((columna) => columna.id === id)) throw new Error("Esa columna ya no existe.");
  return columnas.map((columna) => {
    if (columna.id !== id) return columna;
    const { opciones: _sinOpciones, ...resto } = columna;
    void _sinOpciones;
    if (tipo !== "lista") return { ...resto, tipo };
    const opciones = [...new Set(existentes.map((texto) => texto.trim()).filter(Boolean))].slice(0, MAX_OPCIONES);
    return { ...resto, tipo, opciones: columna.tipo === "lista" ? (columna.opciones ?? opciones) : opciones };
  });
}

/** El número escrito, como texto normalizado ("1500", "-2.5"); acepta coma o punto decimal. null si no es número. */
export function numeroNormalizado(texto: string): string | null {
  const limpio = texto.trim().replace(/\s/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(limpio)) return null;
  return String(Number(limpio.replace(",", ".")));
}

/** La fecha escrita como AAAA-MM-DD; acepta también DD/MM/AAAA. null si no es una fecha real. */
export function fechaNormalizada(texto: string): string | null {
  const limpio = texto.trim();
  let anio: number, mes: number, dia: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(limpio);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(limpio);
  if (iso) [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) [dia, mes, anio] = [Number(local[1]), Number(local[2]), Number(local[3])];
  else return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Si lo guardado calza con el tipo de la columna (lo vacío siempre calza). Para marcar lo que no. */
export function calzaConElTipo(columna: ColumnaDeBase, texto: string): boolean {
  if (!texto) return true;
  if (columna.tipo === "numero") return numeroNormalizado(texto) === texto;
  if (columna.tipo === "fecha") return fechaNormalizada(texto) === texto;
  return true;
}

/** Lo que se guarda en una celda según el tipo de la columna; error si no calza. */
export function textoDeCelda(columna: ColumnaDeBase, valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  if (texto.length > MAX_TEXTO_CELDA) throw new Error(`Una celda puede tener hasta ${MAX_TEXTO_CELDA} letras.`);
  if (!texto.trim()) return "";
  if (columna.tipo === "numero") {
    const numero = numeroNormalizado(texto);
    if (numero === null) throw new Error(`«${texto}» no es un número (columna ${columna.nombre}).`);
    return numero;
  }
  if (columna.tipo === "fecha") {
    const fecha = fechaNormalizada(texto);
    if (fecha === null) throw new Error(`«${texto}» no es una fecha (columna ${columna.nombre}): va como AAAA-MM-DD o DD/MM/AAAA.`);
    return fecha;
  }
  return columna.tipo === "lista" ? texto.trim() : texto;
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
    valores[columna.id] = textoDeCelda(columna, valor);
  }
  return valores;
}

/** Las columnas con las opciones nuevas que traen estos valores (las listas suman solas lo que se escribe). null si no cambia nada. */
export function columnasConOpcionesNuevas(columnas: ColumnaDeBase[], filas: readonly ValoresDeFila[]): ColumnaDeBase[] | null {
  let cambio = false;
  const nuevas = columnas.map((columna) => {
    if (columna.tipo !== "lista") return columna;
    const opciones = [...(columna.opciones ?? [])];
    for (const fila of filas) {
      const texto = fila[columna.id];
      if (texto && !opciones.includes(texto) && opciones.length < MAX_OPCIONES) {
        opciones.push(texto);
        cambio = true;
      }
    }
    return opciones.length === (columna.opciones ?? []).length ? columna : { ...columna, opciones };
  });
  return cambio ? nuevas : null;
}

/** Para ordenar la tabla por una columna: los números como números, las fechas por fecha y lo vacío al final. */
export function compararCeldas(columna: ColumnaDeBase, a: string, b: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (columna.tipo === "numero") {
    const [x, y] = [Number(a), Number(b)];
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  }
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}
