/*
  T-691 (7-nov-2026, pedido del dueño): una tarjeta que pasa a HECHO se archiva en ese mismo momento.

  Antes se quedaba 3 días a la vista (Tabla, Tablero y sobre todo el Mapa) hasta que el reloj diario la archivaba
  (archivadas.ts). Ahora, apenas se le pone estado HECHO, se le pone también `archivadaEn` y `terminadaEn`.

  Archivar NO cambia el estado ni borra nada: sigue HECHO, con su commit, plan e historial, y se ve en "Trabajos
  terminados" y en listar_terminadas. Las FALLIDO NO entran aquí: siguen archivándose a los 3 días.

  Va en el cliente de la base (lib/prisma.ts) y no en cada escritura porque la tarjeta pasa a HECHO por muchos
  caminos (el Coordinador, el trabajador al subir, "ya hecha", marcar a mano, el cierre de una madre, deshacer un
  cambio...) y así ninguno puede olvidarlo. Este archivo no importa Prisma a propósito (prisma.ts lo importa a él).

  Una tarjeta HECHO se archiva aunque tenga hijas abiertas (decisión del dueño, 7-nov-2026).

  Al revés también: si la escritura la deja en un estado ABIERTO (la reabren, reintentan o deshacen), se desarchiva
  sola. Ya lo hacen algunos caminos (tableros.ts: alReabrir), pero ahora que casi toda HECHO queda archivada, una que
  se reabra por un camino que lo olvide quedaría escondida del tablero para siempre.
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
 * Si la escritura deja una tarjeta en HECHO, le suma archivadaEn y terminadaEn (ahora); si la deja en un estado abierto, se los quita. No toca nada más: lo que ya
 * trae `archivadaEn` (el reloj, desarchivar) se respeta, y cualquier otro modelo, operación o estado queda igual.
 */
export function conArchivadoAlTerminar<T>(model: string | undefined, operation: string, args: T, ahora: Date = new Date()): T {
  if (model !== "TarjetaTablero" || !OPERACIONES.has(operation) || !esObjeto(args) || !esObjeto(args.data)) return args;
  const data = args.data;
  const estado = estadoQuePone(data);
  if (estado === null || data.archivadaEn !== undefined) return args;
  if (!TERMINADOS.has(estado)) {
    return { ...args, data: { ...data, archivadaEn: null, ...(data.terminadaEn === undefined ? { terminadaEn: null } : {}) } } as T;
  }
  if (estado !== "HECHO") return args;
  return {
    ...args,
    data: { ...data, archivadaEn: ahora, ...(data.terminadaEn === undefined ? { terminadaEn: ahora } : {}) },
  } as T;
}
