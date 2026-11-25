// La base de pruebas tiene que ser de la misma versión mayor que producción.
//   npm run test:version-postgres-de-pruebas
// Revisa:
//   1. que src/lib/postgres-produccion.json sea válido (`mayor` entero entre 12 y 30);
//   2. que scripts/levantar-postgres-de-pruebas.mjs no tenga la versión escrita a mano;
//   3. con PRUEBAS_POSTGRES_URL, que SHOW server_version_num sea de esa mayor ("diferencia de versión" si no);
//   4. con PRUEBAS_POSTGRES_URL y mayor < 16, que pg_input_is_valid (de Postgres 16) dé error: es la
//      guardia de que la base de pruebas de verdad no tiene lo que producción no tiene.
// Sin PRUEBAS_POSTGRES_URL, la 3 y la 4 se saltan y lo dice.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, "src", "lib", "postgres-produccion.json"), "utf8"));
const mayor = datos.mayor;

await prueba("postgres-produccion.json: `mayor` es un entero entre 12 y 30", () => {
  assert.ok(Number.isInteger(mayor) && mayor >= 12 && mayor <= 30, `mayor inválida: ${JSON.stringify(mayor)}`);
});

await prueba("levantar-postgres-de-pruebas.mjs no tiene la versión escrita a mano", () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "scripts", "levantar-postgres-de-pruebas.mjs"), "utf8");
  assert.doesNotMatch(codigo, /postgres:\d/, "la imagen tiene un número escrito a mano");
  assert.doesNotMatch(codigo, /\d+-alpine/, "la etiqueta -alpine tiene un número escrito a mano");
  assert.match(codigo, /postgres-produccion\.json/, "la versión tiene que salir del JSON");
  assert.match(codigo, /`postgres:\$\{leerMayorDeProduccion\(\)\}-alpine`/);
});

if (!process.env.PRUEBAS_POSTGRES_URL) {
  console.log("salta - versión del servidor y guardia de pg_input_is_valid: no hay PRUEBAS_POSTGRES_URL (sin Postgres real)");
} else {
  const db = await abrirBaseDePruebas();
  try {
    await prueba(`el Postgres de pruebas es de la versión ${mayor} (la de producción)`, async () => {
      const { rows } = await db.query("SHOW server_version_num");
      const numero = Number(rows[0].server_version_num);
      const delServidor = Math.floor(numero / 10000);
      assert.equal(delServidor, mayor, `diferencia de versión: producción es ${mayor} y la base de pruebas es ${delServidor} (${numero})`);
    });

    if (mayor < 16) {
      await prueba(`pg_input_is_valid (Postgres 16) da error en la base de pruebas (versión ${mayor})`, async () => { // sql-version-ok: solo el nombre de la prueba
        await assert.rejects(
          db.query("SELECT pg_input_is_valid('1', 'integer')"), // sql-version-ok: la prueba comprueba que esta función NO existe
          /pg_input_is_valid|does not exist|no existe/,
        );
      });
    } else {
      console.log(`salta - guardia de pg_input_is_valid: producción es ${mayor} (>= 16) y sí la tiene`);
    }
  } finally {
    await db.close();
  }
}

console.log(`\n${pruebas} pruebas OK`);
