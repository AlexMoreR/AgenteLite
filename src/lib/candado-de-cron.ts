import { Client } from "pg";

/**
 * Candado de los trabajos del reloj (/api/cron/follows).
 *
 * El reloj llama a la ruta cada 60 s, pero un trabajo pesado (o uno que va con `after()`) puede
 * tardar más que eso: la vuelta siguiente lo arrancaba otra vez encima del primero y los dos se
 * pisaban (mismas filas, el doble de consultas). `conCandado(nombre, fn)` deja correr UNA sola copia
 * de cada trabajo:
 *
 *  1. Una lista en memoria (`Set`): si el trabajo ya corre en este proceso, se salta la vuelta.
 *  2. Un candado de Postgres (`pg_try_advisory_lock`), para el caso de dos procesos a la vez (por
 *     ejemplo, el contenedor viejo y el nuevo durante un despliegue). Si otro lo tiene, se salta igual.
 *
 * El candado se pide sobre UNA sola conexión aparte, la misma para todos los trabajos y fuera del
 * pool de Prisma: así no le quita conexiones a las pantallas. Es un candado de sesión, así que si esa
 * conexión se cae, Postgres suelta solo todos sus candados: ninguno puede quedar pegado para siempre.
 *
 * Si la conexión de candados falla, el trabajo corre igual, como antes de este archivo (solo con la
 * lista en memoria): se escribe un aviso, se cierra la conexión y se pide una nueva la próxima vuelta.
 *
 * Cada trabajo que corre deja `[cron] <trabajo> ms=<n>`; uno saltado, `[cron] saltado: <trabajo> sigue corriendo`.
 * Solo usa funciones que existen en todas las versiones de Postgres que tiene producción (nada de Postgres 16).
 */

/** Lo único que este archivo usa de la conexión. En las pruebas se reemplaza por una de mentira. */
export type ConexionDeCandados = {
  query(sql: string, parametros: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

type FabricaDeConexion = (alCaerse: () => void) => Promise<ConexionDeCandados>;

const SQL_TOMAR = "SELECT pg_try_advisory_lock(hashtext('cron:' || $1)) AS tomado";
const SQL_SOLTAR = "SELECT pg_advisory_unlock(hashtext('cron:' || $1)) AS soltado";

/** Tras una falla de la conexión, cuánto se espera para pedir otra (más o menos una vuelta del reloj). */
const ESPERA_TRAS_FALLA_MS = 30_000;

const enCurso = new Set<string>();
let conexion: Promise<ConexionDeCandados> | null = null;
let ultimaFalla = 0;

async function crearConexionReal(alCaerse: () => void): Promise<ConexionDeCandados> {
  const cliente = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "aizen-candados-cron",
    keepAlive: true,
    // Si la base no atiende, fallar rápido: el trabajo corre igual sin candado.
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  // Sin este listener, una conexión que se cae estando quieta tumba el proceso entero (igual que en prisma.ts).
  cliente.on("error", (error: unknown) => {
    console.warn("[cron] se cayó la conexión de candados (se pide otra la próxima vez)", error);
    alCaerse();
  });
  await cliente.connect();
  return cliente as ConexionDeCandados;
}

let fabrica: FabricaDeConexion = crearConexionReal;

/** Cierra la conexión de candados (si es la actual) para que la próxima vez se pida una nueva. */
function descartar(promesa: Promise<ConexionDeCandados> | null) {
  if (!promesa || conexion !== promesa) return;
  conexion = null;
  ultimaFalla = Date.now();
  promesa.then((c) => c.end()).catch(() => {});
}

async function obtenerConexion(): Promise<ConexionDeCandados | null> {
  if (!conexion) {
    if (Date.now() - ultimaFalla < ESPERA_TRAS_FALLA_MS) return null;
    const nueva: Promise<ConexionDeCandados> = fabrica(() => descartar(nueva));
    conexion = nueva;
  }
  const actual = conexion;
  try {
    return await actual;
  } catch (error) {
    console.warn("[cron] no se pudo abrir la conexión de candados; el trabajo corre sin candado", error);
    descartar(actual);
    return null;
  }
}

/** Pide el candado. "ocupado" = otro proceso lo tiene; null = sin conexión, se corre sin candado. */
async function tomar(nombre: string): Promise<ConexionDeCandados | "ocupado" | null> {
  const c = await obtenerConexion();
  if (!c) return null;
  try {
    const { rows } = await c.query(SQL_TOMAR, [nombre]);
    return rows[0]?.tomado === true ? c : "ocupado";
  } catch (error) {
    console.warn(`[cron] falló el candado de ${nombre}; el trabajo corre sin candado`, error);
    descartar(conexion);
    return null;
  }
}

async function soltar(c: ConexionDeCandados, nombre: string) {
  try {
    const { rows } = await c.query(SQL_SOLTAR, [nombre]);
    if (rows[0]?.soltado !== true) console.warn(`[cron] el candado de ${nombre} ya no estaba tomado`);
  } catch (error) {
    // Al cerrar la conexión, Postgres suelta solo el candado.
    console.warn(`[cron] no se pudo soltar el candado de ${nombre}; se cierra la conexión de candados`, error);
    descartar(conexion);
  }
}

/**
 * Corre `fn` solo si el trabajo `nombre` no está corriendo ya (en este proceso o en otro).
 * Devuelve lo que devuelve `fn`, o `null` si se saltó la vuelta. Si `fn` lanza, el error sale igual
 * (lo atrapa el try/catch de siempre de la ruta) y el candado se suelta en el `finally`.
 */
export async function conCandado<T>(nombre: string, fn: () => Promise<T> | T): Promise<T | null> {
  if (enCurso.has(nombre)) {
    console.log(`[cron] saltado: ${nombre} sigue corriendo`);
    return null;
  }
  enCurso.add(nombre);
  const inicio = Date.now();
  let candado: ConexionDeCandados | "ocupado" | null = null;
  try {
    candado = await tomar(nombre);
    if (candado === "ocupado") {
      console.log(`[cron] saltado: ${nombre} sigue corriendo`);
      return null;
    }
    return await fn();
  } finally {
    if (candado && candado !== "ocupado") await soltar(candado, nombre);
    enCurso.delete(nombre);
    if (candado !== "ocupado") console.log(`[cron] ${nombre} ms=${Date.now() - inicio}`);
  }
}

/** Solo para pruebas: reemplaza la conexión por una de mentira (null vuelve a la real) y limpia el estado. */
export function reemplazarConexionDeCandados(nueva: FabricaDeConexion | null) {
  fabrica = nueva ?? crearConexionReal;
  conexion = null;
  ultimaFalla = 0;
  enCurso.clear();
}

/** Solo para pruebas: los trabajos que corren ahora en este proceso. */
export function trabajosEnCurso(): string[] {
  return [...enCurso];
}
