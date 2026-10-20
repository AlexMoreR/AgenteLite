/**
 * Prueba de la migración de tableros por cuenta del Tablero IA
 * (prisma/migrations/20261020180000_tableros_por_cuenta) contra un Postgres embebido (PGlite), sin
 * tocar ninguna base real:
 *   npm run test:tableros-por-cuenta-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía, hasta la anterior a esta.
 * 2. Inserta datos como los de hoy: dos negocios (uno con ownerId y otro sin), sus tableros y tarjetas.
 * 3. Aplica la migración nueva y comprueba el relleno: los tableros quedan del dueño del negocio (o
 *    sin dueño si el negocio no tiene ownerId), nada perdido.
 * 4. La vuelve a aplicar (no debe fallar) y prueba la FK: borrar al usuario deja el tablero sin dueño.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261020180000_tableros_por_cuenta";

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
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;

let anteriores = 0;
for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
    anteriores += 1;
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${anteriores} migraciones anteriores`);

// ── Datos de antes de la migración ─────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES
    ('alex', 'alex@magilus.co', 'x', now()), ('emanuel', 'emanuel@magilus.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES
    ('ws1', 'Magilus', 'magilus', 'alex', now()),
    ('ws2', 'Sin dueño', 'sin-dueno', NULL, now());
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('tab1', 'ws1', 'Magilus General'), ('tab2', 'ws1', 'Desarrollo Emanuel'), ('tab3', 'ws2', 'Ventas');
`);
const tiposAntes = await filas(`SELECT count(*)::int AS n FROM "TipoTarjeta"`);

// ── La migración nueva ─────────────────────────────────────────────────────────────────────
assert.match(leer(NUEVA), /^BEGIN;$/m);
assert.match(leer(NUEVA), /^COMMIT;$/m);
await db.exec(leer(NUEVA));

await prueba("los tableros existentes quedan del dueño del negocio (Workspace.ownerId)", async () => {
  const tableros = await filas(`SELECT "id", "duenoUserId" FROM "TableroInteligente" ORDER BY "id"`);
  assert.deepEqual(tableros, [
    { id: "tab1", duenoUserId: "alex" },
    { id: "tab2", duenoUserId: "alex" },
    { id: "tab3", duenoUserId: null },
  ]);
});

await prueba("nada perdido: los mismos tableros, nombres y tipos", async () => {
  const nombres = await filas(`SELECT "nombre" FROM "TableroInteligente" ORDER BY "id"`);
  assert.deepEqual(nombres.map((fila) => fila.nombre), ["Magilus General", "Desarrollo Emanuel", "Ventas"]);
  assert.deepEqual(await filas(`SELECT count(*)::int AS n FROM "TipoTarjeta"`), tiposAntes);
});

await prueba("la columna es nula y tiene el índice [workspaceId, duenoUserId]", async () => {
  const [columna] = await filas(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'TableroInteligente' AND column_name = 'duenoUserId'`,
  );
  assert.equal(columna.is_nullable, "YES");
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'TableroInteligente'`);
  assert.ok(indices.some((fila) => fila.indexname === "TableroInteligente_workspaceId_duenoUserId_idx"));
});

await prueba("se puede volver a aplicar sin fallar ni pisar un dueño ya puesto", async () => {
  await db.exec(`UPDATE "TableroInteligente" SET "duenoUserId" = 'emanuel' WHERE "id" = 'tab2'`);
  await db.exec(leer(NUEVA));
  const [fila] = await filas(`SELECT "duenoUserId" FROM "TableroInteligente" WHERE "id" = 'tab2'`);
  assert.equal(fila.duenoUserId, "emanuel");
  const fks = await filas(`SELECT conname FROM pg_constraint WHERE conname = 'TableroInteligente_duenoUserId_fkey'`);
  assert.equal(fks.length, 1);
});

await prueba("un dueño que no existe se rechaza; borrar al usuario deja el tablero sin dueño", async () => {
  await assert.rejects(db.exec(`UPDATE "TableroInteligente" SET "duenoUserId" = 'nadie' WHERE "id" = 'tab1'`));
  await db.exec(`DELETE FROM "User" WHERE "id" = 'emanuel'`);
  const [fila] = await filas(`SELECT "duenoUserId" FROM "TableroInteligente" WHERE "id" = 'tab2'`);
  assert.equal(fila.duenoUserId, null);
});

await db.close();
console.log(`${pruebas} pruebas ok`);
