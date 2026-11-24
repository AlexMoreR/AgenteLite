// Levanta un Postgres real en Docker, de la misma versión mayor que producción, para las pruebas de SQL.
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const postgres = await levantar(); // null si no hay Docker
//   ... PRUEBAS_POSTGRES_URL = postgres.url ...
//   apagar();
//
// La versión mayor sale de src/lib/postgres-produccion.json y nunca se escribe acá: si producción
// cambia de versión, se cambia ese archivo y las pruebas siguen solas. La contraseña es al azar, el
// puerto es uno libre de 127.0.0.1 y el contenedor lleva --rm: al apagarlo no queda nada.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOPE_DE_ESPERA_MS = 90_000;
const TOPE_DE_DESCARGA_MS = 5 * 60_000;

let contenedor = null;

export function versionMayorDeProduccion() {
  const { mayor } = JSON.parse(fs.readFileSync(path.join(raiz, "src", "lib", "postgres-produccion.json"), "utf8"));
  if (!Number.isInteger(mayor)) throw new Error(`src/lib/postgres-produccion.json: "mayor" no es un entero (${mayor})`);
  return mayor;
}

export function hayDocker() {
  const resultado = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 30_000 });
  return resultado.status === 0;
}

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.on("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Reintenta conectarse por TCP hasta que responda. El servidor temporal que arranca la imagen mientras
// inicializa no escucha por TCP, así que cuando esto responde ya es el servidor de verdad.
async function esperarQueResponda(url) {
  const limite = Date.now() + TOPE_DE_ESPERA_MS;
  let ultimoError = null;
  while (Date.now() < limite) {
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
    try {
      await cliente.connect();
      await cliente.query("SELECT 1");
      return;
    } catch (error) {
      ultimoError = error;
    } finally {
      await cliente.end().catch(() => {});
    }
    await esperar(500);
  }
  throw new Error(`el Postgres de pruebas no respondió en ${TOPE_DE_ESPERA_MS / 1000} s: ${ultimoError?.message ?? "sin error"}`);
}

// Devuelve { url, imagen } o null si no hay Docker. Si hay Docker y el contenedor no arranca, lanza error.
export async function levantar() {
  if (contenedor) return { url: contenedor.url, imagen: contenedor.imagen };
  if (!hayDocker()) return null;

  const imagen = `postgres:${versionMayorDeProduccion()}-alpine`;
  const nombre = `postgres-de-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  const clave = crypto.randomBytes(18).toString("hex");
  const puerto = await puertoLibre();

  // La clave va por el entorno de docker (-e POSTGRES_PASSWORD sin valor), no en la línea de comandos.
  const arranque = spawnSync(
    "docker",
    ["run", "-d", "--rm", "--name", nombre, "-e", "POSTGRES_PASSWORD", "-p", `127.0.0.1:${puerto}:5432`, imagen],
    { encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: clave }, timeout: TOPE_DE_DESCARGA_MS },
  );
  if (arranque.status !== 0) {
    const detalle = (arranque.stderr || arranque.error?.message || "").trim();
    throw new Error(`no se pudo arrancar ${imagen}: ${detalle}`);
  }

  contenedor = { nombre, imagen, url: `postgresql://postgres:${clave}@127.0.0.1:${puerto}/postgres` };
  try {
    await esperarQueResponda(contenedor.url);
  } catch (error) {
    apagar();
    throw error;
  }
  return { url: contenedor.url, imagen };
}

// Para el contenedor (con --rm, Docker lo borra). Se puede llamar más de una vez.
export function apagar() {
  if (!contenedor) return;
  const { nombre } = contenedor;
  contenedor = null;
  spawnSync("docker", ["stop", "--time", "2", nombre], { stdio: "ignore", timeout: 60_000 });
}
