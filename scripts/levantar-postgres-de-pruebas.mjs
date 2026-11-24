// Levanta en Docker un Postgres de la MISMA versión mayor que producción para las pruebas de SQL, y lo apaga.
//   import { levantar, apagar } from "./levantar-postgres-de-pruebas.mjs";
//   const url = await levantar();   // null si no hay Docker
//   ...
//   apagar();
// La mayor se lee de src/lib/postgres-produccion.json ("mayor"): acá no se escribe a mano (lo revisa
// scripts/check-version-postgres-de-pruebas.mjs). El contenedor escucha solo en 127.0.0.1, en un puerto
// libre, con una contraseña al azar y --rm: al apagarlo no queda nada.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESPERA_MAXIMA_MS = 90_000;

export function mayorDeProduccion() {
  const { mayor } = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
  if (!Number.isInteger(mayor)) throw new Error('src/lib/postgres-produccion.json no tiene un "mayor" entero');
  return mayor;
}

export function imagenDePostgres() {
  return `postgres:${mayorDeProduccion()}-alpine`;
}

function docker(args, timeout = 30_000) {
  return spawnSync("docker", args, { encoding: "utf8", timeout });
}

export function hayDocker() {
  const resultado = docker(["info", "--format", "{{.ServerVersion}}"], 20_000);
  return resultado.status === 0 && Boolean(resultado.stdout.trim());
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

async function esperarQueResponda(url) {
  const tope = Date.now() + ESPERA_MAXIMA_MS;
  let ultimoError = null;
  while (Date.now() < tope) {
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
    try {
      await cliente.connect();
      await cliente.query("SELECT 1");
      await cliente.end();
      return;
    } catch (error) {
      ultimoError = error;
      await cliente.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`el Postgres de pruebas no respondió en ${ESPERA_MAXIMA_MS / 1000} s: ${ultimoError?.message ?? "sin detalle"}`);
}

let contenedor = null;

// Devuelve la URL del Postgres (base "postgres", para crear las bases de cada prueba), o null si no hay
// Docker. Si hay Docker pero el contenedor no arranca, lanza el error.
export async function levantar() {
  if (contenedor) throw new Error("el Postgres de pruebas ya está levantado");
  if (!hayDocker()) return null;

  const imagen = imagenDePostgres();
  const puerto = await puertoLibre();
  const clave = crypto.randomBytes(18).toString("hex");
  const nombre = `postgres-de-pruebas-${crypto.randomBytes(4).toString("hex")}`;
  // La clave va por el entorno de docker (-e NOMBRE sin valor), no en la línea de comandos.
  const arranque = spawnSync(
    "docker",
    ["run", "-d", "--rm", "--name", nombre, "-e", "POSTGRES_PASSWORD", "-p", `127.0.0.1:${puerto}:5432`, imagen],
    { encoding: "utf8", timeout: 300_000, env: { ...process.env, POSTGRES_PASSWORD: clave } },
  );
  if (arranque.status !== 0) {
    throw new Error(`no arrancó ${imagen}: ${(arranque.stderr || arranque.error?.message || "").trim()}`);
  }
  contenedor = nombre;

  const url = `postgresql://postgres:${clave}@127.0.0.1:${puerto}/postgres`;
  try {
    await esperarQueResponda(url);
  } catch (error) {
    apagar();
    throw error;
  }
  return url;
}

// Apaga el contenedor (con --rm se borra solo). Si no hay uno levantado, no hace nada.
export function apagar() {
  if (!contenedor) return;
  const nombre = contenedor;
  contenedor = null;
  const resultado = docker(["stop", "--time", "5", nombre], 60_000);
  if (resultado.status !== 0) {
    console.error(`No se pudo apagar el contenedor ${nombre}: ${(resultado.stderr || "").trim()}`);
  }
}
