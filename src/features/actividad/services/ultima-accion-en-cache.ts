/**
 * La "Última acción" de Equipo guardada 2 minutos por negocio y grupo de personas.
 *
 * Cada apertura de Equipo pedía la última acción de todo el equipo a Postgres; con varias pestañas
 * abiertas a la vez las consultas se juntaban y saturaban la base. Aquí:
 *
 * - La clave es el negocio más los userIds ordenados: el mismo equipo pedido dos veces en 2 minutos
 *   hace UNA sola consulta.
 * - Mientras una consulta está en curso se comparte su promesa (`CacheConTtl.obtener`): diez
 *   aperturas a la vez esperan la misma consulta.
 * - Si la consulta falla o pasa del tope, sale un Map vacío ("Sin acciones en 30 días") y NO se
 *   guarda: la próxima apertura vuelve a intentar.
 * - El registro `[equipo] ultima-accion ms=… personas=…` sale solo cuando de verdad se consultó la
 *   base, con lo que tardó; lo que sale de la cache no se registra.
 *
 * Hay una sola réplica del contenedor (ver `cache-en-memoria.ts`), así que la cache en memoria alcanza.
 *
 * Este archivo no importa la base de forma fija (la carga al consultar), para poder probarlo con un
 * consultor y un reloj falsos: `crearUltimaAccionEnCache`.
 */
import { CacheConTtl } from "@/lib/cache-en-memoria";
import type { UltimaAccion } from "./ultima-accion";

export const VIDA_DE_LA_ULTIMA_ACCION_MS = 120_000;
/** Un poco más que el `statement_timeout` de 5 s de la consulta: es la red de seguridad si se cuelga. */
export const TOPE_DE_LA_ULTIMA_ACCION_MS = 7_000;

export type EntradaDeUltimaAccion = { workspaceId: string; userIds: string[] };
export type ConsultorDeUltimaAccion = (entrada: EntradaDeUltimaAccion) => Promise<Map<string, UltimaAccion>>;

export type OpcionesDeUltimaAccionEnCache = {
  /** Quién consulta de verdad. Debe LANZAR si falla (no devolver un vacío), para no guardarlo. */
  consultar: ConsultorDeUltimaAccion;
  /** Reloj de la cache (vencimiento) y de la medición. Para las pruebas. */
  ahora?: () => number;
  ttlMs?: number;
  topeMs?: number;
  maxEntradas?: number;
};

/** La misma clave para el mismo equipo, venga en el orden que venga. */
export function claveDeUltimaAccion(entrada: EntradaDeUltimaAccion) {
  const userIds = [...new Set(entrada.userIds.filter(Boolean))].sort();
  return `${entrada.workspaceId}|${userIds.join(",")}`;
}

function conTope<T>(promesa: Promise<T>, topeMs: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`pasó de ${topeMs} ms`)), topeMs);
  });
  return Promise.race([promesa, tope]).finally(() => clearTimeout(reloj));
}

export function crearUltimaAccionEnCache(opciones: OpcionesDeUltimaAccionEnCache) {
  const ahora = opciones.ahora ?? Date.now;
  const topeMs = opciones.topeMs ?? TOPE_DE_LA_ULTIMA_ACCION_MS;
  const cache = new CacheConTtl<Map<string, UltimaAccion>>({
    ttlMs: opciones.ttlMs ?? VIDA_DE_LA_ULTIMA_ACCION_MS,
    maxEntradas: opciones.maxEntradas ?? 50,
    ahora,
  });

  return async function ultimaAccionEnCache(entrada: EntradaDeUltimaAccion): Promise<Map<string, UltimaAccion>> {
    const userIds = [...new Set(entrada.userIds.filter(Boolean))].sort();
    if (userIds.length === 0) return new Map();

    try {
      return await cache.obtener(claveDeUltimaAccion({ workspaceId: entrada.workspaceId, userIds }), async () => {
        const inicio = ahora();
        const resultado = await conTope(opciones.consultar({ workspaceId: entrada.workspaceId, userIds }), topeMs);
        const ms = Math.round(ahora() - inicio);
        console.info(`[equipo] ultima-accion ms=${ms} personas=${userIds.length}`);
        return resultado;
      });
    } catch (error) {
      console.warn(
        "[equipo] la última acción no se pudo leer; sale vacía y no se guarda:",
        error instanceof Error ? error.message : error,
      );
      return new Map();
    }
  };
}

/** La de la pantalla Equipo: consulta Postgres con `ultimaAccionPorPersona` (30 días, tope de 5 s). */
export const ultimaAccionEnCache = crearUltimaAccionEnCache({
  consultar: async ({ workspaceId, userIds }) => {
    const { ultimaAccionPorPersona } = await import("./actividad");
    return ultimaAccionPorPersona({ workspaceId, userIds, lanzarSiFalla: true });
  },
});
