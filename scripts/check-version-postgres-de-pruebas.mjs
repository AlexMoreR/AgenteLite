// Prueba: el Postgres de las pruebas es de la misma versión mayor que producción.
//   npm run test:version-postgres-de-pruebas
//
// Revisa:
// 1. que src/lib/postgres-produccion.json sea válido ("mayor" es un entero entre 12 y 30);
// 2. que scripts/levantar-postgres-de-pruebas.mjs no tenga la versión escrita a mano (la lee del JSON);
// 3. con PRUEBAS_POSTGRES_URL, que SHOW server_version_num sea de esa mayor ("diferencia de versión" si no);
// 4. con PRUEBAS_POSTGRES_URL y mayor < 16, que pg_input_is_valid dé error: es la guardia de que la base
//    es de verdad la vieja (en PGlite, que es Postgres 17, esa función existe).
// Sin PRUEBAS_POSTGRES_URL, 3 y 4 se saltan y lo dice.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.error(`FALLA - ${nombre}\n  ${error.message}`);
  }
}

let mayor = null;
await prueba("src/lib/postgres-produccion.json es válido", () => {
  const produccion = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
  assert.ok(Number.isInteger(produccion.mayor), `"mayor" tiene que ser un entero y es ${JSON.stringify(produccion.mayor)}`);
  assert.ok(produccion.mayor >= 12 && produccion.mayor <= 30, `"mayor" tiene que estar entre 12 y 30 y es ${produccion.mayor}`);
  mayor = produccion.mayor;
});

await prueba("levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "scripts/levantar-postgres-de-pruebas.mjs"), "utf8");
  assert.doesNotMatch(fuente, /postgres:\d/, "la imagen tiene la versión escrita (postgres:<número>)");
  assert.doesNotMatch(fuente, /["'`]\d+(\.\d+)?-alpine/, "la etiqueta tiene la versión escrita (<número>-alpine)");
  assert.match(fuente, /postgres-produccion\.json/, "tiene que leer la versión de src/lib/postgres-produccion.json");
  assert.match(fuente, /postgres:\$\{mayorDeProduccion\(\)\}-alpine/, "la imagen tiene que salir de mayorDeProduccion()");
});

const url = process.env.PRUEBAS_POSTGRES_URL;
if (!url) {
  console.log("salta - versión de la base real y guardia de pg_input_is_valid: no hay PRUEBAS_POSTGRES_URL (sin Docker)");
} else if (mayor === null) {
  console.log("salta - versión de la base real: el JSON no es válido");
} else {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await prueba(`la base de pruebas es Postgres ${mayor}`, async () => {
      const { rows } = await cliente.query("SHOW server_version_num");
      const numero = String(rows[0].server_version_num);
      // server_version_num es <mayor><4 cifras> desde Postgres 10 (15.10 = 150010).
      const mayorReal = Math.floor(Number(numero) / 10000);
      assert.equal(mayorReal, mayor, `diferencia de versión: la base de pruebas es Postgres ${mayorReal} (${numero}) y producción es ${mayor}`);
      console.log(`  server_version_num = ${numero}`);
    });
    if (mayor < 16) {
      await prueba("pg_input_is_valid no existe en la base real (guardia de Postgres < 16)", async () => {
        await assert.rejects(
          cliente.query("SELECT pg_input_is_valid('1', 'integer')"), // sql-version-ok: la prueba es justo que falle en la base vieja
          /pg_input_is_valid/,
          "pg_input_is_valid funcionó: la base de pruebas no es la versión vieja de producción",
        );
      });
    } else {
      console.log(`salta - guardia de pg_input_is_valid: producción es Postgres ${mayor} y ya la tiene`);
    }
  } finally {
    await cliente.end();
  }
}

if (fallas.length > 0) {
  console.error(`\n${fallas.length} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\ntodas ok");
