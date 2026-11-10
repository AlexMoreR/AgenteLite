/*
  TABLEROS ARCHIVADOS (10-nov-2026): el botón rojo "Eliminar tablero" del dueño (diálogo de "Cambiar nombre") no
  borra nada: archiva el tablero. Sin migración, la lista vive en AppSetting `tablero-ia:archivados:<workspaceId>`
  (claveDeTablerosArchivados en reglas.ts) como JSON [{ tableroId, archivadoEn, archivadoPor }], el mismo patrón de
  vistas-guardadas.ts. Las tarjetas, sus tipos y su historial no se tocan: recuperar el tablero lo deja como estaba.

  Un tablero archivado:
  - no sale en la pantalla (listarTableros, la firma de la lista, "Te toca a ti", Asignadas a mí, Trabajos
    terminados) ni en listar_tableros del MCP; abrirlo por id (ver_tablero, crear_tarjeta, listar_tipos...) dice que
    está archivado (tableros.ts: tableroDelNegocio);
  - el Coordinador no toma sus tarjetas: /tomar, /candidatas y las que esperan la pantalla filtran en SQL
    (sql-trabajador.ts: TABLERO_NO_ARCHIVADO); /errores y /por-revisar con dondeTableroVivo;
  - no cuenta en avisos ni resúmenes (avisos al dueño y al equipo, terminadas, resumen del día, Coordinador en vivo,
    aprobación automática, revisión de sistemas, que_es_esta_aplicacion).
  Lo que se sigue pudiendo: leer o editar UNA tarjeta por su id o su código (el MCP), deshacer, y las redes de
  seguridad del Coordinador (vencidas, huérfanas, arranque), que no reparten trabajo nuevo.

  Solo el dueño del negocio (isOwner) archiva y recupera; la regla está en el servidor (problemaParaArchivarTablero),
  no solo en el botón. No se archiva con tarjetas vivas aprobadas o en manos del Coordinador.
*/
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  ESTADOS_QUE_FRENAN_ARCHIVAR,
  PREFIJO_TABLEROS_ARCHIVADOS,
  SOLO_EL_DUENO_ARCHIVA,
  claveDeTablerosArchivados,
  codigoDeTarjeta,
  leerTablerosArchivados,
  problemaParaArchivarTablero,
  type EstadoTarjetaTablero,
  type TableroArchivado,
} from "./reglas";

type Db = Prisma.TransactionClient | typeof prisma;

/** Lo que hace falta para archivar o recuperar: el negocio, quién y si es el dueño del negocio. */
export type QuienArchiva = { workspaceId: string; userId: string; esDueno: boolean };

/** La lista de archivados del negocio, como está guardada. */
export async function tablerosArchivadosDe(workspaceId: string, db: Db = prisma): Promise<TableroArchivado[]> {
  const fila = await db.appSetting.findUnique({ where: { key: claveDeTablerosArchivados(workspaceId) }, select: { value: true } });
  return leerTablerosArchivados(fila?.value);
}

/** Los ids de los tableros archivados del negocio. */
export async function idsDeTablerosArchivados(workspaceId: string, db: Db = prisma): Promise<string[]> {
  return (await tablerosArchivadosDe(workspaceId, db)).map((archivado) => archivado.tableroId);
}

/** Los ids de los tableros archivados de TODOS los negocios (para los relojes que recorren todo, como la aprobación sola). */
export async function idsDeTodosLosTablerosArchivados(db: Db = prisma): Promise<string[]> {
  const filas = await db.appSetting.findMany({ where: { key: { startsWith: PREFIJO_TABLEROS_ARCHIVADOS } }, select: { value: true } });
  return filas.flatMap((fila) => leerTablerosArchivados(fila.value).map((archivado) => archivado.tableroId));
}

/**
 * El filtro de los tableros vivos (sin archivar) que alcanza la persona, para `tablero: ...` en una consulta de
 * tarjetas o para listar tableros. `soloDe` como en tableros.ts (null = todo el negocio). Para buscar UN tablero por id
 * no se mezcla con `id`: va en un AND (si no, el id pisa el notIn).
 */
export async function dondeTableroVivo(
  alcance: { workspaceId: string; soloDe?: string | null },
  db: Db = prisma,
): Promise<Prisma.TableroInteligenteWhereInput> {
  const archivados = await idsDeTablerosArchivados(alcance.workspaceId, db);
  return {
    workspaceId: alcance.workspaceId,
    ...(alcance.soloDe ? { duenoUserId: alcance.soloDe } : {}),
    ...(archivados.length ? { id: { notIn: archivados } } : {}),
  };
}

/** ¿Ese tablero está archivado? */
export async function estaArchivado(workspaceId: string, tableroId: string, db: Db = prisma): Promise<boolean> {
  return (await idsDeTablerosArchivados(workspaceId, db)).includes(tableroId);
}

export const YA_ESTA_ARCHIVADO = "Ese tablero está archivado. El dueño lo puede recuperar desde el selector de tableros → Tableros archivados.";

/** Dos archivos del mismo negocio a la vez no se pisan la lista: van en fila con este candado (dura la transacción). */
const SQL_CANDADO_DE_ARCHIVADOS = `SELECT 1 AS "ok" FROM pg_advisory_xact_lock(hashtext('tablero-ia:archivados:' || $1::text))`;

async function guardarLista(tx: Prisma.TransactionClient, workspaceId: string, lista: TableroArchivado[]) {
  const key = claveDeTablerosArchivados(workspaceId);
  const value = JSON.stringify(lista);
  await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const idDeEntrada = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");

/**
 * "Eliminar tablero": lo archiva (no borra nada). Solo el dueño, con el nombre exacto escrito y sin tarjetas vivas
 * aprobadas o con el Coordinador (ESTADOS_QUE_FRENAN_ARCHIVAR): si las hay, dice cuáles (código y título).
 */
export async function archivarTablero(quien: QuienArchiva, tableroId: unknown, confirmacion: unknown, ahora = new Date()) {
  if (!quien.esDueno) throw new Error(SOLO_EL_DUENO_ARCHIVA);
  const id = idDeEntrada(tableroId);
  const tablero = id
    ? await prisma.tableroInteligente.findFirst({ where: { id, workspaceId: quien.workspaceId }, select: { id: true, nombre: true } })
    : null;
  if (!tablero) throw new Error("No existe ese tablero en este negocio.");
  if (await estaArchivado(quien.workspaceId, tablero.id)) throw new Error("Ese tablero ya está archivado.");
  const enMarcha = await prisma.tarjetaTablero.findMany({
    where: { tableroId: tablero.id, borradoEn: null, archivadaEn: null, estado: { in: [...ESTADOS_QUE_FRENAN_ARCHIVAR] } },
    orderBy: [{ numero: "asc" }, { creadoEn: "asc" }],
    take: 200,
    select: { numero: true, titulo: true, estado: true },
  });
  const problema = problemaParaArchivarTablero({
    esDueno: quien.esDueno,
    nombre: tablero.nombre,
    confirmacion,
    enMarcha: enMarcha.map((tarjeta) => ({
      codigo: codigoDeTarjeta(tarjeta.numero),
      titulo: tarjeta.titulo,
      estado: tarjeta.estado as EstadoTarjetaTablero,
    })),
  });
  if (problema) throw new Error(problema);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SQL_CANDADO_DE_ARCHIVADOS, quien.workspaceId);
    const lista = await tablerosArchivadosDe(quien.workspaceId, tx);
    if (lista.some((archivado) => archivado.tableroId === tablero.id)) return;
    await guardarLista(tx, quien.workspaceId, [
      ...lista,
      { tableroId: tablero.id, archivadoEn: ahora.toISOString(), archivadoPor: quien.userId },
    ]);
    // La hora del tablero: así el refresco de la lista (inicio y selector) ve el cambio.
    await tx.tableroInteligente.update({ where: { id: tablero.id }, data: { actualizadoEn: ahora } });
  });
  return { id: tablero.id, nombre: tablero.nombre };
}

/** "Recuperar": vuelve a la pantalla tal como estaba (con sus tarjetas). Solo el dueño. */
export async function recuperarTablero(quien: QuienArchiva, tableroId: unknown, ahora = new Date()) {
  if (!quien.esDueno) throw new Error(SOLO_EL_DUENO_ARCHIVA);
  const id = idDeEntrada(tableroId);
  const tablero = id
    ? await prisma.tableroInteligente.findFirst({ where: { id, workspaceId: quien.workspaceId }, select: { id: true, nombre: true } })
    : null;
  if (!tablero) throw new Error("No existe ese tablero en este negocio.");
  const recuperado = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SQL_CANDADO_DE_ARCHIVADOS, quien.workspaceId);
    const lista = await tablerosArchivadosDe(quien.workspaceId, tx);
    const queda = lista.filter((archivado) => archivado.tableroId !== tablero.id);
    if (queda.length === lista.length) return false;
    await guardarLista(tx, quien.workspaceId, queda);
    await tx.tableroInteligente.update({ where: { id: tablero.id }, data: { actualizadoEn: ahora } });
    return true;
  });
  if (!recuperado) throw new Error("Ese tablero no está archivado.");
  return { id: tablero.id, nombre: tablero.nombre };
}

/** Un tablero de la lista "Tableros archivados" (solo la ve el dueño). */
export type TableroArchivadoVista = {
  id: string;
  nombre: string;
  /** Tarjetas vivas (sin borrar ni archivar) que trae de vuelta al recuperarlo. */
  tarjetas: number;
  archivadoEn: string;
  archivadoPor: string | null;
};

/** Los tableros archivados del negocio, el último archivado primero. Solo el dueño. */
export async function listarTablerosArchivados(quien: QuienArchiva): Promise<TableroArchivadoVista[]> {
  if (!quien.esDueno) throw new Error(SOLO_EL_DUENO_ARCHIVA);
  const lista = await tablerosArchivadosDe(quien.workspaceId);
  if (!lista.length) return [];
  const ids = lista.map((archivado) => archivado.tableroId);
  const quienes = [...new Set(lista.map((archivado) => archivado.archivadoPor).filter(Boolean))];
  const [tableros, conteos, personas] = await Promise.all([
    prisma.tableroInteligente.findMany({ where: { id: { in: ids }, workspaceId: quien.workspaceId }, select: { id: true, nombre: true } }),
    prisma.tarjetaTablero.groupBy({
      by: ["tableroId"],
      where: { tableroId: { in: ids }, borradoEn: null, archivadaEn: null },
      _count: { _all: true },
    }),
    quienes.length ? prisma.user.findMany({ where: { id: { in: quienes } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const nombre = new Map(tableros.map((tablero) => [tablero.id, tablero.nombre]));
  const cuantas = new Map(conteos.map((fila) => [fila.tableroId, fila._count._all]));
  const persona = new Map(personas.map((fila) => [fila.id, fila.name?.trim() || fila.email]));
  return lista
    .filter((archivado) => nombre.has(archivado.tableroId))
    .map((archivado) => ({
      id: archivado.tableroId,
      nombre: nombre.get(archivado.tableroId)!,
      tarjetas: cuantas.get(archivado.tableroId) ?? 0,
      archivadoEn: archivado.archivadoEn,
      archivadoPor: persona.get(archivado.archivadoPor) ?? null,
    }))
    .reverse();
}
