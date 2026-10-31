import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { codigoDeTarjeta, textoLimpio } from "./reglas";
import { LIMITE_TARJETAS, VISIBLE, type ContextoTablero } from "./tableros";

/*
  TARJETAS ARCHIVADAS del Tablero IA (30-oct-2026). El tablero Empresa Magilus llegó al máximo de 300 tarjetas
  porque las HECHO y FALLIDO se quedaban para siempre. Pedido del dueño: que las terminadas salgan del tablero y
  queden registradas en un archivo de trabajos terminados.

  - Una HECHO o FALLIDO que terminó hace más de 3 días (AppSetting `tablero:archivar-terminadas:dias`) se archiva
    sola: `archivadaEn` y `terminadaEn`. NO cambia de estado ni pierde nada (plan, resultado, commits, aprobaciones,
    historial), así que el Coordinador la sigue viendo HECHO ("espera a esta", madre partida).
  - Cuándo terminó: el último cambio a HECHO o FALLIDO del historial (o el último "desarchivar", que vuelve a
    empezar la cuenta); si no hay historial, la última edición.
  - Una madre con hijas abiertas (ni borradas, ni HECHO, ni FALLIDO) no se archiva.
  - Corre en el reloj (api/cron/follows) una vez al día, por tandas de 200: el día queda anotado
    (`tablero:archivar-terminadas:ultimo`) solo cuando ya no queda nada para archivar. La primera vuelta después
    de subir no tiene día anotado y archiva todo lo viejo de todos los tableros: esa es la limpieza única.
  - Las archivadas salen de lo de todos los días (filtro VISIBLE de tableros.ts) y se ven en la pestaña
    "Trabajos terminados" (TrabajosTerminados.tsx), con el botón Desarchivar. Por el MCP: ver_tablero con
    estado ARCHIVADA y listar_terminadas (lo terminado en una semana).
*/

const MS_DIA = 86_400_000;
const BOGOTA_MS = 5 * 3_600_000;

export const DIAS_POR_DEFECTO = 3;
export const LOTE_DE_ARCHIVO = 200;
export const CLAVE_DIAS = "tablero:archivar-terminadas:dias";
export const CLAVE_ULTIMO = "tablero:archivar-terminadas:ultimo";
/** `HistorialTarjeta.quien` del archivado automático (origen TRABAJADOR: no se deshace desde el MCP). */
export const QUIEN_ARCHIVA = "sistema:archivar-terminadas";

export const ESTADOS_TERMINADOS = ["HECHO", "FALLIDO"] as const;
const esTerminado = (estado: string) => (ESTADOS_TERMINADOS as readonly string[]).includes(estado);

/* ───────────────────────────────────────────────────────────────────── reglas puras ── */

/** Los días del ajuste guardado: un entero de 1 a 365; cualquier otra cosa (o nada) son 3. */
export function diasDelAjuste(valor: string | null | undefined): number {
  const dias = Number(valor);
  return Number.isInteger(dias) && dias >= 1 && dias <= 365 ? dias : DIAS_POR_DEFECTO;
}

/** ¿Se archiva? HECHO o FALLIDO, terminada hace más de `dias` y sin hijas abiertas. */
export function sePuedeArchivar(
  tarjeta: { estado: string; terminadaEn: Date; hijasAbiertas: number },
  ahora: Date,
  dias: number = DIAS_POR_DEFECTO,
): boolean {
  if (!esTerminado(tarjeta.estado)) return false;
  if (tarjeta.hijasAbiertas > 0) return false;
  return ahora.getTime() - tarjeta.terminadaEn.getTime() > dias * MS_DIA;
}

/** El día (AAAA-MM-DD) en Bogotá, que no tiene horario de verano (UTC-5). */
export function diaDeBogota(ahora: Date): string {
  return new Date(ahora.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
}

/** Un día AAAA-MM-DD que existe, o null. */
export function diaValido(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) return null;
  const dia = valor.trim();
  const fecha = new Date(`${dia}T00:00:00Z`);
  return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== dia ? null : dia;
}

/**
 * La semana (de lunes a domingo, hora de Bogotá) de un día AAAA-MM-DD: el lunes y el domingo, y desde / hasta
 * (sin incluirlo) en UTC para buscar en la base.
 */
export function semanaDe(dia: string): { lunes: string; domingo: string; desde: Date; hasta: Date } {
  const fecha = new Date(`${dia}T00:00:00Z`);
  const lunes = new Date(fecha.getTime() - ((fecha.getUTCDay() + 6) % 7) * MS_DIA);
  const domingo = new Date(lunes.getTime() + 6 * MS_DIA);
  const desde = new Date(lunes.getTime() + BOGOTA_MS);
  return {
    lunes: lunes.toISOString().slice(0, 10),
    domingo: domingo.toISOString().slice(0, 10),
    desde,
    hasta: new Date(desde.getTime() + 7 * MS_DIA),
  };
}

/** El link del commit guardado en la subida, solo si es https (se dibuja como enlace). */
export function linkDelCommit(resultado: unknown): { commit: string | null; linkCommit: string | null } {
  const objeto = (valor: unknown): Record<string, unknown> =>
    valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  const subida = objeto(objeto(resultado).subida);
  const commit = typeof subida.commit === "string" && subida.commit.trim() ? subida.commit.trim() : null;
  const link = typeof subida.linkCommit === "string" ? subida.linkCommit.trim() : "";
  return { commit, linkCommit: /^https:\/\/[^\s"'<>]+$/i.test(link) ? link : null };
}

/* ───────────────────────────────────────────────────────────────────── cuándo terminó ── */

/** Filas del historial que fijan "cuándo terminó": un cambio a HECHO o FALLIDO, o un desarchivar. */
const DONDE_TERMINO: Prisma.HistorialTarjetaWhereInput = {
  deshechoEn: null,
  OR: [
    { accion: "estado", despues: { path: ["estado"], equals: "HECHO" } },
    { accion: "estado", despues: { path: ["estado"], equals: "FALLIDO" } },
    { accion: "desarchivar" },
  ],
};

async function cuandoTerminaron(ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const filas = await prisma.historialTarjeta.groupBy({
    by: ["tarjetaId"],
    where: { tarjetaId: { in: ids }, ...DONDE_TERMINO },
    _max: { creadoEn: true },
  });
  return new Map(filas.flatMap((fila) => (fila._max.creadoEn ? [[fila.tarjetaId, fila._max.creadoEn] as const] : [])));
}

async function hijasAbiertasDe(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const filas = await prisma.tarjetaTablero.groupBy({
    by: ["padreId"],
    where: { padreId: { in: ids }, borradoEn: null, estado: { notIn: [...ESTADOS_TERMINADOS] } },
    _count: { _all: true },
  });
  return new Map(filas.flatMap((fila) => (fila.padreId ? [[fila.padreId, fila._count._all] as const] : [])));
}

/* ───────────────────────────────────────────────────────────────────── el reloj ── */

/**
 * Archiva las HECHO y FALLIDO de todos los tableros que terminaron hace más de N días (una vez al día; tandas de
 * LOTE_DE_ARCHIVO). Nunca lanza por una tanda: el error queda en el log y se reintenta en la próxima vuelta.
 */
export async function archivarLasTerminadas(ahora: Date = new Date()): Promise<{ archivadas: number; quedan: boolean }> {
  const dia = diaDeBogota(ahora);
  const [ultimo, ajuste] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: CLAVE_ULTIMO }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: CLAVE_DIAS }, select: { value: true } }),
  ]);
  if (ultimo?.value === dia) return { archivadas: 0, quedan: false };
  const dias = diasDelAjuste(ajuste?.value);

  const candidatas = await prisma.tarjetaTablero.findMany({
    where: { estado: { in: [...ESTADOS_TERMINADOS] }, borradoEn: null, archivadaEn: null },
    orderBy: { actualizadoEn: "asc" },
    select: { id: true, tableroId: true, estado: true, actualizadoEn: true },
  });
  const ids = candidatas.map((tarjeta) => tarjeta.id);
  const [terminaron, hijas] = await Promise.all([cuandoTerminaron(ids), hijasAbiertasDe(ids)]);
  const paraArchivar = candidatas
    .map((tarjeta) => ({ ...tarjeta, terminadaEn: terminaron.get(tarjeta.id) ?? tarjeta.actualizadoEn, hijasAbiertas: hijas.get(tarjeta.id) ?? 0 }))
    .filter((tarjeta) => sePuedeArchivar(tarjeta, ahora, dias));
  const tanda = paraArchivar.slice(0, LOTE_DE_ARCHIVO);

  let archivadas = 0;
  if (tanda.length) {
    archivadas = await prisma.$transaction(
      async (tx) => {
        const hechas: typeof tanda = [];
        for (const tarjeta of tanda) {
          // Solo si sigue terminada y sin archivar (alguien pudo reabrirla un instante antes).
          const cambio = await tx.tarjetaTablero.updateMany({
            where: { id: tarjeta.id, estado: { in: [...ESTADOS_TERMINADOS] }, borradoEn: null, archivadaEn: null },
            data: { archivadaEn: ahora, terminadaEn: tarjeta.terminadaEn },
          });
          if (cambio.count === 1) hechas.push(tarjeta);
        }
        if (hechas.length) {
          await tx.historialTarjeta.createMany({
            data: hechas.map((tarjeta) => ({
              tarjetaId: tarjeta.id,
              quien: QUIEN_ARCHIVA,
              origen: "TRABAJADOR",
              accion: "archivar",
              antes: { archivadaEn: null },
              despues: { archivadaEn: ahora.toISOString(), terminadaEn: tarjeta.terminadaEn.toISOString(), dias },
            })),
          });
          // La pantalla se refresca con TableroInteligente.actualizadoEn.
          await tx.tableroInteligente.updateMany({
            where: { id: { in: [...new Set(hechas.map((tarjeta) => tarjeta.tableroId))] } },
            data: { actualizadoEn: ahora },
          });
        }
        return hechas.length;
      },
      { timeout: 60_000 },
    );
  }
  const quedan = paraArchivar.length > tanda.length;
  // Hasta que no quede nada para archivar, la próxima vuelta (el próximo minuto) sigue con otra tanda.
  if (!quedan) {
    await prisma.appSetting.upsert({ where: { key: CLAVE_ULTIMO }, create: { key: CLAVE_ULTIMO, value: dia }, update: { value: dia } });
  }
  return { archivadas, quedan };
}

/** Para que_es_esta_aplicacion: los días y la última vuelta completa. */
export async function estadoDelArchivado(): Promise<string> {
  const [ultimo, ajuste] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: CLAVE_ULTIMO }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: CLAVE_DIAS }, select: { value: true } }),
  ]);
  const dias = diasDelAjuste(ajuste?.value);
  return `activa (sin interruptor): una vez al día archiva las HECHO y FALLIDO de más de ${dias} días (${CLAVE_DIAS}), sin madres con hijas abiertas; ${
    ultimo?.value ? `última vuelta completa: ${ultimo.value}` : "todavía no ha completado ninguna vuelta"
  }`;
}

/* ───────────────────────────────────────────────────────────────────── la pantalla ── */

export type ArchivadaVista = {
  id: string;
  codigo: string;
  titulo: string;
  estado: string;
  tableroId: string;
  tableroNombre: string;
  repo: string | null;
  terminadaEn: string | null;
  archivadaEn: string;
  commit: string | null;
  linkCommit: string | null;
};

const MAX_LISTA = 100;

/** El filtro del buscador: el código (T-123 o 123), el título o el repo. */
function dondeBuscar(buscar: unknown): Prisma.TarjetaTableroWhereInput {
  const texto = textoLimpio(buscar, 80);
  if (!texto) return {};
  const numero = /^t?-?\s*(\d{1,9})$/i.exec(texto)?.[1];
  return {
    OR: [
      ...(numero ? [{ numero: Number(numero) }] : []),
      { titulo: { contains: texto, mode: "insensitive" } },
      { repo: { contains: texto, mode: "insensitive" } },
    ],
  };
}

/** Las archivadas del negocio (las últimas en terminar primero), con el buscador. Solo el dueño o el ADMIN. */
export async function listarArchivadas(workspaceId: string, buscar?: unknown): Promise<{ tarjetas: ArchivadaVista[]; hayMas: boolean }> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { tablero: { workspaceId }, borradoEn: null, archivadaEn: { not: null }, ...dondeBuscar(buscar) },
    orderBy: [{ terminadaEn: { sort: "desc", nulls: "last" } }, { archivadaEn: "desc" }],
    take: MAX_LISTA + 1,
    select: {
      id: true,
      numero: true,
      titulo: true,
      estado: true,
      repo: true,
      resultado: true,
      terminadaEn: true,
      archivadaEn: true,
      tablero: { select: { id: true, nombre: true } },
    },
  });
  return {
    hayMas: filas.length > MAX_LISTA,
    tarjetas: filas.slice(0, MAX_LISTA).map((fila) => ({
      id: fila.id,
      codigo: codigoDeTarjeta(fila.numero),
      titulo: fila.titulo,
      estado: fila.estado,
      tableroId: fila.tablero.id,
      tableroNombre: fila.tablero.nombre,
      repo: fila.repo,
      terminadaEn: fila.terminadaEn ? fila.terminadaEn.toISOString() : null,
      archivadaEn: (fila.archivadaEn ?? new Date(0)).toISOString(),
      ...linkDelCommit(fila.resultado),
    })),
  };
}

/**
 * Desarchivar: la tarjeta vuelve al tablero (sigue en su estado) y queda en el historial. Cuenta para el límite,
 * así que un tablero lleno no la recibe. El "desarchivar" vuelve a empezar la cuenta de los días.
 */
export async function desarchivarTarjeta(contexto: ContextoTablero, tarjetaId: unknown): Promise<{ titulo: string }> {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, tablero: { workspaceId: contexto.workspaceId }, borradoEn: null },
        select: { id: true, titulo: true, tableroId: true, archivadaEn: true },
      })
    : null;
  if (!tarjeta) throw new Error("No existe esa tarjeta en este negocio.");
  const archivadaEn = tarjeta.archivadaEn;
  if (!archivadaEn) throw new Error("Esa tarjeta ya está en el tablero.");
  const enElTablero = await prisma.tarjetaTablero.count({ where: { tableroId: tarjeta.tableroId, ...VISIBLE } });
  if (enElTablero >= LIMITE_TARJETAS) {
    throw new Error(`El tablero ya tiene ${LIMITE_TARJETAS} tarjetas, que es el máximo. Archiva o borra alguna antes.`);
  }
  await prisma.$transaction(async (tx) => {
    const cambio = await tx.tarjetaTablero.updateMany({ where: { id: tarjeta.id, archivadaEn: { not: null } }, data: { archivadaEn: null } });
    if (cambio.count !== 1) throw new Error("Esa tarjeta ya está en el tablero.");
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: tarjeta.id,
        quien: contexto.userId,
        origen: contexto.origen,
        accion: "desarchivar",
        antes: { archivadaEn: archivadaEn.toISOString() },
        despues: { archivadaEn: null },
      },
    });
    await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
  });
  return { titulo: tarjeta.titulo };
}

/* ───────────────────────────────────────────────────────────────────── el MCP ── */

export type TerminadaDeLaSemana = {
  id: string;
  codigo: string;
  titulo: string;
  estado: string;
  tableroId: string;
  tableroNombre: string;
  repo: string | null;
  terminadaEn: string;
  archivada: boolean;
  linkCommit: string | null;
};

/**
 * Lo terminado (HECHO o FALLIDO, archivado o no) en la semana de `dia` (lunes a domingo, hora de Bogotá), de todo el
 * negocio o de un tablero. La fecha es el último cambio a HECHO o FALLIDO de esa semana (o la guardada al archivar).
 */
export async function terminadasDeLaSemana(workspaceId: string, dia: string, tableroId?: string | null) {
  const semana = semanaDe(dia);
  const enLaSemana = { gte: semana.desde, lt: semana.hasta };
  const dondeTarjeta: Prisma.TarjetaTableroWhereInput = {
    tablero: { workspaceId, ...(tableroId ? { id: tableroId } : {}) },
    borradoEn: null,
    estado: { in: [...ESTADOS_TERMINADOS] },
  };
  const [cambios, archivadas] = await Promise.all([
    prisma.historialTarjeta.groupBy({
      by: ["tarjetaId"],
      where: {
        creadoEn: enLaSemana,
        deshechoEn: null,
        OR: [
          { accion: "estado", despues: { path: ["estado"], equals: "HECHO" } },
          { accion: "estado", despues: { path: ["estado"], equals: "FALLIDO" } },
        ],
        tarjeta: dondeTarjeta,
      },
      _max: { creadoEn: true },
    }),
    prisma.tarjetaTablero.findMany({ where: { ...dondeTarjeta, terminadaEn: enLaSemana }, select: { id: true, terminadaEn: true } }),
  ]);
  const cuando = new Map<string, Date>();
  for (const fila of archivadas) if (fila.terminadaEn) cuando.set(fila.id, fila.terminadaEn);
  for (const fila of cambios) if (fila._max.creadoEn) cuando.set(fila.tarjetaId, fila._max.creadoEn);
  const filas = cuando.size
    ? await prisma.tarjetaTablero.findMany({
        where: { id: { in: [...cuando.keys()] } },
        select: { id: true, numero: true, titulo: true, estado: true, repo: true, resultado: true, archivadaEn: true, tablero: { select: { id: true, nombre: true } } },
      })
    : [];
  const tarjetas: TerminadaDeLaSemana[] = filas
    .map((fila) => ({
      id: fila.id,
      codigo: codigoDeTarjeta(fila.numero),
      titulo: fila.titulo,
      estado: fila.estado,
      tableroId: fila.tablero.id,
      tableroNombre: fila.tablero.nombre,
      repo: fila.repo,
      terminadaEn: cuando.get(fila.id)!.toISOString(),
      archivada: Boolean(fila.archivadaEn),
      linkCommit: linkDelCommit(fila.resultado).linkCommit,
    }))
    .sort((a, b) => a.terminadaEn.localeCompare(b.terminadaEn));
  return { lunes: semana.lunes, domingo: semana.domingo, tarjetas };
}
