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
  esTipoBaseDeDatos,
  leerColumnas,
  leerValores,
  quitarColumna,
  renombrarColumna,
  valoresParaGuardar,
  type ColumnaDeBase,
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

export async function agregarColumnaABase(alcance: Alcance, tarjetaId: unknown, nombre: unknown): Promise<ColumnaDeBase> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const { columnas, nueva } = agregarColumna(base.columnas, nombre);
  await guardarColumnas(base.tarjeta.id, columnas);
  return nueva;
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
    prisma.$executeRaw`UPDATE "FilaBaseDeDatos" SET "valores" = "valores" - ${columnaId}, "actualizadoEn" = now() WHERE "baseId" = ${base.tarjeta.id}`,
  ]);
}

/** Agrega filas al final: cada una lleva el número siguiente (1, 2, 3...), que no se reusa. */
export async function agregarFilas(alcance: Alcance, tarjetaId: unknown, entradas: unknown[]): Promise<FilaDeBaseVista[]> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  if (!Array.isArray(entradas) || entradas.length === 0) throw new Error("No hay filas para agregar.");
  if (entradas.length > 500) throw new Error("Se pueden agregar hasta 500 filas de una vez.");
  const valores = entradas.map((entrada) => valoresParaGuardar(base.columnas, entrada ?? {}));
  return prisma.$transaction(async (tx) => {
    const hay = await tx.filaBaseDeDatos.count({ where: { baseId: base.tarjeta.id } });
    if (hay + valores.length > MAX_FILAS) {
      throw new Error(`Una base de datos puede tener hasta ${MAX_FILAS} filas (tiene ${hay}).`);
    }
    // El update bloquea la fila de la base: dos que agregan al mismo tiempo no repiten número.
    const { siguienteNumero } = await tx.baseDeDatosTarjeta.update({
      where: { tarjetaId: base.tarjeta.id },
      data: { siguienteNumero: { increment: valores.length } },
      select: { siguienteNumero: true },
    });
    const primero = siguienteNumero - valores.length;
    const creadas: FilaDeBaseVista[] = [];
    for (const [indice, fila] of valores.entries()) {
      const creada = await tx.filaBaseDeDatos.create({
        data: { baseId: base.tarjeta.id, numero: primero + indice, valores: fila },
        select: { id: true, numero: true },
      });
      creadas.push({ ...creada, valores: fila });
    }
    return creadas;
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
): Promise<FilaDeBaseVista> {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const actual = await filaDeLaBase(base.tarjeta.id, fila);
  const valores = { ...leerValores(actual.valores), ...valoresParaGuardar(base.columnas, cambios) };
  await prisma.filaBaseDeDatos.update({ where: { id: actual.id }, data: { valores } });
  return { id: actual.id, numero: actual.numero, valores };
}

export async function borrarFila(alcance: Alcance, tarjetaId: unknown, fila: { id?: unknown; numero?: unknown }) {
  const base = await baseDeLaTarjeta(alcance, tarjetaId);
  const actual = await filaDeLaBase(base.tarjeta.id, fila);
  await prisma.filaBaseDeDatos.delete({ where: { id: actual.id } });
  return { numero: actual.numero };
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
