import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { invalidarTrasEscritura } from "@/lib/cache-de-permisos";
import { contarConsulta, registrarPoolParaMedir } from "@/lib/medicion-de-pedido";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;

function hasFollowDelegates(client: PrismaClient) {
  return "followRule" in client && "follow" in client;
}

/**
 * Pool de conexiones a Postgres.
 *
 * La base es un Postgres en el mismo servidor, por la red de Docker (antes este comentario decia
 * "remota": ya no lo es). Aun asi las conexiones inactivas se pueden cortar solas (un reinicio
 * de Postgres, la red de Docker, el propio servidor). Eso aparecía en los logs como
 * "prisma:error Connection terminated unexpectedly", y la pantalla que estuviera cargando en
 * ese momento moría con "Application error". Visto en producción el 29-jul-2026.
 *
 * Dos cosas faltaban:
 *
 *  - `keepAlive`: sin esto, una conexión que estuvo quieta un rato se corta en silencio y el
 *    pool la entrega igual; el error recién aparece al ejecutar la consulta, ya en medio de
 *    una pantalla.
 *
 *  - El listener de `error`: `pg` avisa por ahí cuando se cae una conexión INACTIVA (no la
 *    que está ejecutando algo). Si nadie escucha ese evento, Node lo trata como excepción no
 *    controlada y **se cae el proceso entero** — con él, todas las pantallas que estuvieran
 *    cargando en ese instante. Escucharlo y anotarlo convierte una caída del servidor en una
 *    línea de log.
 *
 * `max: 20` (08-10-2026). El default de `pg` es 10, y la bandeja hacia ~15 consultas por pedido
 * con varias pestañas refrescando a la vez: en las rafagas los pedidos hacian cola esperando
 * conexion (el paso "auth" llegaba a 3 s sin que la base estuviera cargada). 20 deja margen con
 * Postgres: su `max_connections` NO esta en este repo (es la config del contenedor de la base,
 * por defecto 100); hay una sola replica de la app, asi que esta app usa como mucho 20. Si algun
 * dia se suben replicas, revisar que replicas x 20 quede por debajo de `max_connections`.
 * La cola se ve en las lineas [timing] como `poolEspera`.
 */
const POOL_MAX_CONEXIONES = 20;

function createPool() {
  const pool = new Pool({
    connectionString,
    max: POOL_MAX_CONEXIONES,
    // Mantiene viva la conexión para que la red no la corte por quieta.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Si la base no atiende, fallar rápido y claro en vez de dejar la pantalla colgada.
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error: unknown) => {
    console.error("[prisma] se cayó una conexión inactiva (recuperado, no tumba el proceso)", error);
  });

  // Cuenta cada consulta para el campo `consultas` de las lineas [timing] (medicion-de-pedido.ts).
  // Son las que Prisma manda fuera de una transaccion, que es todo lo que hacen las rutas de Chats.
  const consultaOriginal = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  (pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    contarConsulta();
    return consultaOriginal(...args);
  };
  registrarPoolParaMedir(pool);

  return pool;
}

/**
 * Reintento para las fallas PASAJERAS de la base.
 *
 * Postgres tiene un estado en el que rechaza TODA consulta por unos segundos y responde
 * `57P03 the database system is in recovery mode`. Pasa cuando un proceso interno se cae: el
 * servidor mata las sesiones, se recompone y sigue — sin reiniciarse (por eso la base figura
 * con 61 días encendida aunque esto ocurra). Medido en produccion el 29-jul-2026 a las
 * 13:54:37, el minuto exacto en que a Alex se le cayo la pantalla de chats.
 *
 * Mientras dura, cualquier pantalla que estuviera cargando muere. Reintentar un instante
 * despues lo vuelve invisible: la asesora no se entera de nada.
 *
 * SOLO se reintenta cuando la consulta NO llego a ejecutarse (la base contesto "ahora no
 * puedo" o ni siquiera se pudo conectar). Nunca se reintenta una consulta que pudo haber
 * corrido a medias: duplicaria un mensaje enviado o un contacto.
 */
const TRANSIENT_DB_CODES = ["57P03", "57P01", "57P02", "08006", "08001", "08004"];
const MAX_DB_RETRIES = 3;
const DB_RETRY_DELAY_MS = 350;

function isTransientDbError(error: unknown) {
  const text = error instanceof Error ? `${error.message}` : String(error);
  return (
    TRANSIENT_DB_CODES.some((code) => text.includes(code)) ||
    // Prisma no siempre expone el codigo: a veces solo trae el texto. Se cubren las dos formas.
    /is in recovery mode|starting up|cannot connect now|Connection refused|Can't reach database server|Connection terminated unexpectedly/i.test(
      text,
    )
  );
}

function withTransientRetry(client: PrismaClient) {
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        let lastError: unknown = null;
        /*
          Las caches de permisos de la bandeja (cache-de-permisos.ts) se vacian despues de CADA
          escritura de usuarios, miembros, negocios, canales o AppSetting, salga bien o mal (una
          que fallo pudo haber llegado a escribir). Asi ninguna accion de administracion tiene que
          acordarse de invalidar. Es sincrono y no toca la base.
        */
        const invalidar = () => {
          try {
            invalidarTrasEscritura(model, operation, args);
          } catch {
            // Invalidar nunca rompe una escritura.
          }
        };

        for (let attempt = 0; attempt <= MAX_DB_RETRIES; attempt += 1) {
          try {
            const resultado = await query(args);
            invalidar();
            return resultado;
          } catch (error) {
            invalidar();
            if (!isTransientDbError(error)) {
              throw error;
            }
            lastError = error;
            if (attempt < MAX_DB_RETRIES) {
              console.warn(
                `[prisma] la base contesto "ahora no puedo"; reintento ${attempt + 1}/${MAX_DB_RETRIES}`,
              );
              await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS * (attempt + 1)));
            }
          }
        }

        throw lastError;
      },
    },
  }) as unknown as PrismaClient;
}

function createPrismaClient() {
  return withTransientRetry(
    new PrismaClient({
      adapter: new PrismaPg(createPool()),
      log: ["error", "warn"],
    }),
  );
}

function resolvePrismaClient() {
  const existingClient = globalForPrisma.prisma;

  if (existingClient && hasFollowDelegates(existingClient)) {
    return existingClient;
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolvePrismaClient();
    const value = Reflect.get(client as object, property, client);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
  set(_target, property, value) {
    const client = resolvePrismaClient();
    Reflect.set(client, property, value, client);
    return true;
  },
  has(_target, property) {
    const client = resolvePrismaClient();
    return Reflect.has(client, property);
  },
  ownKeys() {
    const client = resolvePrismaClient();
    return Reflect.ownKeys(client);
  },
  getOwnPropertyDescriptor(_target, property) {
    const client = resolvePrismaClient();
    return Object.getOwnPropertyDescriptor(client, property);
  },
}) as PrismaClient;
