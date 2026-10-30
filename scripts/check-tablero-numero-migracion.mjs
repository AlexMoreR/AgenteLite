/**
 * Prueba de la migración del código corto de las tarjetas (prisma/migrations/20261107120000_tablero_numero)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:tablero-numero-migracion
 *
 * 1. Aplica las migraciones reales anteriores a esta y crea 3 tarjetas.
 * 2. Aplica la nueva: las 3 tienen número, sin vacíos y todos distintos.
 * 3. Una tarjeta nueva recibe el número siguiente.
 * 4. El SQL no tiene DROP, DELETE, TRUNCATE, UPDATE ni ALTER ... TYPE.
 * 5. Se vuelve a aplicar sin error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261107120000_tablero_numero";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
// No se exige que sea la última: las migraciones que vienen después (otras tarjetas) no la cambian, y
// abajo solo se aplican las anteriores a esta, como en las demás pruebas de migración.

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
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Ventas');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId") VALUES
    ('c1', 'tab1', 'Uno', 'IDEA', 'u-dueno', now(), 'tarea'),
    ('c2', 'tab1', 'Dos', 'IDEA', 'u-dueno', now(), 'tarea'),
    ('c3', 'tab1', 'Tres', 'IDEA', 'u-dueno', now(), 'tarea');
`);

await db.exec(leer(NUEVA));

await prueba("las tarjetas de antes reciben número, sin vacíos y todos distintos", async () => {
  const tarjetas = await filas(`SELECT "id", "titulo", "numero" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.equal(tarjetas.length, 3);
  for (const tarjeta of tarjetas) assert.ok(Number.isInteger(tarjeta.numero) && tarjeta.numero > 0, `${tarjeta.id} sin número`);
  assert.equal(new Set(tarjetas.map((t) => t.numero)).size, 3, "números repetidos");
  assert.deepEqual(tarjetas.map((t) => t.titulo), ["Uno", "Dos", "Tres"], "no se reescribe nada");
});

await prueba("una tarjeta nueva recibe el número siguiente", async () => {
  const [{ maximo }] = await filas(`SELECT max("numero") AS maximo FROM "TarjetaTablero"`);
  await db.exec(`INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId")
    VALUES ('c4', 'tab1', 'Cuatro', 'IDEA', 'u-dueno', now(), 'tarea')`);
  const [nueva] = await filas(`SELECT "numero" FROM "TarjetaTablero" WHERE "id" = 'c4'`);
  assert.equal(nueva.numero, maximo + 1);
});

await prueba("el número es único (hay índice único)", async () => {
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'TarjetaTablero' AND indexname = 'TarjetaTablero_numero_key'`);
  assert.equal(indices.length, 1);
});

await prueba("la migración es solo aditiva", async () => {
  const texto = leer(NUEVA).replace(/--.*$/gm, "");
  for (const prohibido of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i, /ALTER\s+TABLE[^;]*\bTYPE\b/i]) {
    assert.ok(!prohibido.test(texto), `el SQL no puede tener ${prohibido}`);
  }
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
});

await prueba("se puede aplicar dos veces sin error ni cambiar los números", async () => {
  const antes = await filas(`SELECT "id", "numero" FROM "TarjetaTablero" ORDER BY "id"`);
  await db.exec(leer(NUEVA));
  const despues = await filas(`SELECT "id", "numero" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.deepEqual(despues, antes);
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
