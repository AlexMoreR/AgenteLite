// Que el Postgres de las pruebas sea de la misma versión mayor que producción:
//   npm run test:version-postgres-de-pruebas
//
// 1. src/lib/postgres-produccion.json es válido ('mayor' es un entero entre 12 y 30).
// 2. scripts/levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano (la lee del JSON).
// Con PRUEBAS_POSTGRES_URL (Postgres real; scripts/correr-pruebas-ci.mjs lo levanta si hay Docker):
// 3. SHOW server_version_num empieza con la mayor del JSON; si no, "diferencia de versión".
// 4. Si la mayor es menor que 16, pg_input_is_valid (de Postgres 16) da error: la guardia de que las
//    pruebas corren de verdad contra una base sin las funciones que producción no tiene.
// Sin PRUEBAS_POSTGRES_URL, la 3 y la 4 se saltan y lo dice.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pasaron = 0;
async function prueba(nombre, fn) {
  await fn();
  pasaron++;
  console.log(`ok - ${nombre}`);
}

const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, "src", "lib", "postgres-produccion.json"), "utf8"));
const mayor = datos.mayor;

await prueba("postgres-produccion.json: 'mayor' es un entero entre 12 y 30", () => {
  assert.ok(Number.isInteger(mayor), `'mayor' no es un entero: ${JSON.stringify(mayor)}`);
  assert.ok(mayor >= 12 && mayor <= 30, `'mayor' fuera de 12..30: ${mayor}`);
});

await prueba("levantar-postgres-de-pruebas.mjs lee la versión del JSON y no la tiene escrita a mano", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "scripts", "levantar-postgres-de-pruebas.mjs"), "utf8");
  assert.match(fuente, /postgres-produccion\.json/, "no lee src/lib/postgres-produccion.json");
  // Ni "postgres:15", ni "postgres:15-alpine", ni un número suelto antes de "-alpine".
  assert.doesNotMatch(fuente, /postgres:\d/, "tiene una imagen postgres:<número> escrita a mano");
  assert.doesNotMatch(fuente, /\d+-alpine/, "tiene una versión <número>-alpine escrita a mano");
});

const url = process.env.PRUEBAS_POSTGRES_URL?.trim();
if (!url) {
  console.log("salto - sin PRUEBAS_POSTGRES_URL: no se revisan la versión del servidor ni pg_input_is_valid");
} else {
  const pg = require("pg");
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await prueba(`el Postgres de pruebas es de la versión mayor ${mayor}`, async () => {
      const { rows } = await cliente.query("SHOW server_version_num");
      const numero = String(rows[0].server_version_num);
      // Desde Postgres 10, server_version_num = mayor * 10000 + menor (p. ej. 150008).
      const mayorDelServidor = Math.floor(Number(numero) / 10000);
      assert.ok(
        numero.startsWith(String(mayor)) && mayorDelServidor === mayor,
        `diferencia de versión: el Postgres de pruebas es ${numero} (mayor ${mayorDelServidor}) y producción es ${mayor}`,
      );
    });

    if (mayor < 16) {
      await prueba("pg_input_is_valid (Postgres 16) no existe en el Postgres de pruebas", async () => {
        await assert.rejects(
          cliente.query("SELECT pg_input_is_valid('1', 'integer')"),
          /pg_input_is_valid/,
          "pg_input_is_valid funcionó: la base de pruebas no es como producción",
        );
      });
    } else {
      console.log(`salto - producción es ${mayor} (>= 16): pg_input_is_valid sí existe ahí`);
    }
  } finally {
    await cliente.end();
  }
}

console.log(`\n${pasaron} pruebas ok`);
