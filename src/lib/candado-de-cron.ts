import { Client } from "pg";

/*
  Candado de los trabajos del reloj (/api/cron/follows y compañía).

  El reloj llama cada 60 s. Si un trabajo tarda más de un minuto, la vuelta siguiente lo volvía a
  arrancar encima del que seguía corriendo: dos barridos sobre los mismos chats y la base cargada
  el doble. Con esto un trabajo que sigue corriendo se SALTA la vuelta (no espera, no se encola):
  la próxima vuelta lo intenta de nuevo.

  Dos cerrojos, en este orden:
  1. Un Set en memoria: el mismo trabajo ya corre en ESTE proceso.
  2. Un candado de Postgres (pg_try_advisory_lock): el mismo trabajo corre en OTRO proceso (dos
     contenedores a la vez durante un despliegue). Va sobre UNA sola conexión aparte, fuera del
     pool de Prisma, la misma para todos los candados: así no le quita conexiones a las pantallas.
     Los candados de Postgres son de la sesión: si esa conexión se cae, Postgres los suelta todos
     solo, y un candado nunca queda pegado más allá del proceso.

  Si la conexión de candados falla, el trabajo corre igual, como antes de existir esto (solo con
  el Set): se avisa, se cierra esa conexión y la próxima vez se pide una nueva. Solo funciones que
  tiene cualquier Postgres (nada de Postgres 16).

  En los registros: `[cron] <trabajo> ms=<n>` al terminar cada trabajo y
  `[cron] saltado: <trabajo> sigue corriendo` cuando se salta.
*/

/** Lo poco que se usa de un pg.Client: se puede cambiar por uno de mentira en las pruebas. */
export type ConexionDeCandados = {
  query: (sql: string, valores: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

type Fabrica = () => Promise<ConexionDeCandados | null>;

const SQL_TOMAR = "SELECT pg_try_advisory_lock(hashtext('cron:' || $1::text)) AS tomado";
const SQL_SOLTAR = "SELECT pg_advisory_unlock(hashtext('cron:' || $1::text)) AS soltado";

const enCurso = new Set<string>();
/** La conexión que se está abriendo o ya abierta (una sola para todos los candados). */
let conexion: Promise<ConexionDeCandados | null> | null = null;
/** La misma, ya abierta: para saber si un candado se tomó en la conexión que sigue viva. */
let abierta: ConexionDeCandados | null = null;

async function conexionReal(): Promise<ConexionDeCandados | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const cliente = new Client({
    connectionString: url,
    keepAlive: true,
    // Si la base no atiende, fallar rápido: el trabajo corre igual sin candado.
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    application_name: "aizen-candados-cron",
  });
  // Sin este listener, una conexión que se cae estando quieta tumba el proceso entero.
  cliente.on("error", (error: Error) => {
    console.warn("[cron] se cayó la conexión de candados; se pide otra en la próxima vuelta", error.message);
    if (abierta === cliente) olvidarConexion();
  });
  await cliente.connect();
  return cliente;
}

let fabrica: Fabrica = conexionReal;

/** Cierra la conexión de candados (Postgres suelta solo los candados que tenía) y la olvida. */
function olvidarConexion() {
  const vieja = conexion;
  conexion = null;
  abierta = null;
  vieja
    ?.then((c) => c?.end())
    .catch(() => {
      // Ya estaba rota: no hay nada más que cerrar.
    });
}

async function pedirConexion(): Promise<ConexionDeCandados | null> {
  if (!conexion) {
    const nueva = fabrica();
    conexion = nueva;
    try {
      const c = await nueva;
      if (conexion === nueva) abierta = c;
      return c;
    } catch (error) {
      // No se pudo abrir: la próxima vez se intenta de nuevo.
      if (conexion === nueva) conexion = null;
      throw error;
    }
  }
  return conexion;
}

/** Para las pruebas: cambia la conexión por una de mentira (null vuelve a la real). */
export function usarConexionDeCandados(nueva: Fabrica | null) {
  olvidarConexion();
  fabrica = nueva ?? conexionReal;
}

/** Para las pruebas: los trabajos que corren ahora en este proceso. */
export function trabajosEnCurso(): string[] {
  return [...enCurso];
}

/**
 * Corre `fn` si el trabajo `nombre` no está corriendo ya (en este proceso ni en otro). Si ya corre,
 * no lo arranca y devuelve undefined. Los errores de `fn` se lanzan igual que sin candado; los de la
 * conexión de candados nunca: en ese caso el trabajo corre sin el candado de Postgres.
 */
export async function conCandado<T>(nombre: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  if (enCurso.has(nombre)) {
    console.info(`[cron] saltado: ${nombre} sigue corriendo`);
    return undefined;
  }
  // Se anota ANTES del primer await: dos llamadas seguidas nunca pasan las dos.
  enCurso.add(nombre);

  let conCandadoDe: ConexionDeCandados | null = null;
  try {
    const db = await pedirConexion();
    if (db) {
      const respuesta = await db.query(SQL_TOMAR, [nombre]);
      if (respuesta.rows[0]?.tomado !== true) {
        enCurso.delete(nombre);
        console.info(`[cron] saltado: ${nombre} sigue corriendo`);
        return undefined;
      }
      conCandadoDe = db;
    }
  } catch (error) {
    console.warn(
      `[cron] sin candado de Postgres para ${nombre}; corre igual`,
      error instanceof Error ? error.message : String(error),
    );
    olvidarConexion();
  }

  const inicio = Date.now();
  try {
    return await fn();
  } finally {
    if (conCandadoDe) {
      try {
        // Solo si sigue siendo la misma conexión: si se cerró, Postgres ya soltó el candado.
        if (abierta === conCandadoDe) await conCandadoDe.query(SQL_SOLTAR, [nombre]);
      } catch (error) {
        console.warn(
          `[cron] no se pudo soltar el candado de ${nombre}; se cierra la conexión (Postgres lo suelta solo)`,
          error instanceof Error ? error.message : String(error),
        );
        olvidarConexion();
      }
    }
    enCurso.delete(nombre);
    console.info(`[cron] ${nombre} ms=${Date.now() - inicio}`);
  }
}
