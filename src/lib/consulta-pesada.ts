import type { Prisma } from "@prisma/client";
import type { CacheConTtl } from "@/lib/cache-en-memoria";

/**
 * Freno a las consultas pesadas: tiempo maximo, maximo 3 a la vez y copia de reserva.
 *
 * Nace de medir produccion (nov-2026): unas pocas consultas muy pesadas (hasta 61 s) se comian la
 * CPU de la base y ponian lento TODO el CRM, aunque el resto de las consultas fueran chicas. El
 * cuello es la CPU, no las conexiones: por eso el pool sigue en 20 (`src/lib/prisma.ts` no se toca)
 * y lo que se frena es cuantas pesadas corren a la vez y cuanto puede durar cada una.
 *
 * - Tope: cada consulta corre en su propia transaccion con `SET LOCAL statement_timeout` (el mismo
 *   patron de `features/archivos-de-mensajes/servicios/base-de-produccion.ts`). Paginas 8 s, crons
 *   20 s; Mi Dia pide 15 s con `topeSegundos`. Si la base tarda mas, Postgres la cancela y la
 *   llamada lanza el error: no se queda ocupando la CPU un minuto.
 * - Semaforo: nunca hay mas de `LIMITE` (3) pesadas a la vez. Hay UNA sola replica del contenedor,
 *   asi que un contador en memoria alcanza. Con el semaforo lleno, si la llamada trae `cache` +
 *   `clave` y hay una copia buena guardada (aunque este vencida), se devuelve esa copia; si no,
 *   espera turno (~2 s en paginas, hasta su tope en crons) y despues corre o lanza un error.
 * - Cache: con `cache` + `clave` usa `cache.obtener`, asi dos pedidos dentro del TTL hacen UNA
 *   consulta. Un error no se guarda.
 *
 * Este archivo no toca la base al importarse: `@/lib/prisma` se importa recien en la primera
 * consulta (las pruebas cargan modulos que lo usan con un prisma falso).
 */

export type ModoConsultaPesada = "pagina" | "cron";

/** Tope de una consulta pesada de una pagina, en segundos. */
export const TOPE_PAGINA_SEGUNDOS = 8;
/** Tope de una consulta pesada de un cron, en segundos. */
export const TOPE_CRON_SEGUNDOS = 20;
/** Cuantas consultas pesadas pueden correr a la vez en el contenedor. */
export const LIMITE = 3;
/** Cuanto espera turno una pagina cuando el semaforo esta lleno. */
export const ESPERA_TURNO_PAGINA_MS = 2_000;
/** La transaccion completa dura el tope mas este margen (el SET LOCAL y la vuelta de los datos). */
export const MARGEN_TRANSACCION_MS = 1_500;
/** Cuanto espera la transaccion una conexion libre del pool. */
export const ESPERA_CONEXION_MS = 2_000;
/** Cuantas copias de reserva se guardan por cache, como mucho. */
const MAX_COPIAS_DE_RESERVA = 500;

export type OpcionesConsultaPesada<T> = {
  modo: ModoConsultaPesada;
  /** Tope propio en segundos, en vez del del modo. Hoy solo lo usa Mi Dia (15). */
  topeSegundos?: number;
  /** Cache con TTL donde guardar el resultado. Va junto con `clave`. */
  cache?: CacheConTtl<T>;
  clave?: string;
};

/** No se libero un turno a tiempo: hay `LIMITE` pesadas corriendo. */
export class SinTurnoParaConsultaPesada extends Error {
  constructor(esperaMs: number) {
    super(`Hay ${LIMITE} consultas pesadas corriendo y no se libero un turno en ${esperaMs} ms`);
    this.name = "SinTurnoParaConsultaPesada";
  }
}

/* ── Semaforo ── */

let enCurso = 0;
const enEspera: Array<() => void> = [];

/** Cuantas consultas pesadas estan corriendo ahora (para las pruebas y la medicion). */
export function turnosEnCurso() {
  return enCurso;
}

function semaforoLleno() {
  return enCurso >= LIMITE;
}

function liberador() {
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    const siguiente = enEspera.shift();
    if (siguiente) {
      // El turno pasa directo al que esperaba: el contador no baja.
      siguiente();
    } else {
      enCurso -= 1;
    }
  };
}

function tomarTurno(esperaMs: number): Promise<() => void> {
  if (!semaforoLleno()) {
    enCurso += 1;
    return Promise.resolve(liberador());
  }
  return new Promise((resolve, reject) => {
    const despertar = () => {
      clearTimeout(reloj);
      resolve(liberador());
    };
    const reloj = setTimeout(() => {
      const posicion = enEspera.indexOf(despertar);
      if (posicion >= 0) enEspera.splice(posicion, 1);
      reject(new SinTurnoParaConsultaPesada(esperaMs));
    }, esperaMs);
    enEspera.push(despertar);
  });
}

function topeEnSegundos(modo: ModoConsultaPesada, topeSegundos?: number) {
  const tope = topeSegundos ?? (modo === "cron" ? TOPE_CRON_SEGUNDOS : TOPE_PAGINA_SEGUNDOS);
  // Va pegado al SQL del SET LOCAL: solo un entero positivo.
  if (!Number.isInteger(tope) || tope <= 0) {
    throw new Error(`consultaPesada: topeSegundos invalido (${String(tope)})`);
  }
  return tope;
}

function esperaDeTurno(modo: ModoConsultaPesada, tope: number) {
  return modo === "cron" ? tope * 1000 : ESPERA_TURNO_PAGINA_MS;
}

/**
 * Solo el semaforo, sin transaccion ni SET LOCAL: para funciones que ya tienen su propia
 * transaccion (y su propio tope).
 */
export function conTurnoPesado<T>(modo: ModoConsultaPesada, fn: () => Promise<T>): Promise<T> {
  return conTurno(esperaDeTurno(modo, topeEnSegundos(modo)), fn);
}

async function conTurno<T>(esperaMs: number, fn: () => Promise<T>): Promise<T> {
  const liberar = await tomarTurno(esperaMs);
  try {
    return await fn();
  } finally {
    liberar();
  }
}

/* ── Copias de reserva: la ultima copia buena por clave, aparte de la cache (que vence) ── */

const reservas = new WeakMap<CacheConTtl<unknown>, Map<string, unknown>>();

function reservaDe(cache: CacheConTtl<unknown>) {
  let mapa = reservas.get(cache);
  if (!mapa) {
    mapa = new Map();
    reservas.set(cache, mapa);
  }
  return mapa;
}

function guardarReserva(cache: CacheConTtl<unknown>, clave: string, valor: unknown) {
  const mapa = reservaDe(cache);
  mapa.delete(clave);
  while (mapa.size >= MAX_COPIAS_DE_RESERVA) {
    const masVieja = mapa.keys().next().value;
    if (masVieja === undefined) break;
    mapa.delete(masVieja);
  }
  mapa.set(clave, valor);
}

/* ── La consulta ── */

async function enTransaccion<T>(tope: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // Diferido a proposito: importar este archivo no abre la base.
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${tope}s'`);
      return fn(tx);
    },
    { maxWait: ESPERA_CONEXION_MS, timeout: tope * 1000 + MARGEN_TRANSACCION_MS },
  );
}

/**
 * Corre `fn(tx)` como consulta pesada: con tope, dentro del semaforo de `LIMITE` y, si trae
 * `cache` + `clave`, con cache y copia de reserva. Cada llamada usa una sola conexion.
 */
export async function consultaPesada<T>(
  opciones: OpcionesConsultaPesada<T>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const tope = topeEnSegundos(opciones.modo, opciones.topeSegundos);
  const correr = () => conTurno(esperaDeTurno(opciones.modo, tope), () => enTransaccion(tope, fn));

  const { cache, clave } = opciones;
  if (!cache || clave === undefined) {
    return correr();
  }

  const vigente = cache.leer(clave);
  if (vigente !== undefined) {
    return vigente;
  }

  const reserva = reservaDe(cache as CacheConTtl<unknown>);
  if (semaforoLleno() && reserva.has(clave)) {
    // Mejor una copia de hace un rato que sumar una cuarta pesada (o hacer esperar la pantalla).
    return reserva.get(clave) as T;
  }

  const valor = await cache.obtener(clave, correr);
  guardarReserva(cache as CacheConTtl<unknown>, clave, valor);
  return valor;
}
