import { CacheConTtl } from "@/lib/cache-en-memoria";

/**
 * Memoria corta de la RESPUESTA de /api/cliente/chats/counts (30 s).
 *
 * Medido en produccion (19-11-2026): ~100 llamadas por hora, 636 ms de media y hasta 1,4 s, con
 * 17-29 consultas por llamada. Los numeros de las pestanas se piden cada pocos segundos por cada
 * pestana abierta, con los mismos filtros.
 *
 * La clave es negocio + persona + TODOS los parametros de la direccion (buscador, conexion, estado,
 * asignacion, condiciones, grupo): dos personas, o dos filtros distintos, nunca comparten entrada,
 * asi que no cambia lo que ve cada asesora. La autenticacion y el acceso al modulo se revisan en
 * CADA pedido, antes de mirar la memoria. Pedidos iguales y simultaneos comparten una sola carga.
 * Un error no se guarda. Un numero puede tardar hasta 30 s en reflejar un cambio.
 */
export const TTL_CONTADORES_MS = 30_000;

export const cacheDeContadores = new CacheConTtl<unknown>({ ttlMs: TTL_CONTADORES_MS, maxEntradas: 300 });

/** Lo que hace distinta una respuesta de otra. Funcion pura (los parametros van ordenados). */
export function claveDeContadores(input: { workspaceId: string; userId: string; busqueda: string }): string {
  const parametros = [...new URLSearchParams(input.busqueda).entries()]
    .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
    .map(([clave, valor]) => `${encodeURIComponent(clave)}=${encodeURIComponent(valor)}`)
    .join("&");
  return `${input.workspaceId}|${input.userId}|${parametros}`;
}
