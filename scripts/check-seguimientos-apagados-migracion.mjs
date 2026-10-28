/**
 * Prueba de la migración "Seguimientos automáticos por chat" (prisma/migrations/20261106120000_seguimientos_apagados)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:seguimientos-apagados-migracion
 *
 * 1. Aplica las migraciones reales en orden hasta la anterior y crea chats como los de hoy.
 * 2. Aplica la nueva: los chats de antes quedan con los seguimientos ENCENDIDOS (seguimientosApagados = false).
 * 3. La vuelve a aplicar (no debe fallar) y apagar uno no toca a los demás.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261106120000_seguimientos_apagados";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (sql) => (await db.query(sql)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

await db.exec(`
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt") VALUES ('ws1', 'Negocio', 'negocio', now());
  INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('c1', 'ws1', '573001', now()), ('c2', 'ws1', '573002', now());
  INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "updatedAt") VALUES ('v1', 'ws1', 'c1', now()), ('v2', 'ws1', 'c2', now());
`);

assert.match(leer(NUEVA), /^BEGIN;$/m);
assert.match(leer(NUEVA), /^COMMIT;$/m);
assert.doesNotMatch(leer(NUEVA), /DROP|DELETE|TRUNCATE/i, "solo aditiva");
await db.exec(leer(NUEVA));

await prueba("los chats de antes quedan con los seguimientos encendidos y no se pierde ninguno", async () => {
  const resultado = await filas(`SELECT "id", "seguimientosApagados", "seguimientosApagadosAt", "seguimientosApagadosPor" FROM "Conversation" ORDER BY "id"`);
  assert.equal(resultado.length, 2);
  for (const fila of resultado) {
    assert.equal(fila.seguimientosApagados, false);
    assert.equal(fila.seguimientosApagadosAt, null);
    assert.equal(fila.seguimientosApagadosPor, null);
  }
});

await prueba("se puede volver a aplicar sin fallar y la columna queda NOT NULL con valor false", async () => {
  await db.exec(leer(NUEVA));
  const [columna] = await filas(
    `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'Conversation' AND column_name = 'seguimientosApagados'`,
  );
  assert.equal(columna.is_nullable, "NO");
  assert.match(columna.column_default, /false/i);
});

await prueba("apagar un chat no toca a los demás; un chat nuevo nace encendido", async () => {
  await db.exec(`UPDATE "Conversation" SET "seguimientosApagados" = true, "seguimientosApagadosAt" = now(), "seguimientosApagadosPor" = 'u1' WHERE "id" = 'v1'`);
  await db.exec(`INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('c3', 'ws1', '573003', now()); INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "updatedAt") VALUES ('v3', 'ws1', 'c3', now())`);
  const resultado = await filas(`SELECT "id", "seguimientosApagados" FROM "Conversation" ORDER BY "id"`);
  assert.deepEqual(resultado.map((f) => [f.id, f.seguimientosApagados]), [["v1", true], ["v2", false], ["v3", false]]);
});

console.log(`\n${pruebas} pruebas de la migración "seguimientos apagados": todas pasaron.`);
