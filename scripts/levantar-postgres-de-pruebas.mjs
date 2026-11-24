// Levanta un Postgres real de la MISMA versión mayor que producción para las pruebas de SQL, en Docker.
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const pg = await levantar();   // { url, imagen } o null si no hay Docker
//   ...                            // las pruebas leen la url en PRUEBAS_POSTGRES_URL
//   await apagar();
//
// A mano: node scripts/levantar-postgres-de-pruebas.mjs  (lo levanta, muestra la versión y lo apaga).
//
// La versión mayor se lee de src/lib/postgres-produccion.json y nunca se escribe acá: si producción
// cambia de versión, se cambia ese archivo y nada más. El contenedor va con --rm, contraseña al azar y
// un puerto libre solo en 127.0.0.1.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESPERA_MAXIMA_MS = 120_000;

let contenedor = null;

/** La versión mayor de producción, del JSON. */
export function versionMayorDeProduccion() {
  const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, "src", "lib", "postgres-produccion.json"), "utf8"));
  if (!Number.isInteger(datos.mayor)) throw new Error("src/lib/postgres-produccion.json: 'mayor' no es un entero");
  return datos.mayor;
}

export function imagenDePruebas() {
  return `postgres:${versionMayorDeProduccion()}-alpine`;
}

function docker(argumentos) {
  return spawnSync("docker", argumentos, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function hayDocker() {
  const resultado = docker(["info", "--format", "{{.ServerVersion}}"]);
  return resultado.status === 0 && Boolean(resultado.stdout.trim());
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

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function esperarQueResponda(url) {
  const pg = require("pg");
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let ultimoError = null;
  while (Date.now() < limite) {
    // Por TCP desde afuera: el arranque de la imagen pasa por un servidor temporal solo con socket,
    // así que una conexión por el puerto ya es el servidor definitivo.
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await cliente.connect();
      await cliente.query("SELECT 1");
      await cliente.end();
      return;
    } catch (error) {
      ultimoError = error;
      await cliente.end().catch(() => {});
      await dormir(500);
    }
  }
  throw new Error(`el Postgres de pruebas no respondió en ${ESPERA_MAXIMA_MS / 1000} s: ${ultimoError?.message ?? "sin detalle"}`);
}

/**
 * Deja la imagen en la máquina. Si Docker Hub no la da (p. ej. 429 por límite de descargas), la baja
 * del espejo oficial de Google (la misma imagen) y le pone el nombre de siempre.
 */
function bajarImagen(imagen) {
  if (docker(["image", "inspect", imagen]).status === 0) return;
  const deHub = docker(["pull", "-q", imagen]);
  if (deHub.status === 0) return;
  const espejo = `mirror.gcr.io/library/${imagen}`;
  const delEspejo = docker(["pull", "-q", espejo]);
  if (delEspejo.status === 0 && docker(["tag", espejo, imagen]).status === 0) return;
  throw new Error(
    `no se pudo bajar ${imagen}: ${(deHub.stderr || "").trim()} / espejo: ${(delEspejo.stderr || "").trim()}`,
  );
}

/**
 * Arranca postgres:<mayor>-alpine. Devuelve { url, imagen, contenedor }, o null si no hay Docker.
 * Si hay Docker pero el contenedor no arranca o no responde, lanza el error.
 */
export async function levantar() {
  if (contenedor) return contenedor;
  if (!hayDocker()) return null;

  const imagen = imagenDePruebas();
  bajarImagen(imagen);
  const clave = crypto.randomBytes(18).toString("hex");
  const nombre = `postgres-de-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  const puerto = await puertoLibre();
  const arranque = docker([
    "run", "-d", "--rm",
    "--name", nombre,
    "-e", `POSTGRES_PASSWORD=${clave}`,
    "-p", `127.0.0.1:${puerto}:5432`,
    imagen,
  ]);
  if (arranque.status !== 0) {
    throw new Error(`docker run ${imagen} falló: ${(arranque.stderr || arranque.stdout || "").trim()}`);
  }

  const url = `postgresql://postgres:${clave}@127.0.0.1:${puerto}/postgres`;
  contenedor = { url, imagen, nombre };
  try {
    await esperarQueResponda(url);
  } catch (error) {
    await apagar();
    throw error;
  }
  return contenedor;
}

/** Apaga el contenedor que levantó levantar() (con --rm se borra solo). No falla si ya no está. */
export async function apagar() {
  if (!contenedor) return;
  const { nombre } = contenedor;
  contenedor = null;
  docker(["stop", "-t", "5", nombre]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const levantado = await levantar();
  if (!levantado) {
    console.log("sin Docker: no se levantó ningún Postgres de pruebas");
    process.exit(0);
  }
  try {
    const pg = require("pg");
    const cliente = new pg.Client({ connectionString: levantado.url });
    await cliente.connect();
    const { rows } = await cliente.query("SHOW server_version");
    await cliente.end();
    console.log(`Postgres de pruebas: ${levantado.imagen} (versión ${rows[0].server_version})`);
  } finally {
    await apagar();
  }
}
