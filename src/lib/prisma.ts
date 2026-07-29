import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;

function hasFollowDelegates(client: PrismaClient) {
  return "followRule" in client && "follow" in client;
}

/**
 * Pool de conexiones a Postgres.
 *
 * La base es REMOTA, así que hay red en el medio y las conexiones inactivas se cortan solas
 * (cortafuegos, NAT, el propio servidor). Eso aparecía en los logs como
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
 */
function createPool() {
  const pool = new Pool({
    connectionString,
    // Mantiene viva la conexión para que la red no la corte por quieta.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Si la base no atiende, fallar rápido y claro en vez de dejar la pantalla colgada.
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error: unknown) => {
    console.error("[prisma] se cayó una conexión inactiva (recuperado, no tumba el proceso)", error);
  });

  return pool;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg(createPool()),
    log: ["error", "warn"],
  });
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
