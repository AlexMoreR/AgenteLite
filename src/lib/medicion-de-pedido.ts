import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Dos datos para las lineas [timing] de las rutas de Chats (ver server-timing.ts):
 *
 *  - `consultas`: cuantas consultas SQL mando ESTE pedido a Postgres. Se cuenta en el pool
 *    (prisma.ts), asi que es el numero real de idas a la base, no el de llamadas a Prisma (una
 *    llamada con relaciones son varias consultas).
 *  - `poolEspera`: cuantos pedidos estaban esperando una conexion libre del pool cuando empezo
 *    este. Si sube en las rafagas, el cuello es el pool y no la base.
 *
 * Medir no puede romper un pedido: todo lo de aca es best-effort.
 */
type Contador = { consultas: number };

const contexto = new AsyncLocalStorage<Contador>();

type PoolMedible = { waitingCount: number; totalCount: number; idleCount: number };
let poolRegistrado: PoolMedible | null = null;

export function registrarPoolParaMedir(pool: PoolMedible) {
  poolRegistrado = pool;
}

/** Pedidos esperando conexion en este momento (null si el pool aun no existe). */
export function esperaDelPool(): number | null {
  try {
    return poolRegistrado ? poolRegistrado.waitingCount : null;
  } catch {
    return null;
  }
}

/** Lo llama el pool por cada consulta. Fuera de un pedido medido no hace nada. */
export function contarConsulta() {
  const contador = contexto.getStore();
  if (contador) {
    contador.consultas += 1;
  }
}

/** Corre `fn` contando sus consultas. */
export function medirPedido<T>(fn: () => Promise<T>): { contador: Contador; resultado: Promise<T> } {
  const contador: Contador = { consultas: 0 };
  return { contador, resultado: contexto.run(contador, fn) };
}
