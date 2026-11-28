/*
  Bases de datos de un Espacio (28-nov-2026): lo que lee y escribe en la base.

  Una base de datos es una tarjeta del tipo «Base de datos». El tipo se crea solo en el espacio la primera
  vez (sin estados, como un Área, y puede ir dentro de cualquier Área). Las columnas viven en
  BaseDeDatosTarjeta y las filas en FilaBaseDeDatos: ver_tablero NO las trae, así la IA no se llena de
  registros al mirar el espacio. Solo leer_base_de_datos (cuando el dueño lo pide) y la tabla de la pantalla.

  El permiso es el del espacio: quien lo ve, la edita (pantalla) y la clave del MCP ve todo el negocio.
*/

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { claveDeNombre } from "./reglas";
import {
  COLUMNAS_INICIALES,
  MAX_FILAS,
  TIPO_BASE_DE_DATOS,
  agregarColumna,
  cambiarTipoDeColumna,
  columnasConOpcionesNuevas,
  duplicarColumna,
  esTipoBaseDeDatos,
  ordenConDuplicadas,
  ordenConInsercion,
  ordenMovido,
  leerColumnas,
  leerValores,
  quitarColumna,
  renombrarColumna,
  valoresParaGuardar,
  type ColumnaDeBase,
  type TipoDeColumna,
  type ValoresDeFila,
} from "./reglas-base-de-datos";
import { crearTarjeta, dondeTablero, tableroDelNegocio, type Alcance, type ContextoTablero } from "./tableros";

export type FilaDeBaseVista = { id: string; numero: number; valores: ValoresDeFila };
export type BaseDeDatosVista = {
  tarjetaId: string;
  titulo: string;
  tableroId: string;
  columnas: ColumnaDeBase[];
  filas: FilaDeBaseVista[];
  total: number;
};

const COLOR_BASE_DE_DATOS = "#0ea5e9";

/** El tipo «Base de datos» del espacio; si no existe, lo crea (puede ir dentro de cualquier carpeta, como Área). */
async function asegurarTipo(tableroId: string): Promise<{ id: string }> {
  const tipos = await prisma.tipoTarjeta.findMany({
    where: { tableroId },
    select: { id: true, nombre: true, usaEstados: true, orden: true },
  });
  const existente = tipos.find((tipo) => esTipoBaseDeDatos(tipo.nombre));
  if (existente) return existente;
  const carpetas = tipos.filter((tipo) => !tipo.usaEstados);
  try {
    return await prisma.$transaction(async (tx) => {
      const tipo = await tx.tipoTarjeta.create({
        data: {
          tableroId,
          nombre: TIPO_BASE_DE_DATOS,
          color: COLOR_BASE_DE_DATOS,
          icono: "base-de-datos",
          requiereAprobacion: false,
          usaEstados: false,
          orden: tipos.reduce((tope, otro) => Math.max(tope, otro.orden), 0) + 1,
        },
        select: { id: true },
      });
      if (carpetas.length) {
        await tx.tipoTarjetaPadre.createMany({
          data: carpetas.map((carpeta) => ({ tipoId: tipo.id, tipoPadreId: carpeta.id })),
          skipDuplicates: true,
        });
      }
      await tx.tableroInteligente.update({ where: { id: tableroId }, data: { actualizadoEn: new Date() } });
      return tipo;
    });
  } catch (fallo) {
    // Dos al mismo tiempo: el otro ya lo creó.
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === "P2002") {
      const otro = await prisma.tipoTarjeta.findFirst({
        where: { tableroId, nombre: { equals: TIPO_BASE_DE_DATOS, mode: "insensitive" } },
        select: { id: true },
      });
      if (otro) return otro;
    }
    throw fallo;
  }
}

/** Crea la tarjeta «Base de datos» (con # y dos columnas de texto) en el espacio, dentro de padreId si viene. */
export async function crearBaseDeDatos(
  contexto: ContextoTablero,
  datos: { tableroId: unknown; titulo: unknown; padreId?: unknown },
): Promise<{ tarjetaId: string }> {
  const tablero = await tableroDelNegocio(contexto, datos.tableroId);
  const tipo = await asegurarTipo(tablero.id);
  const creada = await crearTarjeta(contexto, {
    tableroId: tablero.id,
    titulo: datos.titulo,
    tipo: tipo.id,
    padreId: datos.padreId ?? undefined,
  });
  await prisma.baseDeDatosTarjeta.create({
    data: { tarjetaId: creada.tarjeta.id, columnas: COLUMNAS_INICIALES },
  });
  return { tarjetaId: creada.tarjeta.id };
}

/** La tarjeta, si es una base de datos viva que la persona alcanza; si le falta su fila de columnas, la crea. */
async function baseDeLaTarjeta(alcance: Alcance, tarjetaId: unknown) {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, borradoEn: null, tablero: dondeTablero(alcance) },
        select: { id: true, titulo: true, tableroId: true, tipo: { select: { nombre: true } } },
      })
    : null;
  if (!tarjeta) throw new Error("No existe esa base de datos en este negocio (o está borrada). Ver ver_tablero para los ids.");
  if (!esTipoBaseDeDatos(tarjeta.tipo.nombre)) {
    throw new Error(`«${tarjeta.titulo}» no es una base de datos: es una tarjeta de tipo ${tarjeta.tipo.nombre}.`);
  }
  const base = await prisma.baseDeDatosTarjeta.upsert({
    where: { tarjetaId: tarjeta.id },
    create: { tarjetaId: tarjeta.id, columnas: COLUMNAS_INICIALES },
    update: {},
    select: { columnas: true },
  });
  return { tarjeta, columnas: leerColumnas(base.columnas) };
}

/** Las columnas y las filas (las más viejas primero). `limite` corta las filas; `total` dice cuántas hay. */
export async function leerBaseDeDatos(
  alcance: Alcance,
  tarjetaId: unknown,
  opciones: { limite?: number } = {},
): Promise<BaseDeDatosVista> {
  const { tarjeta, columnas } = await baseDeLaTarjeta(alcance, tarjetaId);
  const limite = Math.min(Math.max(Math.trunc(opciones.limite ?? MAX_FILAS), 1), MAX_FILAS);
  const [filas, total] = await Promise.all([
    prisma.filaBaseDeDatos.findMany({
      where: { baseId: tarjeta.id },
      orderBy: { numero: "asc" },
      take: limite,
      select: { id: true, numero: true, valores: true },
    }),
    prisma.filaBaseDeDatos.count({ where: { baseId: tarjeta.id } }),
  ]);
  return {
    tarjetaId: tarjeta.id,
    titulo: tarjeta.titulo,
    tableroId: tarjeta.tableroId,
    columnas,
    filas: filas.map((fila) => ({ id: fila.id, numero: fila.numero, valores: leerValores(fila.valores) })),
    total,
  };
}

async function guardarColumnas(tarjetaId: string, columnas: ColumnaDeBase[]) {
  await prisma.baseDeDatosTarjeta.update({ where: { tarjetaId }, data: { columnas } });
}

/** Agrega una columna; `posicion` es su lugar (0 = primera; sin ella, al final). */
export async function agregarColumnaABase(
  alcance: Alcance,
  tarjetaId: unknown,
  nombre: unknown,
  opciones: { posicion?: number; tipo?: TipoDeColumna } = {},
): Promise<{ nueva: ColumnaDeBase; columnas: ColumnaDeBase[] }> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const { columnas, nueva } = agregarColumna(base.columnas, nombre, opciones);
  await guardarColumnas(base.tarjeta.id, columnas);
  return { nueva, columnas };
}

/** Una copia de la columna, a su derecha, con los mismos datos en cada fila. */
export async function duplicarColumnaDeBase(
  alcance: Alcance,
  tarjetaId: unknown,
  columnaId: string,
): Promise<{ nueva: ColumnaDeBase; columnas: ColumnaDeBase[] }> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const { columnas, nueva } = duplicarColumna(base.columnas, columnaId);
  await prisma.$transaction([
    prisma.baseDeDatosTarjeta.update({ where: { tarjetaId: base.tarjeta.id }, data: { columnas } }),
    prisma.$executeRaw`UPDATE "FilaBaseDeDatos" SET "valores" = "valores" || jsonb_build_object(${nueva.id}::text, "valores" -> ${columnaId}::text), "actualizadoEn" = now() WHERE "baseId" = ${base.tarjeta.id} AND ("valores" ->> ${columnaId}::text) IS NOT NULL`,
  ]);
  return { nueva, columnas };
}

/** Cambia el tipo de la columna sin tocar lo escrito; al pasar a lista, sus opciones salen de lo que ya hay. */
export async function cambiarTipoDeColumnaDeBase(
  alcance: Alcance,
  tarjetaId: unknown,
  columnaId: string,
  tipo: unknown,
): Promise<ColumnaDeBase[]> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const existentes =
    tipo === "lista"
      ? (
          await prisma.filaBaseDeDatos.findMany({
            where: { baseId: base.tarjeta.id },
            orderBy: { numero: "asc" },
            select: { valores: true },
          })
        ).map((fila) => leerValores(fila.valores)[columnaId] ?? "")
      : [];
  const columnas = cambiarTipoDeColumna(base.columnas, columnaId, tipo, existentes);
  await guardarColumnas(base.tarjeta.id, columnas);
  return columnas;
}

export async function renombrarColumnaDeBase(alcance: Alcance, tarjetaId: unknown, columnaId: string, nombre: unknown) {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  await guardarColumnas(base.tarjeta.id, renombrarColumna(base.columnas, columnaId, nombre));
}

/** Quita la columna y borra sus valores de todas las filas (así su id se puede volver a usar sin revivir datos). */
export async function quitarColumnaDeBase(alcance: Alcance, tarjetaId: unknown, columnaId: string) {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const columnas = quitarColumna(base.columnas, columnaId);
  await prisma.$transaction([
    prisma.baseDeDatosTarjeta.update({ where: { tarjetaId: base.tarjeta.id }, data: { columnas } }),
    prisma.$executeRaw`UPDATE "FilaBaseDeDatos" SET "valores" = "valores" - ${columnaId}::text, "actualizadoEn" = now() WHERE "baseId" = ${base.tarjeta.id}`,
  ]);
}

type Tx = Prisma.TransactionClient;

/** Bloquea la base (dos cambios a la vez no se pisan el orden) y devuelve los ids de las filas de arriba a abajo. */
async function filasEnOrden(tx: Tx, baseId: string): Promise<string[]> {
  await tx.$queryRaw`SELECT 1 FROM "BaseDeDatosTarjeta" WHERE "tarjetaId" = ${baseId} FOR UPDATE`;
  const filas = await tx.filaBaseDeDatos.findMany({ where: { baseId }, orderBy: { numero: "asc" }, select: { id: true } });
  return filas.map((fila) => fila.id);
}

/**
 * Deja el # de cada fila igual a su posición en `ids` (1, 2, 3...). En dos pasos (primero en negativo) para
 * no chocar con el único (base, numero) mientras se mueven.
 */
async function renumerar(tx: Tx, baseId: string, ids: string[]) {
  if (ids.length) {
    const posiciones = ids.map((_, indice) => indice + 1);
    await tx.$executeRaw`UPDATE "FilaBaseDeDatos" AS f SET "numero" = -t.pos FROM unnest(${ids}::text[], ${posiciones}::int[]) AS t(id, pos) WHERE f."id" = t.id AND f."baseId" = ${baseId}`;
    await tx.$executeRaw`UPDATE "FilaBaseDeDatos" SET "numero" = -"numero" WHERE "baseId" = ${baseId} AND "numero" < 0`;
  }
  await tx.baseDeDatosTarjeta.update({ where: { tarjetaId: baseId }, data: { siguienteNumero: ids.length + 1 } });
}

/** Crea filas con un # provisional (negativo y lejos de los de renumerar) hasta que se renumere. */
async function crearProvisionales(tx: Tx, baseId: string, valores: ValoresDeFila[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [indice, fila] of valores.entries()) {
    const creada = await tx.filaBaseDeDatos.create({
      data: { baseId, numero: -1_000_000 - indice, valores: fila },
      select: { id: true },
    });
    ids.push(creada.id);
  }
  return ids;
}

/**
 * Agrega filas al final, o justo debajo de `despuesDe` (el id de una fila). El # es la posición: las de
 * abajo se corren.
 */
export async function agregarFilas(
  alcance: Alcance,
  tarjetaId: unknown,
  entradas: unknown[],
  opciones: { despuesDe?: string | null } = {},
): Promise<FilaDeBaseVista[]> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  if (!Array.isArray(entradas) || entradas.length === 0) throw new Error("No hay filas para agregar.");
  if (entradas.length > 500) throw new Error("Se pueden agregar hasta 500 filas de una vez.");
  const valores = entradas.map((entrada) => valoresParaGuardar(base.columnas, entrada ?? {}));
  return prisma.$transaction(async (tx) => {
    const ids = await filasEnOrden(tx, base.tarjeta.id);
    if (ids.length + valores.length > MAX_FILAS) {
      throw new Error(`Una base de datos puede tener hasta ${MAX_FILAS} filas (tiene ${ids.length}).`);
    }
    const conOpciones = columnasConOpcionesNuevas(base.columnas, valores);
    if (conOpciones) {
      await tx.baseDeDatosTarjeta.update({ where: { tarjetaId: base.tarjeta.id }, data: { columnas: conOpciones } });
    }
    const nuevas = await crearProvisionales(tx, base.tarjeta.id, valores);
    const orden = ordenConInsercion(ids, nuevas, opciones.despuesDe ?? null);
    await renumerar(tx, base.tarjeta.id, orden);
    return nuevas.map((id, indice) => ({ id, numero: orden.indexOf(id) + 1, valores: valores[indice] }));
  });
}

async function filaDeLaBase(baseId: string, fila: { id?: unknown; numero?: unknown }) {
  const where =
    typeof fila.id === "string" && fila.id
      ? { id: fila.id, baseId }
      : typeof fila.numero === "number" && Number.isInteger(fila.numero)
        ? { baseId, numero: fila.numero }
        : null;
  if (!where) throw new Error("La fila va por su número (#) o su id.");
  const encontrada = await prisma.filaBaseDeDatos.findFirst({ where, select: { id: true, numero: true, valores: true } });
  if (!encontrada) throw new Error("Esa fila ya no existe en la base de datos.");
  return encontrada;
}

/** Cambia algunas celdas de una fila; las que no vienen quedan como estaban. */
export async function editarFila(
  alcance: Alcance,
  tarjetaId: unknown,
  fila: { id?: unknown; numero?: unknown },
  cambios: unknown,
): Promise<FilaDeBaseVista & { columnas?: ColumnaDeBase[] }> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const actual = await filaDeLaBase(base.tarjeta.id, fila);
  const valores = { ...leerValores(actual.valores), ...valoresParaGuardar(base.columnas, cambios) };
  const conOpciones = columnasConOpcionesNuevas(base.columnas, [valores]);
  await prisma.$transaction([
    prisma.filaBaseDeDatos.update({ where: { id: actual.id }, data: { valores } }),
    ...(conOpciones ? [prisma.baseDeDatosTarjeta.update({ where: { tarjetaId: base.tarjeta.id }, data: { columnas: conOpciones } })] : []),
  ]);
  return { id: actual.id, numero: actual.numero, valores, ...(conOpciones ? { columnas: conOpciones } : {}) };
}

function idsPedidos(filaIds: unknown): string[] {
  const ids = Array.isArray(filaIds) ? [...new Set(filaIds.filter((id): id is string => typeof id === "string" && id !== ""))] : [];
  if (!ids.length) throw new Error("No hay filas elegidas.");
  if (ids.length > 500) throw new Error("Se pueden tocar hasta 500 filas de una vez.");
  return ids;
}

/** Borra filas (por id) y renumera las que quedan. */
export async function borrarFilas(alcance: Alcance, tarjetaId: unknown, filaIds: unknown): Promise<{ borradas: number }> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const pedidas = idsPedidos(filaIds);
  return prisma.$transaction(async (tx) => {
    const ids = await filasEnOrden(tx, base.tarjeta.id);
    const borrar = new Set(pedidas.filter((id) => ids.includes(id)));
    if (!borrar.size) throw new Error("Esas filas ya no existen en la base de datos.");
    await tx.filaBaseDeDatos.deleteMany({ where: { baseId: base.tarjeta.id, id: { in: [...borrar] } } });
    await renumerar(tx, base.tarjeta.id, ids.filter((id) => !borrar.has(id)));
    return { borradas: borrar.size };
  });
}

/** Una copia de cada fila, justo debajo de su original. */
export async function duplicarFilas(alcance: Alcance, tarjetaId: unknown, filaIds: unknown): Promise<{ copias: number }> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const pedidas = idsPedidos(filaIds);
  return prisma.$transaction(async (tx) => {
    const ids = await filasEnOrden(tx, base.tarjeta.id);
    const originales = await tx.filaBaseDeDatos.findMany({
      where: { baseId: base.tarjeta.id, id: { in: pedidas } },
      orderBy: { numero: "asc" },
      select: { id: true, valores: true },
    });
    if (!originales.length) throw new Error("Esas filas ya no existen en la base de datos.");
    if (ids.length + originales.length > MAX_FILAS) {
      throw new Error(`Una base de datos puede tener hasta ${MAX_FILAS} filas (tiene ${ids.length}).`);
    }
    const nuevas = await crearProvisionales(tx, base.tarjeta.id, originales.map((fila) => leerValores(fila.valores)));
    const copias = new Map(originales.map((fila, indice) => [fila.id, nuevas[indice]]));
    await renumerar(tx, base.tarjeta.id, ordenConDuplicadas(ids, copias));
    return { copias: nuevas.length };
  });
}

/** Lleva una fila antes o después de otra (arrastrar) y renumera. */
export async function moverFila(
  alcance: Alcance,
  tarjetaId: unknown,
  filaId: string,
  destinoId: string,
  lado: "antes" | "despues",
): Promise<void> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  await prisma.$transaction(async (tx) => {
    const ids = await filasEnOrden(tx, base.tarjeta.id);
    if (!ids.includes(filaId) || !ids.includes(destinoId)) throw new Error("Esa fila ya no existe en la base de datos.");
    await renumerar(tx, base.tarjeta.id, ordenMovido(ids, filaId, destinoId, lado === "antes" ? "antes" : "despues"));
  });
}

/** Las bases de datos de un espacio: nombre y cuántas filas (sin el contenido). Para que la IA sepa cuáles hay. */
export async function basesDelEspacio(alcance: Alcance, tableroId: unknown) {
  const tablero = await tableroDelNegocio(alcance, tableroId);
  const tarjetas = await prisma.tarjetaTablero.findMany({
    where: { tableroId: tablero.id, borradoEn: null, archivadaEn: null },
    select: { id: true, titulo: true, tipo: { select: { nombre: true } }, baseDeDatos: { select: { _count: { select: { filas: true } } } } },
  });
  return tarjetas
    .filter((tarjeta) => claveDeNombre(tarjeta.tipo.nombre) === claveDeNombre(TIPO_BASE_DE_DATOS))
    .map((tarjeta) => ({ tarjetaId: tarjeta.id, titulo: tarjeta.titulo, filas: tarjeta.baseDeDatos?._count.filas ?? 0 }));
}
