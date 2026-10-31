/**
 * Prueba de la migración de las tarjetas archivadas (prisma/migrations/20261111120000_tablero_archivadas)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:tablero-archivadas-migracion
 *
 * 1. Aplica las migraciones reales anteriores a esta y crea 2 tarjetas (una HECHO y una IDEA).
 * 2. Aplica la nueva: las columnas archivadaEn y terminadaEn existen y quedan vacías; nada se reescribe.
 * 3. Existe el índice (tableroId, archivadaEn).
 * 4. El SQL no tiene DROP, DELETE, TRUNCATE, UPDATE ni ALTER ... TYPE y va en BEGIN/COMMIT.
 * 5. Se vuelve a aplicar sin error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261111120000_tablero_archivadas";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
assert.ok(NUEVA > "20261110120000_reunion_salas", "la carpeta va después de la última migración que había (reunion_salas)");

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
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId") VALUES
    ('c1', 'tab1', 'Terminada', 'HECHO', 'u-dueno', now(), 'tarea'),
    ('c2', 'tab1', 'Abierta', 'IDEA', 'u-dueno', now(), 'tarea');
`);
const antes = await filas(`SELECT "id", "titulo", "estado"::text AS "estado", "numero" FROM "TarjetaTablero" ORDER BY "id"`);

await db.exec(leer(NUEVA));

await prueba("las columnas archivadaEn y terminadaEn existen, son fechas opcionales y quedan vacías", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'TarjetaTablero' AND column_name IN ('archivadaEn', 'terminadaEn') ORDER BY column_name`,
  );
  assert.deepEqual(
    columnas.map((c) => [c.column_name, c.data_type, c.is_nullable]),
    [
      ["archivadaEn", "timestamp without time zone", "YES"],
      ["terminadaEn", "timestamp without time zone", "YES"],
    ],
  );
  const vacias = await filas(`SELECT count(*)::int AS n FROM "TarjetaTablero" WHERE "archivadaEn" IS NOT NULL OR "terminadaEn" IS NOT NULL`);
  assert.equal(vacias[0].n, 0);
});

await prueba("no se reescribe ninguna tarjeta (estado, título y número iguales)", async () => {
  const despues = await filas(`SELECT "id", "titulo", "estado"::text AS "estado", "numero" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.deepEqual(despues, antes);
});

await prueba("existe el índice (tableroId, archivadaEn)", async () => {
  const indices = await filas(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'TarjetaTablero' AND indexname = 'TarjetaTablero_tableroId_archivadaEn_idx'`,
  );
  assert.equal(indices.length, 1);
  assert.match(indices[0].indexdef, /"tableroId", "archivadaEn"/);
});

await prueba("la migración es solo aditiva y va en BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA).replace(/--.*$/gm, "");
  for (const prohibido of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i, /ALTER\s+TABLE[^;]*\bTYPE\b/i]) {
    assert.ok(!prohibido.test(texto), `el SQL no puede tener ${prohibido}`);
  }
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  assert.ok(/ADD COLUMN IF NOT EXISTS "archivadaEn"/.test(texto) && /CREATE INDEX IF NOT EXISTS/.test(texto), "con guardas IF NOT EXISTS");
});

await prueba("se puede aplicar dos veces sin error y una tarjeta se puede archivar", async () => {
  await db.exec(leer(NUEVA));
  await db.exec(`UPDATE "TarjetaTablero" SET "archivadaEn" = now(), "terminadaEn" = now() - interval '4 days' WHERE "id" = 'c1'`);
  const [fila] = await filas(`SELECT "estado"::text AS "estado", "archivadaEn" IS NOT NULL AS "archivada" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.deepEqual(fila, { estado: "HECHO", archivada: true }, "archivar no cambia el estado");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
