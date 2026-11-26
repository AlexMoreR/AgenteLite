import { Client } from "pg";

/**
 * Candado de los trabajos del reloj (`/api/cron/follows`).
 *
 * El reloj llama cada 60 s. Si una vuelta tarda más de un minuto, la siguiente arrancaba los mismos
 * trabajos encima de los que seguían corriendo, y las consultas pesadas se sumaban. Con esto cada
 * trabajo corre de a uno:
 *
 *  1. Una lista en memoria: si el trabajo ya corre en este proceso, la vuelta lo salta.
 *  2. Un candado de Postgres (`pg_try_advisory_lock`), por si hay más de un proceso: si otro lo
 *     tiene, la vuelta lo salta igual. Se pide sobre UNA conexión aparte, fuera del pool de Prisma,
 *     la misma para todos los candados (un candado de sesión solo se suelta en la conexión que lo
 *     tomó, por eso no puede ir por el pool).
 *  3. Se suelta siempre en el `finally`, aunque el trabajo dé error. Y si esa conexión se cae,
 *     Postgres suelta solo todos sus candados.
 *
 * Si la conexión de candados falla, el trabajo corre igual, sin candado, como antes: se escribe un
 * aviso, se cierra esa conexión y se pide una nueva la próxima vez (con una pausa corta, para que
 * una base que no contesta no le sume la espera de la conexión a cada trabajo de la vuelta).
 *
 * Cada trabajo que corre deja `[cron] <trabajo> ms=<n>`; el que se salta, `[cron] saltado: <trabajo>
 * sigue corriendo`. Solo usa funciones que existen en todas las versiones de Postgres (nada de la 16).
 */

/** Lo mínimo que se usa de la conexión. Las pruebas la reemplazan por una de mentira. */
export type ConexionDeCandados = {
  query: (sql: string, valores: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

const SQL_TOMAR = "SELECT pg_try_advisory_lock(hashtext('cron:' || $1)) AS tomado";
const SQL_SOLTAR = "SELECT pg_advisory_unlock(hashtext('cron:' || $1)) AS soltado";

/** Tras una falla de la conexión, cuánto se espera antes de pedir otra (mientras, sin candado). */
export const PAUSA_TRAS_FALLA_MS = 30_000;

const enCurso = new Set<string>();

async function conexionReal(): Promise<ConexionDeCandados> {
  const cliente = new Client({
    connectionString: process.env.DATABASE_URL,
    keepAlive: true,
    // Si la base no atiende, fallar rápido: el trabajo corre igual sin candado.
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  // Sin este listener, una conexión que se cae tumba el proceso entero (igual que en src/lib/prisma.ts).
  cliente.on("error", (error: unknown) => {
    console.warn("[cron] se cayó la conexión de candados; se pide otra en la próxima vuelta", resumen(error));
    // Solo se descarta si sigue siendo la actual (puede que ya se haya pedido otra).
    const actual = conexionActual;
    if (actual) actual.then((c) => c === cliente && descartar(actual), () => {});
  });
  await cliente.connect();
  return cliente as ConexionDeCandados;
}

let fabrica: () => Promise<ConexionDeCandados> = conexionReal;
let conexionActual: Promise<ConexionDeCandados> | null = null;
let fallaEn = 0;
let ahora: () => number = () => Date.now();

function resumen(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Cierra la conexión (si es la actual) para que la próxima vez se pida una nueva. */
function descartar(conexion: Promise<ConexionDeCandados> | null) {
  if (!conexion || conexion !== conexionActual) return;
  conexionActual = null;
  fallaEn = ahora();
  conexion.then((c) => c.end()).catch(() => {});
}

function obtenerConexion(): Promise<ConexionDeCandados> | null {
  if (conexionActual) return conexionActual;
  if (fallaEn && ahora() - fallaEn < PAUSA_TRAS_FALLA_MS) return null;
  conexionActual = fabrica();
  // Si no conecta, se descarta acá; quien la esperaba recibe el error y corre sin candado.
  const esta = conexionActual;
  esta.catch(() => descartar(esta));
  return esta;
}

/**
 * Corre `fn` con el candado `nombre`. Devuelve lo que devuelve `fn`, o `null` si se saltó porque el
 * trabajo sigue corriendo. Los errores de `fn` se relanzan tal cual (el candado ya quedó suelto).
 */
export async function conCandado<T>(nombre: string, fn: () => Promise<T>): Promise<T | null> {
  if (enCurso.has(nombre)) {
    console.log(`[cron] saltado: ${nombre} sigue corriendo`);
    return null;
  }
  enCurso.add(nombre);
  const inicio = ahora();
  let corrio = false;
  let conCandadoTomado: Promise<ConexionDeCandados> | null = null;
  try {
    const pedida = obtenerConexion();
    if (pedida) {
      try {
        const conexion = await pedida;
        const respuesta = await conexion.query(SQL_TOMAR, [nombre]);
        if (respuesta.rows[0]?.tomado !== true) {
          console.log(`[cron] saltado: ${nombre} sigue corriendo`);
          return null;
        }
        conCandadoTomado = pedida;
      } catch (error) {
        console.warn(`[cron] sin candado para ${nombre} (corre igual): ${resumen(error)}`);
        descartar(pedida);
      }
    }
    corrio = true;
    return await fn();
  } finally {
    if (conCandadoTomado) {
      try {
        const conexion = await conCandadoTomado;
        await conexion.query(SQL_SOLTAR, [nombre]);
      } catch (error) {
        // Si no se pudo soltar, se cierra la conexión: Postgres suelta solo los candados de esa sesión.
        console.warn(`[cron] no se pudo soltar el candado de ${nombre}; se cierra la conexión: ${resumen(error)}`);
        descartar(conCandadoTomado);
      }
    }
    enCurso.delete(nombre);
    if (corrio) console.log(`[cron] ${nombre} ms=${ahora() - inicio}`);
  }
}

/**
 * Solo para pruebas: reemplaza la conexión de candados por una de mentira (o vuelve a la real con
 * `null`) y deja todo como recién arrancado. `reloj` reemplaza a `Date.now`.
 */
export function reemplazarConexionDeCandados(
  nueva: (() => Promise<ConexionDeCandados>) | null,
  reloj: (() => number) | null = null,
) {
  fabrica = nueva ?? conexionReal;
  ahora = reloj ?? (() => Date.now());
  conexionActual = null;
  fallaEn = 0;
  enCurso.clear();
}

/** Los trabajos que están corriendo ahora en este proceso (para pruebas y diagnóstico). */
export function trabajosEnCurso(): string[] {
  return [...enCurso];
}
