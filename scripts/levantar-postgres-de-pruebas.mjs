// Levanta un Postgres real en Docker, de la misma versión mayor que producción, para las pruebas de SQL.
//
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const base = await levantar();   // null si no hay Docker
//   ... PRUEBAS_POSTGRES_URL = base.url ...
//   apagar();
//
// La versión mayor se lee de src/lib/postgres-produccion.json ("mayor") y nunca se escribe acá a mano
// (lo revisa scripts/check-version-postgres-de-pruebas.mjs). El contenedor usa un puerto libre de
// 127.0.0.1, una clave al azar y --rm (se borra solo al apagarlo).
//
// A mano: node scripts/levantar-postgres-de-pruebas.mjs  (lo levanta, comprueba que responde y lo apaga)
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESPERA_MAXIMA_MS = 90_000;
const BAJADA_MAXIMA_MS = 10 * 60_000;

let contenedor = null;

export function mayorDeProduccion() {
  const produccion = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
  const mayor = Number(produccion.mayor);
  if (!Number.isInteger(mayor)) throw new Error('src/lib/postgres-produccion.json no tiene un "mayor" entero');
  return mayor;
}

export const imagenDePruebas = () => `postgres:${mayorDeProduccion()}-alpine`;

export function hayDocker() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 30_000 });
  return r.status === 0;
}

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
}

function docker(args, opciones = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", ...opciones });
  if (r.error) throw new Error(`docker ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`docker ${args[0]} terminó con ${r.status}: ${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout || "").trim();
}

async function esperarQueResponda(url, nombre) {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
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
    // Si el contenedor se cayó, no tiene sentido seguir esperando.
    const vivo = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", nombre], { encoding: "utf8" });
    if (vivo.status !== 0 || vivo.stdout.trim() !== "true") throw new Error(`el contenedor ${nombre} se detuvo al arrancar`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Postgres no respondió en ${ESPERA_MAXIMA_MS / 1000} s (${ultimoError?.message ?? "sin error"})`);
}

/**
 * Arranca el contenedor y espera a que responda. Devuelve { url, imagen, nombre }, o null si no hay
 * Docker. Si hay Docker pero no arranca, lanza el error.
 */
export async function levantar() {
  if (!hayDocker()) return null;
  if (contenedor) return contenedor;
  const imagen = imagenDePruebas();
  const puerto = await puertoLibre();
  const clave = crypto.randomBytes(18).toString("hex");
  const nombre = `postgres-de-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  // La clave va por el entorno de docker (-e sin valor), no en los argumentos que se ven en ps.
  docker(["run", "-d", "--rm", "--name", nombre, "-e", "POSTGRES_PASSWORD", "-p", `127.0.0.1:${puerto}:5432`, imagen], {
    env: { ...process.env, POSTGRES_PASSWORD: clave },
    timeout: BAJADA_MAXIMA_MS,
  });
  const url = `postgresql://postgres:${clave}@127.0.0.1:${puerto}/postgres`;
  contenedor = { url, imagen, nombre };
  try {
    await esperarQueResponda(url, nombre);
  } catch (error) {
    apagar();
    throw error;
  }
  return contenedor;
}

/** Apaga el contenedor que levantó levantar() (con --rm se borra solo). Sin contenedor, no hace nada. */
export function apagar() {
  if (!contenedor) return;
  const { nombre } = contenedor;
  contenedor = null;
  const r = spawnSync("docker", ["stop", "-t", "5", nombre], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) console.error(`No se pudo apagar ${nombre}: ${(r.stderr || "").trim()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = await levantar();
  if (!base) {
    console.log("sin Docker: no se levantó Postgres de pruebas");
  } else {
    console.log(`Postgres de pruebas: ${base.imagen} (${base.nombre}) responde`);
    apagar();
  }
}
