/**
 * Prueba de la migración del responsable de la tarjeta del Tablero IA
 * (prisma/migrations/20261024120000_tablero_responsable) contra un Postgres embebido (PGlite),
 * sin tocar ninguna base real:
 *   npm run test:tablero-responsable-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta.
 * 2. Inserta tarjetas como las de hoy (sin responsable) y dos usuarios.
 * 3. Aplica la migración nueva y comprueba: la columna "responsableId" (texto, opcional, sin default),
 *    las tarjetas de antes intactas y sin responsable, la llave foránea a "User" con ON DELETE SET NULL
 *    (borrar a la persona deja la tarjeta viva y sin responsable) y el índice.
 * 4. Revisa que la migración sea aditiva (el mismo detector de SQL destructivo del trabajador) y vaya en BEGIN/COMMIT.
 * 5. La vuelve a aplicar (no debe fallar ni duplicar nada).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261024120000_tablero_responsable";

const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

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
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-emanuel', 'emanuel@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Ventas');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo")
    VALUES ('c1', 'tab1', 'Reporte nuevo', 'POR_APROBAR', 'u-dueno', now(), 'tarea', 'aizencrm');
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId")
    VALUES ('c2', 'tab1', 'Otra tarjeta', 'IDEA', 'u-dueno', now(), 'tarea');
`);

const antesDeMigrar = await filas(`SELECT * FROM "TarjetaTablero" ORDER BY "id"`);
assert.equal(antesDeMigrar.length, 2);
assert.ok(!("responsableId" in antesDeMigrar[0]), "antes de migrar no existe la columna");

await db.exec(leer(NUEVA));

await prueba("la columna responsableId existe, es de texto, acepta nulo y no tiene valor por defecto", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'TarjetaTablero' AND column_name = 'responsableId'`,
  );
  assert.equal(columnas.length, 1);
  assert.equal(columnas[0].data_type, "text");
  assert.equal(columnas[0].is_nullable, "YES");
  assert.equal(columnas[0].column_default, null);
});

await prueba("las tarjetas de antes siguen iguales y sin responsable", async () => {
  const despues = await filas(`SELECT * FROM "TarjetaTablero" ORDER BY "id"`);
  assert.equal(despues.length, 2);
  for (const [i, fila] of despues.entries()) {
    const { responsableId, ...resto } = fila;
    assert.equal(responsableId, null);
    assert.deepEqual(resto, antesDeMigrar[i], `la tarjeta ${fila.id} no cambió`);
  }
});

await prueba("la llave foránea con User existe y es ON DELETE SET NULL", async () => {
  const llaves = await filas(
    `SELECT c.conname, c.confdeltype, c.confupdtype, f.relname AS destino
     FROM pg_constraint c JOIN pg_class f ON f.oid = c.confrelid
     WHERE c.conname = 'TarjetaTablero_responsableId_fkey' AND c.contype = 'f'`,
  );
  assert.equal(llaves.length, 1);
  assert.equal(llaves[0].destino, "User");
  assert.equal(llaves[0].confdeltype, "n", "ON DELETE SET NULL");
  assert.equal(llaves[0].confupdtype, "c", "ON UPDATE CASCADE");
});

await prueba("la llave rechaza un responsable que no existe", async () => {
  await assert.rejects(() => db.exec(`UPDATE "TarjetaTablero" SET "responsableId" = 'nadie' WHERE "id" = 'c1'`), /foreign key|violates/i);
});

await prueba("existe el índice por responsableId", async () => {
  const indices = await filas(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'TarjetaTablero' AND indexname = 'TarjetaTablero_responsableId_idx'`,
  );
  assert.equal(indices.length, 1);
  assert.ok(indices[0].indexdef.includes('("responsableId")'));
});

await prueba("se puede asignar y leer el responsable", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "responsableId" = 'u-emanuel' WHERE "id" = 'c1'`);
  const [tarjeta] = await filas(`SELECT "responsableId" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(tarjeta.responsableId, "u-emanuel");
});

await prueba("se puede aplicar dos veces sin error ni perder el responsable", async () => {
  await db.exec(leer(NUEVA));
  const [tarjeta] = await filas(`SELECT "responsableId" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(tarjeta.responsableId, "u-emanuel");
  const llaves = await filas(`SELECT 1 FROM pg_constraint WHERE conname = 'TarjetaTablero_responsableId_fkey'`);
  assert.equal(llaves.length, 1, "no duplicó la llave");
  const indices = await filas(`SELECT 1 FROM pg_indexes WHERE indexname = 'TarjetaTablero_responsableId_idx'`);
  assert.equal(indices.length, 1, "no duplicó el índice");
});

await prueba("borrar a la persona deja la tarjeta viva y sin responsable", async () => {
  await db.exec(`DELETE FROM "User" WHERE "id" = 'u-emanuel'`);
  const tarjetas = await filas(`SELECT "id", "titulo", "responsableId" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.equal(tarjetas.length, 2, "no se borró ninguna tarjeta");
  assert.deepEqual(tarjetas.map((t) => t.responsableId), [null, null]);
  assert.equal(tarjetas[0].titulo, "Reporte nuevo");
});

await prueba("la migración es solo aditiva (las mismas reglas del trabajador no ven nada destructivo)", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  assert.equal((texto.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 1);
  assert.ok(!/CREATE TYPE/i.test(texto), "no crea tipos nuevos");
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")), "sin DROP, DELETE FROM, TRUNCATE, RENAME ni UPDATE");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
