/**
 * Prueba de la migración del aprobador de Sistemas (prisma/migrations/20261103120000_aprobador_sistemas) contra un
 * Postgres embebido (PGlite, el mismo ensayo de `npm run test:migraciones-pglite`), sin tocar ninguna base real:
 *   npm run test:tablero-aprobador-sistemas-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta, y guarda aprobadores como los de hoy.
 * 2. Aplica la nueva: los de antes quedan igual; un aprobador con alcance SISTEMAS se guarda y uno con 'OTRO' falla.
 * 3. La vuelve a aplicar (no debe fallar) y el ensayo sigue con las migraciones que vienen después.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261103120000_aprobador_sistemas";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");
const aplicar = async (nombre) => {
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
};

const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;
const guardar = (id, userId, alcance) =>
  db.query(`INSERT INTO "AprobadorTablero" ("id", "workspaceId", "userId", "alcance") VALUES ($1, 'ws1', $2, $3)`, [id, userId, alcance]);

const indiceNueva = migraciones.indexOf(NUEVA);
for (const nombre of migraciones.slice(0, indiceNueva)) await aplicar(nombre);

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES
    ('u1', 'u1@ejemplo.test', 'x', CURRENT_TIMESTAMP),
    ('u2', 'u2@ejemplo.test', 'x', CURRENT_TIMESTAMP),
    ('u3', 'u3@ejemplo.test', 'x', CURRENT_TIMESTAMP),
    ('u4', 'u4@ejemplo.test', 'x', CURRENT_TIMESTAMP);
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt") VALUES ('ws1', 'Negocio', 'negocio', CURRENT_TIMESTAMP);
`);
await guardar("a1", "u1", "TODO");
await guardar("a2", "u2", "DESARROLLO");

await prueba("antes de la migración, SISTEMAS no se podía guardar", async () => {
  await assert.rejects(guardar("x", "u3", "SISTEMAS"), /AprobadorTablero_alcance_check/);
});

assert.match(leer(NUEVA), /^BEGIN;$/m);
assert.match(leer(NUEVA), /^COMMIT;$/m);
await aplicar(NUEVA);

await prueba("los aprobadores de antes quedan igual", async () => {
  assert.deepEqual(await filas(`SELECT "id", "alcance" FROM "AprobadorTablero" ORDER BY "id"`), [
    { id: "a1", alcance: "TODO" },
    { id: "a2", alcance: "DESARROLLO" },
  ]);
});

await prueba("un aprobador con alcance SISTEMAS se guarda", async () => {
  await guardar("a3", "u3", "SISTEMAS");
  assert.deepEqual(await filas(`SELECT "alcance" FROM "AprobadorTablero" WHERE "id" = 'a3'`), [{ alcance: "SISTEMAS" }]);
});

await prueba("un aprobador con alcance 'OTRO' falla", async () => {
  await assert.rejects(guardar("a4", "u4", "OTRO"), /AprobadorTablero_alcance_check/);
  await assert.rejects(db.query(`UPDATE "AprobadorTablero" SET "alcance" = 'OTRO' WHERE "id" = 'a3'`), /AprobadorTablero_alcance_check/);
});

await prueba("se puede volver a aplicar sin fallar y siguen las migraciones de después", async () => {
  await aplicar(NUEVA);
  for (const nombre of migraciones.slice(indiceNueva + 1)) await aplicar(nombre);
  assert.equal((await filas(`SELECT count(*)::int AS n FROM "AprobadorTablero"`))[0].n, 3);
  await assert.rejects(guardar("a5", "u4", "OTRO"), /AprobadorTablero_alcance_check/);
});

await db.close();
console.log(`\n${pruebas} pruebas, todas bien`);
