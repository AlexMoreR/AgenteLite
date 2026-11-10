/**
 * Prueba de la migración de la dueña de cada respuesta rápida (prisma/migrations/20261114120000_respuesta_rapida_duena)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:respuesta-rapida-duena-migracion
 *
 * 1. Aplica las migraciones reales anteriores a esta y crea una respuesta rápida "general" (como las de hoy).
 * 2. Aplica la nueva: la columna duenaId existe, es opcional y la respuesta sigue igual con duenaId vacío.
 * 3. Existe el índice (workspaceId, duenaId, createdAt) y la llave a "User" con ON DELETE SET NULL.
 * 4. `destructivoDelSql` (trabajador-tablero/lib/riesgo.mjs) no encuentra nada y va en BEGIN/COMMIT.
 * 5. Se vuelve a aplicar sin error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { destructivoDelSql } from "../trabajador-tablero/lib/riesgo.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261114120000_respuesta_rapida_duena";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
assert.ok(NUEVA > "20261113120000_carta_de_colores", "la carpeta va después de la última migración que había (carta_de_colores)");

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");
const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (texto, valores = []) => (await db.query(texto, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-yair', 'yair@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "QuickReply" ("id", "workspaceId", "title", "content", "updatedAt") VALUES
    ('qr1', 'ws1', 'Saludo', 'Hola, ¿en qué te ayudo?', now());
`);
const antes = await filas(`SELECT "id", "workspaceId", "title", "content" FROM "QuickReply" ORDER BY "id"`);

await db.exec(leer(NUEVA));

await prueba("la columna duenaId existe, es texto opcional", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'QuickReply' AND column_name = 'duenaId'`,
  );
  assert.deepEqual(
    columnas.map((c) => [c.column_name, c.data_type, c.is_nullable]),
    [["duenaId", "text", "YES"]],
  );
});

await prueba("la respuesta creada antes sigue con su título y texto y con duenaId vacío (Sin repartir)", async () => {
  const despues = await filas(`SELECT "id", "workspaceId", "title", "content" FROM "QuickReply" ORDER BY "id"`);
  assert.deepEqual(despues, antes);
  const [fila] = await filas(`SELECT "duenaId" FROM "QuickReply" WHERE "id" = 'qr1'`);
  assert.equal(fila.duenaId, null);
});

await prueba("existe el índice (workspaceId, duenaId, createdAt)", async () => {
  const indices = await filas(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'QuickReply' AND indexname = 'QuickReply_workspaceId_duenaId_createdAt_idx'`,
  );
  assert.equal(indices.length, 1);
  assert.match(indices[0].indexdef, /"workspaceId", "duenaId", "createdAt"/);
});

await prueba("si se borra la usuaria, su respuesta vuelve a Sin repartir (ON DELETE SET NULL)", async () => {
  await db.exec(`
    INSERT INTO "QuickReply" ("id", "workspaceId", "title", "content", "updatedAt", "duenaId")
      VALUES ('qr2', 'ws1', 'De Yair', 'Hola, soy Yair', now(), 'u-yair');
  `);
  await db.exec(`DELETE FROM "User" WHERE "id" = 'u-yair'`);
  const [fila] = await filas(`SELECT "title", "duenaId" FROM "QuickReply" WHERE "id" = 'qr2'`);
  assert.deepEqual(fila, { title: "De Yair", duenaId: null });
});

await prueba("la migración es solo aditiva (destructivoDelSql vacío) y va en BEGIN/COMMIT", async () => {
  assert.deepEqual(destructivoDelSql(leer(NUEVA)), []);
  const texto = leer(NUEVA).replace(/--.*$/gm, "");
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  assert.ok(/ADD COLUMN IF NOT EXISTS "duenaId"/.test(texto) && /CREATE INDEX IF NOT EXISTS/.test(texto), "con guardas IF NOT EXISTS");
  assert.ok(/pg_constraint/.test(texto), "la llave foránea con guarda pg_constraint");
});

await prueba("se puede aplicar dos veces sin error", async () => {
  await db.exec(leer(NUEVA));
  const [fila] = await filas(`SELECT "title", "duenaId" FROM "QuickReply" WHERE "id" = 'qr1'`);
  assert.deepEqual(fila, { title: "Saludo", duenaId: null });
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
