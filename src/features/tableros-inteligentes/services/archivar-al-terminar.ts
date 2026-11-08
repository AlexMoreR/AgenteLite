/*
  Regla en el cliente de la base (lib/prisma.ts) para las tarjetas del Tablero IA: una escritura que deja una tarjeta
  en un estado ABIERTO (la reabren, reintentan o deshacen) la desarchiva sola.

  Historia:
  - T-691 (7-nov-2026): aquí también se archivaba la tarjeta en el mismo momento en que pasaba a HECHO, dentro de la
    misma escritura, aunque tuviera hijas abiertas.
  - 8-nov-2026 (plan aprobado por el dueño, tarjeta f33rnfek): esa mitad se quitó. Ahora el archivado de las HECHO va
    aparte, justo después de guardar el HECHO y fuera de su transacción (archivadas.ts: archivarAlTerminar), más la red
    de seguridad del reloj cada minuto (archivarLasHechas). Así una madre HECHO con hijas abiertas se queda en el
    tablero hasta que cierren (decisión del dueño en ese plan), una HECHO desarchivada a mano no se vuelve a esconder y
    un fallo al archivar nunca frena el HECHO.

  La mitad que queda: ya lo hacen algunos caminos (tableros.ts: alReabrir), pero ahora que casi toda HECHO queda
  archivada, una que se reabra por un camino que lo olvide quedaría escondida del tablero para siempre.

  Este archivo no importa Prisma a propósito (prisma.ts lo importa a él).
*/

const OPERACIONES = new Set(["update", "updateMany"]);
const TERMINADOS = new Set(["HECHO", "FALLIDO"]);

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

/** El estado que la escritura pone, sea `{ estado: "HECHO" }` o `{ estado: { set: "HECHO" } }`; si no pone ninguno, null. */
function estadoQuePone(data: Record<string, unknown>): string | null {
  const estado = data.estado;
  if (typeof estado === "string") return estado;
  if (esObjeto(estado) && typeof estado.set === "string") return estado.set;
  return null;
}

/**
 * Si la escritura deja una tarjeta en un estado abierto, le quita archivadaEn y terminadaEn. No toca nada más: una que
 * pasa a HECHO o FALLIDO, lo que ya trae `archivadaEn` (el reloj, desarchivar) y cualquier otro modelo u operación
 * quedan igual.
 */
export function conDesarchivadoAlReabrir<T>(model: string | undefined, operation: string, args: T): T {
  if (model !== "TarjetaTablero" || !OPERACIONES.has(operation) || !esObjeto(args) || !esObjeto(args.data)) return args;
  const data = args.data;
  const estado = estadoQuePone(data);
  if (estado === null || data.archivadaEn !== undefined || TERMINADOS.has(estado)) return args;
  return { ...args, data: { ...data, archivadaEn: null, ...(data.terminadaEn === undefined ? { terminadaEn: null } : {}) } } as T;
}
