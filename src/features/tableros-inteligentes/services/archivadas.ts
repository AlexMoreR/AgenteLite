import { prisma } from "@/lib/prisma";
import { codigoDeTarjeta, type EstadoTarjetaTablero } from "./reglas";
import type { Alcance, ContextoTablero } from "./tableros";

/*
  TARJETAS ARCHIVADAS del Tablero IA (30-oct-2026, pedido del dueño: el tablero Empresa Magilus llegó a 300 tarjetas
  y no dejaba crear más porque las HECHO y FALLIDO se quedaban para siempre).

  Archivar NO cambia el estado ni borra nada: la tarjeta sigue HECHO o FALLIDO con su plan, resultado, commits,
  aprobaciones e historial, y solo se le pone `archivadaEn` (y `terminadaEn`, la fecha en que terminó). Así el
  Coordinador sigue viendo HECHO la tarjeta de origen de una flecha "espera a esta" y el cierre de una madre partida
  no cambia (sql-trabajador.ts, trabajador.ts y madre-partida.ts NO filtran las archivadas, a propósito).

  - Una vez al día, en el reloj (api/cron/follows), se archivan las HECHO y FALLIDO de TODOS los tableros que
    terminaron hace más de 3 días (ajuste `tablero:archivar-terminadas:dias`). La primera vuelta después de subir es la
    limpieza única: todavía no hay marca de "ya corrió hoy". Va por tandas de 200 por vuelta: si queda más, la marca
    del día no se pone y la vuelta siguiente sigue.
  - La fecha de terminada es la del último cambio a HECHO o FALLIDO del historial (sin deshacer); sin historial, la
    última edición.
  - Una madre con hijas abiertas (no borradas y ni HECHO ni FALLIDO) no se archiva.
  - Las archivadas no cuentan para el límite de 300 ni salen en el mapa, en ver_tablero normal, en los contadores
    ni en "Te toca a ti" (el filtro VISIBLE de tableros.ts). Se ven en la pestaña "Trabajos terminados".
  - Desarchivar (botón de esa pestaña) la devuelve al tablero. Si a una archivada se le cambia el estado a uno
    abierto, se desarchiva sola (tableros.ts: alReabrir).
*/

const MS_HORA = 3_600_000;
const MS_DIA = 24 * MS_HORA;
const BOGOTA_MS = 5 * MS_HORA;

export const ESTADOS_TERMINADOS = ["HECHO", "FALLIDO"] as const satisfies readonly EstadoTarjetaTablero[];
export const DIAS_POR_DEFECTO = 3;
const DIAS_MAXIMO = 365;
/** Cuántos días después de terminar se archiva (texto con un entero; sin fila, 3). */
export const CLAVE_DIAS = "tablero:archivar-terminadas:dias";
/** El día de Bogotá (AAAA-MM-DD) en que ya se archivó todo: "ya corrió hoy". */
export const CLAVE_ULTIMO_DIA = "tablero:archivar-terminadas:ultimo-dia";
/** Cuántas se archivan como máximo por vuelta (la limpieza inicial va por tandas). */
export const TANDA = 200;
/** Cuántas candidatas se miran por vuelta (las madres con hijas abiertas se saltan). */
const CANDIDATAS_POR_VUELTA = 2000;
const LOTE = 200;
/** Quién queda en el historial cuando archiva el reloj. */
export const QUIEN_ARCHIVA = "sistema:archivar-terminadas";
const MAX_LISTA = 300;
const MAX_SEMANA = 500;

/* ─────────────────────────────────────────────────────────────────────── reglas puras ── */

export const estaTerminada = (estado: string) => (ESTADOS_TERMINADOS as readonly string[]).includes(estado);

/** Una hija abierta: no borrada y ni HECHO ni FALLIDO. */
export const esHijaAbierta = (hija: { estado: string; borradoEn: Date | string | null }) => !hija.borradoEn && !estaTerminada(hija.estado);

/** Los días del ajuste: un entero de 0 a 365; cualquier otra cosa (o sin fila) vale 3. */
export function diasDelAjuste(valor: string | null | undefined): number {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,3}$/.test(texto)) return DIAS_POR_DEFECTO;
  const dias = Number(texto);
  return dias <= DIAS_MAXIMO ? dias : DIAS_POR_DEFECTO;
}

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};

/** Una fila del historial que dejó la tarjeta en HECHO o FALLIDO (y no se deshizo). */
export const terminoEnEsteCambio = (fila: { despues: unknown; deshechoEn?: Date | null }) =>
  !fila.deshechoEn && typeof comoObjeto(fila.despues).estado === "string" && estaTerminada(comoObjeto(fila.despues).estado as string);

/** Cuándo terminó: el último cambio a HECHO o FALLIDO del historial; sin ninguno, la última edición. */
export function fechaDeTerminada(
  historial: readonly { despues: unknown; deshechoEn?: Date | null; creadoEn: Date }[],
  actualizadoEn: Date,
): Date {
  let ultima: Date | null = null;
  for (const fila of historial) {
    if (terminoEnEsteCambio(fila) && (!ultima || fila.creadoEn.getTime() > ultima.getTime())) ultima = fila.creadoEn;
  }
  return ultima ?? actualizadoEn;
}

/**
 * ¿Se archiva? HECHO o FALLIDO, no borrada ni archivada, sin hijas abiertas y terminada hace MÁS de `dias` días.
 * Una IDEA, EN_CURSO o cualquier otro estado abierto nunca se archiva.
 */
export function sePuedeArchivar(
  tarjeta: { estado: string; borradoEn: Date | null; archivadaEn: Date | null; terminadaEn: Date },
  hijasAbiertas: number,
  ahora: Date,
  dias: number,
): boolean {
  if (!estaTerminada(tarjeta.estado) || tarjeta.borradoEn || tarjeta.archivadaEn) return false;
  if (hijasAbiertas > 0) return false;
  return ahora.getTime() - tarjeta.terminadaEn.getTime() > dias * MS_DIA;
}

/** Lo que cuenta para el límite de 300 (y sale en el mapa): ni borrada ni archivada. */
export const cuentaParaElLimite = (tarjeta: { borradoEn: Date | null; archivadaEn: Date | null }) =>
  !tarjeta.borradoEn && !tarjeta.archivadaEn;

/** El día (AAAA-MM-DD) en Bogotá, que no tiene horario de verano (UTC-5 todo el año). */
export function diaDeBogota(ahora: Date): string {
  return new Date(ahora.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
}

/**
 * La semana (lunes a domingo, en hora de Bogotá) de una fecha AAAA-MM-DD: el lunes y el domingo, y el rango en UTC
 * (desde el lunes 00:00 hasta el lunes siguiente 00:00 de Bogotá, sin incluirlo). Una fecha mal escrita da null.
 */
export function semanaDe(fecha: string): { lunes: string; domingo: string; desde: Date; hasta: Date } | null {
  const texto = typeof fecha === "string" ? fecha.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const mediodia = new Date(`${texto}T12:00:00Z`);
  if (Number.isNaN(mediodia.getTime()) || mediodia.toISOString().slice(0, 10) !== texto) return null;
  const desdeLunes = (mediodia.getUTCDay() + 6) % 7; // lunes = 0 … domingo = 6
  const lunes = new Date(mediodia.getTime() - desdeLunes * MS_DIA).toISOString().slice(0, 10);
  const domingo = new Date(mediodia.getTime() + (6 - desdeLunes) * MS_DIA).toISOString().slice(0, 10);
  const desde = new Date(Date.parse(`${lunes}T00:00:00Z`) + BOGOTA_MS);
  return { lunes, domingo, desde, hasta: new Date(desde.getTime() + 7 * MS_DIA) };
}

/** El link al commit, solo si es un https:// (viaja a un href de la pantalla). */
export function linkDelCommit(resultado: unknown): string | null {
  const link = comoObjeto(comoObjeto(resultado).subida).linkCommit;
  return typeof link === "string" && /^https:\/\/[^\s"'<>]+$/.test(link.trim()) ? link.trim() : null;
}

const commitDe = (resultado: unknown): string | null => {
  const subida = comoObjeto(comoObjeto(resultado).subida);
  const commit = subida.commit ?? comoObjeto(resultado).commit;
  return typeof commit === "string" && commit.trim() ? commit.trim().slice(0, 64) : null;
};

/** Lo que se busca: "T-123" (o "123") busca por código; lo demás, en el título y el repo. */
export function busquedaDe(texto: string | null | undefined): { numero: number } | { texto: string } | null {
  const limpio = typeof texto === "string" ? texto.trim().slice(0, 100) : "";
  if (!limpio) return null;
  const codigo = /^t?-?\s*(\d{1,9})$/i.exec(limpio);
  return codigo ? { numero: Number(codigo[1]) } : { texto: limpio };
}

const ESTADOS_EN_LISTA = [...ESTADOS_TERMINADOS] as EstadoTarjetaTablero[];

const dondeTablero = (alcance: Alcance) =>
  alcance.soloDe ? { workspaceId: alcance.workspaceId, duenoUserId: alcance.soloDe } : { workspaceId: alcance.workspaceId };

/* ─────────────────────────────────────────────────────────────── archivar (el reloj) ── */

async function ajuste(clave: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

/**
 * Archiva las HECHO y FALLIDO de todos los tableros que terminaron hace más de N días. Una vez al día; la primera
 * vez es la limpieza única. Nunca lanza por una tarjeta: la que falla se intenta otra vez el día siguiente.
 */
export async function archivarLasTerminadas(ahora: Date = new Date()): Promise<{ archivadas: number; quedan: boolean }> {
  const dia = diaDeBogota(ahora);
  if ((await ajuste(CLAVE_ULTIMO_DIA)) === dia) return { archivadas: 0, quedan: false };
  const dias = diasDelAjuste(await ajuste(CLAVE_DIAS));
  const corte = new Date(ahora.getTime() - dias * MS_DIA);

  // Las candidatas: HECHO o FALLIDO sin archivar, de la que menos se tocó a la que más. Una que se editó hace poco
  // pudo terminar antes: por eso no se filtra por actualizadoEn, se mira su historial.
  const candidatas = await prisma.tarjetaTablero.findMany({
    where: { borradoEn: null, archivadaEn: null, estado: { in: ESTADOS_EN_LISTA }, creadoEn: { lt: corte } },
    orderBy: [{ actualizadoEn: "asc" }],
    take: CANDIDATAS_POR_VUELTA,
    select: { id: true, tableroId: true, estado: true, actualizadoEn: true, borradoEn: true, archivadaEn: true },
  });

  let archivadas = 0;
  const tocados = new Set<string>();
  for (let inicio = 0; inicio < candidatas.length && archivadas < TANDA; inicio += LOTE) {
    const lote = candidatas.slice(inicio, inicio + LOTE);
    const ids = lote.map((tarjeta) => tarjeta.id);
    const [historial, hijas] = await Promise.all([
      prisma.historialTarjeta.findMany({
        where: { tarjetaId: { in: ids }, deshechoEn: null },
        select: { tarjetaId: true, despues: true, deshechoEn: true, creadoEn: true },
      }),
      prisma.tarjetaTablero.groupBy({
        by: ["padreId"],
        where: { padreId: { in: ids }, borradoEn: null, estado: { notIn: ESTADOS_EN_LISTA } },
        _count: { _all: true },
      }),
    ]);
    const abiertasDe = new Map(hijas.map((fila) => [fila.padreId, fila._count._all]));
    const historialDe = new Map<string, typeof historial>();
    for (const fila of historial) historialDe.set(fila.tarjetaId, [...(historialDe.get(fila.tarjetaId) ?? []), fila]);

    for (const tarjeta of lote) {
      if (archivadas >= TANDA) break;
      const terminadaEn = fechaDeTerminada(historialDe.get(tarjeta.id) ?? [], tarjeta.actualizadoEn);
      if (!sePuedeArchivar({ ...tarjeta, terminadaEn }, abiertasDe.get(tarjeta.id) ?? 0, ahora, dias)) continue;
      try {
        const hecho = await prisma.$transaction(async (tx) => {
          // Condicionado: si alguien la reabrió o la borró un instante antes, no se archiva.
          const cambio = await tx.tarjetaTablero.updateMany({
            where: { id: tarjeta.id, estado: tarjeta.estado, borradoEn: null, archivadaEn: null },
            data: { archivadaEn: ahora, terminadaEn },
          });
          if (cambio.count !== 1) return false;
          await tx.historialTarjeta.create({
            data: {
              tarjetaId: tarjeta.id,
              quien: QUIEN_ARCHIVA,
              origen: "TRABAJADOR",
              accion: "archivar",
              antes: { archivadaEn: null },
              despues: { archivadaEn: ahora.toISOString(), terminadaEn: terminadaEn.toISOString(), dias },
            },
            select: { id: true },
          });
          return true;
        });
        if (hecho) {
          archivadas += 1;
          tocados.add(tarjeta.tableroId);
        }
      } catch (error) {
        console.error("[archivar-terminadas] no se pudo archivar", {
          tarjetaId: tarjeta.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Los tableros que cambiaron se refrescan solos en la pantalla (su firma es actualizadoEn).
  if (tocados.size) {
    await prisma.tableroInteligente.updateMany({ where: { id: { in: [...tocados] } }, data: { actualizadoEn: ahora } });
  }
  // Una tanda llena puede dejar más: la marca del día no se pone y la vuelta siguiente sigue.
  const quedan = archivadas >= TANDA;
  if (!quedan) {
    await prisma.appSetting.upsert({
      where: { key: CLAVE_ULTIMO_DIA },
      create: { key: CLAVE_ULTIMO_DIA, value: dia },
      update: { value: dia },
    });
  }
  return { archivadas, quedan };
}

/** Lo que dice la automatización en que_es_esta_aplicacion. */
export async function estadoDelArchivado(): Promise<string> {
  const [dias, ultimo] = await Promise.all([ajuste(CLAVE_DIAS), ajuste(CLAVE_ULTIMO_DIA)]);
  return `activa (sin interruptor): una vez al día archiva las HECHO y FALLIDO de más de ${diasDelAjuste(dias)} días (${CLAVE_DIAS}); última vuelta completa: ${ultimo ?? "todavía ninguna"}`;
}

/* ───────────────────────────────────────────────────────── la pantalla y el MCP ── */

export type ArchivadaVista = {
  id: string;
  codigo: string;
  titulo: string;
  estado: EstadoTarjetaTablero;
  tableroId: string;
  tableroNombre: string;
  repo: string | null;
  commit: string | null;
  linkCommit: string | null;
  /** ISO; la fecha en que terminó (si es una sin archivar, la del historial). */
  terminadaEn: string;
  /** ISO, o null si todavía no está archivada (listar_terminadas trae las dos). */
  archivadaEn: string | null;
};

const SELECT_ARCHIVADA = {
  id: true,
  numero: true,
  titulo: true,
  estado: true,
  repo: true,
  resultado: true,
  terminadaEn: true,
  archivadaEn: true,
  actualizadoEn: true,
  tablero: { select: { id: true, nombre: true } },
} as const;

type FilaArchivada = {
  id: string;
  numero: number | null;
  titulo: string;
  estado: EstadoTarjetaTablero;
  repo: string | null;
  resultado: unknown;
  terminadaEn: Date | null;
  archivadaEn: Date | null;
  actualizadoEn: Date;
  tablero: { id: string; nombre: string };
};

function aVistaArchivada(fila: FilaArchivada, terminadaEn?: Date): ArchivadaVista {
  return {
    id: fila.id,
    codigo: codigoDeTarjeta(fila.numero),
    titulo: fila.titulo,
    estado: fila.estado,
    tableroId: fila.tablero.id,
    tableroNombre: fila.tablero.nombre,
    repo: fila.repo,
    commit: commitDe(fila.resultado),
    linkCommit: linkDelCommit(fila.resultado),
    terminadaEn: (terminadaEn ?? fila.terminadaEn ?? fila.archivadaEn ?? fila.actualizadoEn).toISOString(),
    archivadaEn: fila.archivadaEn ? fila.archivadaEn.toISOString() : null,
  };
}

/**
 * Las archivadas que la persona alcanza (o las de un tablero), de la última terminada a la primera. `buscar` filtra por
 * código ("T-123"), título o repo.
 */
export async function listarArchivadas(
  alcance: Alcance,
  { buscar, tableroId }: { buscar?: string | null; tableroId?: string | null } = {},
): Promise<ArchivadaVista[]> {
  const busqueda = busquedaDe(buscar);
  const filas = await prisma.tarjetaTablero.findMany({
    where: {
      borradoEn: null,
      archivadaEn: { not: null },
      tablero: { ...dondeTablero(alcance), ...(tableroId ? { id: tableroId } : {}) },
      ...(busqueda && "numero" in busqueda ? { numero: busqueda.numero } : {}),
      ...(busqueda && "texto" in busqueda
        ? {
            OR: [
              { titulo: { contains: busqueda.texto, mode: "insensitive" as const } },
              { repo: { contains: busqueda.texto, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ terminadaEn: { sort: "desc", nulls: "last" } }, { archivadaEn: "desc" }],
    take: MAX_LISTA,
    select: SELECT_ARCHIVADA,
  });
  return filas.map((fila) => aVistaArchivada(fila));
}

/** Devuelve una archivada al tablero (queda en su HECHO o FALLIDO) y lo anota en el historial. */
export async function desarchivarTarjeta(contexto: ContextoTablero, tarjetaId: unknown) {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, borradoEn: null, tablero: dondeTablero(contexto) },
        select: { id: true, numero: true, titulo: true, tableroId: true, archivadaEn: true },
      })
    : null;
  if (!tarjeta) throw new Error("No existe esa tarjeta en este negocio.");
  if (!tarjeta.archivadaEn) throw new Error("Esa tarjeta ya está en el tablero.");
  const archivadaEn = tarjeta.archivadaEn;
  await prisma.$transaction(async (tx) => {
    const cambio = await tx.tarjetaTablero.updateMany({
      where: { id: tarjeta.id, borradoEn: null, archivadaEn },
      data: { archivadaEn: null },
    });
    if (cambio.count !== 1) throw new Error("La tarjeta cambió mientras la mirabas. Vuelve a cargar la lista.");
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: tarjeta.id,
        quien: contexto.userId,
        origen: contexto.origen,
        accion: "desarchivar",
        antes: { archivadaEn: archivadaEn.toISOString() },
        despues: { archivadaEn: null },
      },
      select: { id: true },
    });
    await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
  });
  return { id: tarjeta.id, codigo: codigoDeTarjeta(tarjeta.numero), titulo: tarjeta.titulo, tableroId: tarjeta.tableroId };
}

/**
 * Lo terminado (HECHO o FALLIDO, archivado o no) en la semana de `fecha` (lunes a domingo, hora de Bogotá), de todos
 * los tableros que alcanza o de uno. La fecha de cada una es la de su archivado (`terminadaEn`) o, si no está
 * archivada, la del último cambio a HECHO o FALLIDO de esa semana.
 */
export async function terminadasDeLaSemana(alcance: Alcance, fecha: unknown, tableroId?: string | null) {
  const semana = semanaDe(typeof fecha === "string" ? fecha : "");
  if (!semana) throw new Error("La semana va como una fecha AAAA-MM-DD, por ejemplo 2026-10-30.");
  const delTablero = { ...dondeTablero(alcance), ...(tableroId ? { id: tableroId } : {}) };
  const enLaSemana = { gte: semana.desde, lt: semana.hasta };
  const [cambios, archivadas] = await Promise.all([
    prisma.historialTarjeta.findMany({
      where: {
        creadoEn: enLaSemana,
        deshechoEn: null,
        OR: ESTADOS_TERMINADOS.map((estado) => ({ despues: { path: ["estado"], equals: estado } })),
        tarjeta: { borradoEn: null, archivadaEn: null, estado: { in: ESTADOS_EN_LISTA }, tablero: delTablero },
      },
      orderBy: { creadoEn: "asc" },
      take: 5 * MAX_SEMANA,
      select: { tarjetaId: true, creadoEn: true },
    }),
    prisma.tarjetaTablero.findMany({
      where: { borradoEn: null, archivadaEn: { not: null }, terminadaEn: enLaSemana, tablero: delTablero },
      take: MAX_SEMANA,
      select: SELECT_ARCHIVADA,
    }),
  ]);
  // De las sin archivar: el último cambio a HECHO o FALLIDO de la semana.
  const ultimoDe = new Map<string, Date>();
  for (const cambio of cambios) ultimoDe.set(cambio.tarjetaId, cambio.creadoEn);
  const abiertas = ultimoDe.size
    ? await prisma.tarjetaTablero.findMany({
        where: { id: { in: [...ultimoDe.keys()] }, borradoEn: null, archivadaEn: null, estado: { in: ESTADOS_EN_LISTA } },
        take: MAX_SEMANA,
        select: SELECT_ARCHIVADA,
      })
    : [];
  const lista = [
    ...archivadas.map((fila) => aVistaArchivada(fila)),
    ...abiertas.map((fila) => aVistaArchivada(fila, ultimoDe.get(fila.id))),
  ]
    .sort((a, b) => Date.parse(a.terminadaEn) - Date.parse(b.terminadaEn))
    .slice(0, MAX_SEMANA);
  return { semana: { lunes: semana.lunes, domingo: semana.domingo }, tarjetas: lista };
}
