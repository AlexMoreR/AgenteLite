// Levanta un Postgres de pruebas en Docker, de la misma versión mayor que producción, y lo apaga.
//
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const url = await levantar();   // null si no hay Docker
//   ...
//   apagar();
//
// La versión mayor se lee de src/lib/postgres-produccion.json ("mayor") y no se escribe en ningún
// otro lado: test:version-postgres-de-pruebas revisa que este archivo no la tenga a mano.
// El contenedor usa la imagen postgres:<mayor>-alpine, un puerto libre de 127.0.0.1, una contraseña al
// azar (solo vive mientras corren las pruebas) y --rm: al apagarlo, Docker lo borra.
// Lo usa scripts/correr-pruebas-ci.mjs (npm test), que pasa la URL a cada prueba en PRUEBAS_POSTGRES_URL.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESPERA_MAXIMA_MS = 90_000;

let contenedor = null;

/** La versión mayor de producción, de src/lib/postgres-produccion.json. */
export function mayorDeProduccion() {
  const produccion = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
  const mayor = Number(produccion.mayor);
  if (!Number.isInteger(mayor)) throw new Error('src/lib/postgres-produccion.json no tiene un "mayor" entero');
  return mayor;
}

/** La imagen de Docker de las pruebas: postgres:<mayor>-alpine. */
export function imagenDePruebas() {
  return `postgres:${mayorDeProduccion()}-alpine`;
}

function docker(argumentos, opciones = {}) {
  return spawnSync("docker", argumentos, { encoding: "utf8", ...opciones });
}

export function hayDocker() {
  const r = docker(["info"], { stdio: "ignore", timeout: 30_000 });
  return r.status === 0;
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

async function esperarQueResponda(url) {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let ultimoError = null;
  while (Date.now() < limite) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      ultimoError = error;
      await client.end().catch(() => {});
      await esperar(1_000);
    }
  }
  throw new Error(`Postgres de pruebas no respondió en ${ESPERA_MAXIMA_MS / 1000} s: ${ultimoError?.message ?? "sin detalle"}`);
}

/**
 * Arranca el contenedor y espera a que acepte conexiones. Devuelve la URL de conexión, o null si no
 * hay Docker. Si hay Docker pero el contenedor no arranca, lanza un error (y lo apaga).
 */
export async function levantar() {
  if (contenedor) return contenedor.url;
  if (!hayDocker()) return null;

  const imagen = imagenDePruebas();
  const puerto = await puertoLibre();
  const clave = crypto.randomBytes(18).toString("hex");
  const nombre = `postgres-de-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  // La clave va por el entorno del proceso de docker, no en la línea de comandos.
  const r = docker(
    ["run", "--rm", "-d", "--name", nombre, "-e", "POSTGRES_PASSWORD", "-p", `127.0.0.1:${puerto}:5432`, imagen],
    { env: { ...process.env, POSTGRES_PASSWORD: clave }, timeout: 300_000 },
  );
  if (r.status !== 0) {
    throw new Error(`no arrancó ${imagen}: ${(r.stderr || r.error?.message || "").trim().split("\n").slice(-3).join(" | ")}`);
  }

  const url = `postgresql://postgres:${clave}@127.0.0.1:${puerto}/postgres`;
  contenedor = { nombre, url, imagen };
  try {
    await esperarQueResponda(url);
  } catch (error) {
    apagar();
    throw error;
  }
  return url;
}

/** Apaga el contenedor que levantó levantar() (con --rm, Docker lo borra). Si no hay, no hace nada. */
export function apagar() {
  if (!contenedor) return;
  const { nombre } = contenedor;
  contenedor = null;
  docker(["stop", "-t", "5", nombre], { stdio: "ignore", timeout: 60_000 });
}
