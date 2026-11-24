// Corre todos los scripts test:* de package.json (menos test:e2e) uno por uno, para GitHub Actions.
//   node scripts/correr-pruebas-ci.mjs
// test:e2e va contra producción y tiene su propio workflow. Si una prueba falla, sigue con las demás
// y al final lista las que fallaron y termina con error.
//
// Postgres de pruebas: si no viene PRUEBAS_POSTGRES_URL y hay Docker, levanta un Postgres de la misma
// versión mayor que producción (scripts/levantar-postgres-de-pruebas.mjs) y se lo pasa a cada prueba en
// PRUEBAS_POSTGRES_URL; al final lo apaga, también si hubo fallas. Sin Docker, las pruebas de SQL corren
// en PGlite. Con PRUEBAS_POSTGRES_OBLIGATORIO=1 (GitHub Actions), sin Postgres real termina con error.
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

const env = { ...process.env };
if (env.PRUEBAS_POSTGRES_URL) {
  console.log("Postgres de pruebas: el de PRUEBAS_POSTGRES_URL");
} else {
  let postgres = null;
  let noArranco = false;
  try {
    postgres = await levantar();
  } catch (error) {
    // Hay Docker pero el contenedor no arrancó: es una falla, no se tapa.
    console.error(`No se pudo levantar el Postgres de pruebas: ${error.message}`);
    noArranco = true;
    if (obligatorio) process.exit(1);
  }
  if (postgres) {
    env.PRUEBAS_POSTGRES_URL = postgres.url;
    console.log(`Postgres de pruebas: ${postgres.imagen}`);
  } else if (noArranco) {
    console.log("Postgres de pruebas sin arrancar: SQL en PGlite + chequeo estático");
  } else if (obligatorio) {
    console.error("PRUEBAS_POSTGRES_OBLIGATORIO=1 y no hay Docker para levantar el Postgres de pruebas.");
    process.exit(1);
  } else {
    console.log("sin Docker: SQL en PGlite + chequeo estático");
  }
}

// Si cortan la corrida (Ctrl+C o el runner la cancela), igual se apaga el contenedor.
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    apagar();
    process.exit(1);
  });
}

const fallaron = [];
try {
  for (const nombre of pruebas) {
    console.log(`\n=== npm run ${nombre} ===`);
    const resultado = spawnSync(npm, ["run", nombre], { cwd: raiz, stdio: "inherit", env, shell: process.platform === "win32" });
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
