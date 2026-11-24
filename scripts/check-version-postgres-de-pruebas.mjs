// Aviso de versión: el Postgres de las pruebas tiene que ser de la misma versión mayor que producción.
//   npm run test:version-postgres-de-pruebas
//
// Revisa:
// 1. src/lib/postgres-produccion.json es válido ("mayor" es un entero entre 12 y 30).
// 2. scripts/levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano (la lee del JSON).
// 3. Con PRUEBAS_POSTGRES_URL: SHOW server_version_num empieza con la mayor del JSON.
// 4. Con PRUEBAS_POSTGRES_URL: si la mayor es menor que 16, pg_input_is_valid (de Postgres 16) da error.
//    Es la guardia de la base real: una consulta con funciones que producción no tiene falla acá también.
// Sin PRUEBAS_POSTGRES_URL, la 3 y la 4 se saltan y lo dice.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const produccion = JSON.parse(fs.readFileSync(path.join(raiz, "src", "lib", "postgres-produccion.json"), "utf8"));
const { mayor } = produccion;

await prueba("postgres-produccion.json: mayor es un entero entre 12 y 30", () => {
  assert.ok(Number.isInteger(mayor), `"mayor" tiene que ser un entero y es ${JSON.stringify(mayor)}`);
  assert.ok(mayor >= 12 && mayor <= 30, `"mayor" tiene que estar entre 12 y 30 y es ${mayor}`);
});

await prueba("levantar-postgres-de-pruebas.mjs lee la versión del JSON y no la tiene escrita a mano", () => {
  const fuente = fs.readFileSync(path.join(raiz, "scripts", "levantar-postgres-de-pruebas.mjs"), "utf8");
  assert.match(fuente, /postgres-produccion\.json/, "tiene que leer la versión de src/lib/postgres-produccion.json");
  assert.doesNotMatch(fuente, /postgres:\s*\d/, "la imagen no puede llevar la versión escrita (postgres:<número>)");
  assert.doesNotMatch(fuente, /\d+-alpine/, "la imagen no puede llevar la versión escrita (<número>-alpine)");
});

const url = process.env.PRUEBAS_POSTGRES_URL;
if (!url) {
  console.log("salta - sin PRUEBAS_POSTGRES_URL: no se compara la versión ni se prueba pg_input_is_valid en la base real");
} else {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await prueba(`la base de pruebas es Postgres ${mayor}, como producción`, async () => {
      const { rows } = await cliente.query("SHOW server_version_num");
      const numero = String(rows[0].server_version_num);
      // server_version_num de Postgres 10 en adelante: mayor * 10000 + menor (150008 = 15.8).
      const mayorDeLaBase = Math.floor(Number(numero) / 10000);
      assert.ok(
        numero.startsWith(String(mayor)) && mayorDeLaBase === mayor,
        `diferencia de versión: la base de pruebas es Postgres ${mayorDeLaBase} (${numero}) y producción es ${mayor}`,
      );
    });

    if (mayor < 16) {
      await prueba("pg_input_is_valid (Postgres 16) da error en la base de pruebas, como en producción", async () => { // sql-version-ok: es el nombre de la prueba
        await assert.rejects(
          cliente.query("SELECT pg_input_is_valid('1', 'integer')"), // sql-version-ok: se espera que falle
          /pg_input_is_valid/,
          "la base de pruebas acepta pg_input_is_valid y producción no la tiene",
        );
      });
    } else {
      console.log(`salta - producción es Postgres ${mayor}: pg_input_is_valid existe ahí`);
    }
  } finally {
    await cliente.end();
  }
}

console.log(`\n${pruebas} pruebas ok`);
