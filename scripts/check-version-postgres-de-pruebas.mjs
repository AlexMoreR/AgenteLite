// Prueba: el Postgres de las pruebas es de la misma versión mayor que producción.
//
//   npm run test:version-postgres-de-pruebas
//
// La versión de producción está en src/lib/postgres-produccion.json ("mayor"). Revisa:
// 1. que el JSON sea válido: "mayor" es un entero entre 12 y 30;
// 2. que scripts/levantar-postgres-de-pruebas.mjs no tenga la versión escrita a mano (la lee del JSON);
// 3. con PRUEBAS_POSTGRES_URL (Postgres real), que SHOW server_version_num empiece con la mayor del JSON;
//    si no, falla con "diferencia de versión";
// 4. con Postgres real y mayor < 16, que pg_input_is_valid dé error: es la guardia de que la base de
//    las pruebas de verdad es la vieja (esa función, de Postgres 16, tumbó la bandeja en producción).
// Sin PRUEBAS_POSTGRES_URL, la 3 y la 4 se saltan y lo dice. npm test (correr-pruebas-ci.mjs) pone esa
// variable cuando levanta el contenedor.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pruebas = 0;
let saltadas = 0;
let fallaron = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallaron += 1;
    console.error(`FALLA - ${nombre}\n${error.message}`);
  }
}
function saltar(nombre, motivo) {
  saltadas += 1;
  console.log(`saltada - ${nombre}: ${motivo}`);
}

let mayor;
await prueba("src/lib/postgres-produccion.json es válido: mayor es un entero entre 12 y 30", () => {
  const produccion = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
  mayor = produccion.mayor;
  assert.ok(Number.isInteger(mayor), `"mayor" no es un entero: ${JSON.stringify(mayor)}`);
  assert.ok(mayor >= 12 && mayor <= 30, `"mayor" fuera de 12..30: ${mayor}`);
});

await prueba("levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano", () => {
  const texto = fs.readFileSync(path.join(RAIZ, "scripts/levantar-postgres-de-pruebas.mjs"), "utf8");
  assert.doesNotMatch(texto, /postgres:\d/, "tiene una imagen postgres:<número> escrita a mano");
  assert.doesNotMatch(texto, /\bmayor\s*[:=]\s*\d/, "tiene la mayor escrita a mano");
  assert.match(texto, /postgres-produccion\.json/, "no lee la versión de src/lib/postgres-produccion.json");
  assert.match(texto, /`postgres:\$\{mayorDeProduccion\(\)\}-alpine`/, "la imagen no sale de la mayor del JSON");
});

if (!process.env.PRUEBAS_POSTGRES_URL) {
  const motivo = "sin PRUEBAS_POSTGRES_URL (sin Postgres real; npm test lo levanta si hay Docker)";
  saltar("la versión del Postgres de pruebas coincide con producción", motivo);
  saltar("pg_input_is_valid da error en el Postgres de pruebas (mayor < 16)", motivo);
} else {
  const db = await abrirBaseDePruebas();
  try {
    await prueba("la versión del Postgres de pruebas coincide con producción", async () => {
      const { rows } = await db.query("SHOW server_version_num");
      const numero = String(rows[0].server_version_num);
      // server_version_num de Postgres 10 en adelante: mayor * 10000 + menor (150008 = 15.8).
      const mayorDeLaBase = Math.floor(Number(numero) / 10000);
      assert.ok(
        numero.startsWith(String(mayor)) && mayorDeLaBase === mayor,
        `diferencia de versión: el Postgres de pruebas es ${mayorDeLaBase} (server_version_num ${numero}) y producción es ${mayor}`,
      );
    });

    if (mayor < 16) {
      await prueba("pg_input_is_valid da error en el Postgres de pruebas (mayor < 16)", async () => {
        // Se llama a propósito, para comprobar que la base de pruebas NO la tiene.
        const consulta = "SELECT pg_input_is_valid('1', 'integer')"; // sql-version-ok: guardia de la base real (mayor < 16)
        await assert.rejects(db.query(consulta), /pg_input_is_valid|does not exist|no existe/);
      });
    } else {
      saltar("pg_input_is_valid da error en el Postgres de pruebas (mayor < 16)", `producción es ${mayor}: la función existe`);
    }
  } finally {
    await db.close();
  }
}

console.log(`\n${pruebas} pruebas ok, ${saltadas} saltadas, ${fallaron} fallaron`);
if (fallaron > 0) process.exit(1);
