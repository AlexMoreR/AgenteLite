// Corre todos los scripts test:* de package.json (menos test:e2e) uno por uno, para GitHub Actions.
//   node scripts/correr-pruebas-ci.mjs
// test:e2e va contra producción y tiene su propio workflow. Si una prueba falla, sigue con las demás
// y al final lista las que fallaron y termina con error.
//
// Postgres de pruebas: si no viene PRUEBAS_POSTGRES_URL y hay Docker, levanta postgres:<mayor>-alpine
// (la mayor de src/lib/postgres-produccion.json) y pasa su URL a cada prueba; al final lo apaga, también
// si hubo fallas. Sin Docker, las pruebas de SQL corren en PGlite y avisa. Con
// PRUEBAS_POSTGRES_OBLIGATORIO=1 (GitHub Actions) no tener Docker es un error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { apagar, levantar } from "./levantar-postgres-de-pruebas.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paquete = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
const pruebas = Object.keys(paquete.scripts).filter((nombre) => nombre.startsWith("test:") && nombre !== "test:e2e");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const obligatorio = process.env.PRUEBAS_POSTGRES_OBLIGATORIO === "1";

const entorno = { ...process.env };
if (entorno.PRUEBAS_POSTGRES_URL) {
  console.log("Postgres de pruebas: el de PRUEBAS_POSTGRES_URL");
} else {
  let postgres = null;
  try {
    postgres = await levantar();
  } catch (error) {
    console.error(`No se pudo levantar el Postgres de pruebas: ${error.message}`);
    if (obligatorio) {
      console.error("PRUEBAS_POSTGRES_OBLIGATORIO=1: sin Postgres real no se corren las pruebas.");
      process.exit(1);
    }
  }
  if (postgres) {
    entorno.PRUEBAS_POSTGRES_URL = postgres.url;
    console.log(`Postgres de pruebas: ${postgres.imagen}`);
  } else {
    if (obligatorio) {
      console.error("sin Docker y PRUEBAS_POSTGRES_OBLIGATORIO=1: se necesita Docker para el Postgres de pruebas.");
      process.exit(1);
    }
    console.log("sin Docker: SQL en PGlite + chequeo estático");
  }
}

const fallaron = [];
try {
  for (const nombre of pruebas) {
    console.log(`\n=== npm run ${nombre} ===`);
    const resultado = spawnSync(npm, ["run", nombre], { cwd: raiz, stdio: "inherit", env: entorno, shell: process.platform === "win32" });
    if (resultado.status !== 0) fallaron.push(nombre);
  }
} finally {
  apagar();
}

console.log(`\n${pruebas.length - fallaron.length} de ${pruebas.length} pruebas pasaron.`);
if (fallaron.length > 0) {
  console.error(`Fallaron ${fallaron.length}:\n${fallaron.map((nombre) => `  - ${nombre}`).join("\n")}`);
  process.exit(1);
}
