// Corre todos los scripts test:* de package.json (menos test:e2e) uno por uno, para GitHub Actions.
//   node scripts/correr-pruebas-ci.mjs
// test:e2e va contra producción y tiene su propio workflow. Si una prueba falla, sigue con las demás
// y al final lista las que fallaron y termina con error.
//
// Postgres de pruebas: si no viene PRUEBAS_POSTGRES_URL y hay Docker, levanta un Postgres real de la
// versión mayor de producción (scripts/levantar-postgres-de-pruebas.mjs), pasa su dirección a cada
// prueba en PRUEBAS_POSTGRES_URL y lo apaga al final, también si hubo fallas. Sin Docker, las pruebas
// de SQL corren en PGlite (más el chequeo estático de test:sql-version-postgres). Con
// PRUEBAS_POSTGRES_OBLIGATORIO=1 (GitHub Actions) no tener el Postgres real es un error.
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
if (entorno.PRUEBAS_POSTGRES_URL?.trim()) {
  console.log("Postgres de pruebas: el de PRUEBAS_POSTGRES_URL");
} else {
  let levantado = null;
  try {
    levantado = await levantar();
  } catch (error) {
    console.error(`No se pudo levantar el Postgres de pruebas: ${error.message}`);
    if (obligatorio) process.exit(1);
  }
  if (levantado) {
    entorno.PRUEBAS_POSTGRES_URL = levantado.url;
    console.log(`Postgres de pruebas: ${levantado.imagen}`);
  } else {
    console.log("sin Docker: SQL en PGlite + chequeo estático");
    if (obligatorio) {
      console.error("PRUEBAS_POSTGRES_OBLIGATORIO=1 y no hay Postgres real de pruebas: las pruebas de SQL no se pueden dar por buenas.");
      process.exit(1);
    }
  }
}

const fallaron = [];
try {
  for (const nombre of pruebas) {
    console.log(`\n=== npm run ${nombre} ===`);
    const resultado = spawnSync(npm, ["run", nombre], { cwd: raiz, env: entorno, stdio: "inherit", shell: process.platform === "win32" });
    if (resultado.status !== 0) fallaron.push(nombre);
  }
} finally {
  await apagar();
}

console.log(`\n${pruebas.length - fallaron.length} de ${pruebas.length} pruebas pasaron.`);
if (fallaron.length > 0) {
  console.error(`Fallaron ${fallaron.length}:\n${fallaron.map((nombre) => `  - ${nombre}`).join("\n")}`);
  process.exit(1);
}
