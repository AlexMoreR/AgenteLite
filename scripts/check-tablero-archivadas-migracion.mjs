/**
 * Prueba de la migración de las tarjetas archivadas (prisma/migrations/20261111120000_tablero_archivadas)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:tablero-archivadas-migracion
 *
 * 1. Aplica las migraciones reales anteriores a esta y crea 2 tarjetas (una HECHO).
 * 2. Aplica la nueva: las columnas archivadaEn y terminadaEn existen y quedan vacías; nada más cambia.
 * 3. Existe el índice (tableroId, archivadaEn).
 * 4. El SQL no tiene DROP, DELETE, TRUNCATE, UPDATE ni ALTER ... TYPE, y va en BEGIN/COMMIT.
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
// No se exige que sea la última: abajo solo se aplican las anteriores a esta, como en las demás pruebas de migración.

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
    ('c1', 'tab1', 'Hecha', 'HECHO', 'u-dueno', now(), 'tarea'),
    ('c2', 'tab1', 'Abierta', 'IDEA', 'u-dueno', now(), 'tarea');
`);
const antesDeMigrar = await filas(`SELECT "id", "titulo", "estado", "numero" FROM "TarjetaTablero" ORDER BY "id"`);

await db.exec(leer(NUEVA));

await prueba("las columnas nuevas existen y quedan vacías", async () => {
  const columnas = await filas(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'TarjetaTablero' AND column_name IN ('archivadaEn', 'terminadaEn') ORDER BY column_name`,
  );
  assert.deepEqual(columnas.map((c) => [c.column_name, c.is_nullable]), [["archivadaEn", "YES"], ["terminadaEn", "YES"]]);
  const tarjetas = await filas(`SELECT "archivadaEn", "terminadaEn" FROM "TarjetaTablero"`);
  assert.equal(tarjetas.length, 2);
  for (const tarjeta of tarjetas) assert.ok(tarjeta.archivadaEn === null && tarjeta.terminadaEn === null, "quedan vacías");
});

await prueba("no cambia nada de lo que había", async () => {
  assert.deepEqual(await filas(`SELECT "id", "titulo", "estado", "numero" FROM "TarjetaTablero" ORDER BY "id"`), antesDeMigrar);
});

await prueba("existe el índice (tableroId, archivadaEn)", async () => {
  const indices = await filas(`SELECT indexdef FROM pg_indexes WHERE tablename = 'TarjetaTablero' AND indexname = 'TarjetaTablero_tableroId_archivadaEn_idx'`);
  assert.equal(indices.length, 1);
  assert.match(indices[0].indexdef, /"tableroId", "archivadaEn"/);
});

await prueba("la migración es solo aditiva", async () => {
  const texto = leer(NUEVA).replace(/--.*$/gm, "");
  for (const prohibido of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i, /ALTER\s+TABLE[^;]*\bTYPE\b/i]) {
    assert.ok(!prohibido.test(texto), `el SQL no puede tener ${prohibido}`);
  }
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
});

await prueba("se puede aplicar dos veces sin error", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "archivadaEn" = now() WHERE "id" = 'c1'`);
  await db.exec(leer(NUEVA));
  const [c1] = await filas(`SELECT "archivadaEn" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.ok(c1.archivadaEn instanceof Date, "lo que ya estaba archivado se conserva");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
