// Que el Postgres de las pruebas sea de la misma versión mayor que producción.
//   npm run test:version-postgres-de-pruebas
// Siempre: src/lib/postgres-produccion.json es válido y scripts/levantar-postgres-de-pruebas.mjs no tiene
// la versión escrita a mano. Con PRUEBAS_POSTGRES_URL (Postgres real): SHOW server_version_num empieza con
// la mayor del JSON, y la guardia de la base real (pg_input_is_valid existe desde Postgres 16: con una
// mayor menor tiene que dar error). Sin PRUEBAS_POSTGRES_URL esas dos se saltan y lo dice.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), "utf8");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

let mayor;
await prueba('src/lib/postgres-produccion.json es válido ("mayor" entero entre 12 y 30)', () => {
  const produccion = JSON.parse(leer("src/lib/postgres-produccion.json"));
  mayor = produccion.mayor;
  assert.ok(Number.isInteger(mayor), `"mayor" no es entero: ${JSON.stringify(mayor)}`);
  assert.ok(mayor >= 12 && mayor <= 30, `"mayor" fuera de 12..30: ${mayor}`);
});

await prueba("levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano", () => {
  const codigo = leer("scripts/levantar-postgres-de-pruebas.mjs");
  const aMano = codigo.match(/postgres:\d+/g) ?? [];
  assert.deepEqual(aMano, [], `imagen con versión a mano: ${aMano.join(", ")}`);
  assert.match(codigo, /src\/lib\/postgres-produccion\.json/, "la mayor se tiene que leer del JSON");
  assert.match(codigo, /`postgres:\$\{mayorDeProduccion\(\)\}-alpine`/);
});

if (!process.env.PRUEBAS_POSTGRES_URL?.trim()) {
  console.log("saltada - versión del servidor y guardia de la base real: no hay PRUEBAS_POSTGRES_URL (sin Postgres real)");
} else {
  const db = await abrirBaseDePruebas();
  try {
    await prueba(`el Postgres de pruebas es ${mayor}.x, como producción`, async () => {
      const { rows } = await db.query("SHOW server_version_num");
      const numero = String(rows[0].server_version_num);
      const mayorDelServidor = Math.floor(Number(numero) / 10000);
      assert.ok(
        numero.startsWith(String(mayor)) && mayorDelServidor === mayor,
        `diferencia de versión: el Postgres de pruebas es ${mayorDelServidor} (server_version_num ${numero}) y producción es ${mayor} (src/lib/postgres-produccion.json)`,
      );
    });

    await prueba("guardia de la base real: pg_input_is_valid solo existe desde Postgres 16", async () => {
      let error = null;
      try {
        await db.query("SELECT pg_input_is_valid('1', 'integer')"); // sql-version-ok: guardia a propósito, debe fallar con Postgres < 16
      } catch (e) {
        error = e;
      }
      if (mayor < 16) {
        assert.ok(error, `con Postgres ${mayor} pg_input_is_valid tenía que dar error: la base de pruebas no es la de producción`);
        assert.match(error.message, /pg_input_is_valid/);
      } else {
        assert.equal(error, null, `con Postgres ${mayor} pg_input_is_valid tenía que existir: ${error?.message}`);
      }
    });
  } finally {
    await db.close();
  }
}

console.log(`\n${pruebas} pruebas ok`);
