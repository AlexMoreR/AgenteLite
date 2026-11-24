// Corre todos los scripts test:* de package.json (menos test:e2e) uno por uno, para GitHub Actions.
//   node scripts/correr-pruebas-ci.mjs
// test:e2e va contra producción y tiene su propio workflow. Si una prueba falla, sigue con las demás
// y al final lista las que fallaron y termina con error.
// Si no viene PRUEBAS_POSTGRES_URL y hay Docker, levanta un Postgres de la misma versión mayor que
// producción (scripts/levantar-postgres-de-pruebas.mjs), se lo pasa a cada prueba y lo apaga al final.
// Sin Docker, las pruebas de SQL corren en PGlite. Con PRUEBAS_POSTGRES_OBLIGATORIO=1 (GitHub Actions),
// sin Postgres real termina con error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { apagar, imagenDePostgres, levantar } from "./levantar-postgres-de-pruebas.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paquete = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
const pruebas = Object.keys(paquete.scripts).filter((nombre) => nombre.startsWith("test:") && nombre !== "test:e2e");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const obligatorio = process.env.PRUEBAS_POSTGRES_OBLIGATORIO === "1";
const entorno = { ...process.env };
if (entorno.PRUEBAS_POSTGRES_URL) {
  console.log("Postgres de pruebas: el de PRUEBAS_POSTGRES_URL");
} else {
  let url = null;
  let fallo = null;
  try {
    url = await levantar();
  } catch (error) {
    fallo = error;
    console.error(`No se pudo levantar el Postgres de pruebas: ${error.message}`);
  }
  if (url) {
    entorno.PRUEBAS_POSTGRES_URL = url;
    console.log(`Postgres de pruebas: ${imagenDePostgres()}`);
  } else if (obligatorio) {
    console.error(`PRUEBAS_POSTGRES_OBLIGATORIO=1 y no hay Postgres real (${imagenDePostgres()} en Docker): no se corren las pruebas.`);
    process.exit(1);
  } else {
    console.log(`${fallo ? "sin Postgres en Docker" : "sin Docker"}: SQL en PGlite + chequeo estático`);
  }
}
// Si cortan la corrida (Ctrl+C, cancelar el job), que el contenedor no quede prendido.
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    apagar();
    process.exit(130);
  });
}

const fallaron = [];
try {
  for (const nombre of pruebas) {
    console.log(`\n=== npm run ${nombre} ===`);
    const resultado = spawnSync(npm, ["run", nombre], { cwd: raiz, stdio: "inherit", shell: process.platform === "win32", env: entorno });
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
