// Levanta un Postgres real para las pruebas, de la MISMA versión mayor que producción, con Docker.
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const postgres = await levantar(); // null si no hay Docker; si no, { url, imagen }
//   ...
//   apagar();
// A mano: node scripts/levantar-postgres-de-pruebas.mjs  (lo levanta, muestra la imagen y lo apaga).
//
// La versión mayor sale de src/lib/postgres-produccion.json: acá nunca se escribe a mano (lo revisa
// scripts/check-version-postgres-de-pruebas.mjs). El contenedor usa un puerto libre que elige Docker,
// una contraseña al azar y --rm, así al apagarlo no queda nada.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOPE_DE_ESPERA_MS = 90_000;

let contenedor = null;

export function leerMayorDeProduccion() {
  const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, "src", "lib", "postgres-produccion.json"), "utf8"));
  if (!Number.isInteger(datos.mayor)) throw new Error("src/lib/postgres-produccion.json: `mayor` no es un entero");
  return datos.mayor;
}

const docker = (args, opciones = {}) => spawnSync("docker", args, { encoding: "utf8", ...opciones });

export function hayDocker() {
  const r = docker(["info"], { stdio: "ignore", timeout: 30_000 });
  return r.status === 0;
}

const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

async function esperarQueResponda(url) {
  const limite = Date.now() + TOPE_DE_ESPERA_MS;
  let ultimo = null;
  while (Date.now() < limite) {
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await cliente.connect();
      await cliente.query("SELECT 1");
      await cliente.end();
      return;
    } catch (error) {
      ultimo = error;
      await cliente.end().catch(() => {});
      await esperar(1000);
    }
  }
  throw new Error(`Postgres de pruebas no respondió en ${TOPE_DE_ESPERA_MS / 1000} s: ${ultimo?.message ?? "sin detalle"}`);
}

/** Levanta postgres:<mayor>-alpine. Devuelve null si no hay Docker y { url, imagen } si quedó listo. */
export async function levantar() {
  if (contenedor) return { url: contenedor.url, imagen: contenedor.imagen };
  if (!hayDocker()) return null;

  const imagen = `postgres:${leerMayorDeProduccion()}-alpine`;
  const nombre = `aizen-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  const clave = crypto.randomBytes(18).toString("hex");
  // -p 127.0.0.1::5432 → Docker elige un puerto libre de la máquina, solo en localhost.
  const arranque = docker(
    ["run", "-d", "--rm", "--name", nombre, "-e", `POSTGRES_PASSWORD=${clave}`, "-p", "127.0.0.1::5432", imagen],
    { timeout: 300_000 },
  );
  if (arranque.status !== 0) {
    throw new Error(`docker run ${imagen} falló: ${(arranque.stderr || arranque.error?.message || "").trim()}`);
  }
  contenedor = { nombre, imagen, url: null };

  const puerto = docker(["port", nombre, "5432/tcp"], { timeout: 30_000 });
  const encontrado = /:(\d+)\s*$/m.exec(puerto.stdout ?? "");
  if (puerto.status !== 0 || !encontrado) {
    apagar();
    throw new Error(`No se pudo leer el puerto del contenedor ${nombre}: ${(puerto.stderr ?? "").trim()}`);
  }
  const url = `postgresql://postgres:${clave}@127.0.0.1:${encontrado[1]}/postgres`;
  try {
    await esperarQueResponda(url);
  } catch (error) {
    apagar();
    throw error;
  }
  contenedor.url = url;
  return { url, imagen };
}

/** Apaga el contenedor (con --rm se borra solo). No hace nada si no se levantó. */
export function apagar() {
  if (!contenedor) return;
  docker(["stop", "-t", "5", contenedor.nombre], { stdio: "ignore", timeout: 60_000 });
  contenedor = null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const postgres = await levantar();
    console.log(postgres ? `Postgres de pruebas: ${postgres.imagen} (listo; se apaga ahora)` : "sin Docker: no se levantó nada");
  } finally {
    apagar();
  }
}
