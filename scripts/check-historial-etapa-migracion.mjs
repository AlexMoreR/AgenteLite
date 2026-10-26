/**
 * Prueba de la migración del historial de etapas (prisma/migrations/20261025120000_historial_etapa)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:historial-etapa-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía.
 * 2. Comprueba la tabla, la llave a "Contact" (CASCADE), los índices y los valores por defecto.
 * 3. Comprueba que es aditiva (no toca "Contact") y que se puede volver a aplicar sin fallar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261025120000_historial_etapa";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

for (const nombre of migraciones) {
  if (nombre === NUEVA) {
    // Foto de "Contact" justo antes: la nueva no puede cambiarla.
    globalThis.antes = JSON.stringify(
      await filas(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Contact' ORDER BY column_name`),
    );
  }
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.length} migraciones en orden`);

await prueba("es una transacción solo aditiva (sin DROP, RENAME ni ALTER COLUMN)", async () => {
  const sql = leer(NUEVA);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.doesNotMatch(sql, /\bDROP\b|\bRENAME\b|ALTER COLUMN|DELETE FROM|TRUNCATE/i);
});

await prueba("la tabla tiene sus columnas", async () => {
  const columnas = await filas(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'HistorialEtapa' ORDER BY column_name`,
  );
  const nulos = Object.fromEntries(columnas.map((c) => [c.column_name, c.is_nullable]));
  assert.deepEqual(
    Object.keys(nulos).sort(),
    ["contactId", "conversationId", "creadoEn", "etapaAnterior", "etapaNueva", "id", "nota", "origen", "quien", "workspaceId"],
  );
  for (const c of ["conversationId", "etapaAnterior", "quien", "nota"]) assert.equal(nulos[c], "YES", c);
  for (const c of ["id", "workspaceId", "contactId", "etapaNueva", "origen", "creadoEn"]) assert.equal(nulos[c], "NO", c);
});

await prueba("tiene la llave a Contact con CASCADE y los dos índices", async () => {
  const llave = await filas(
    `SELECT confdeltype FROM pg_constraint WHERE conname = 'HistorialEtapa_contactId_fkey'`,
  );
  assert.equal(llave.length, 1);
  assert.equal(llave[0].confdeltype, "c");
  const indices = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'HistorialEtapa' ORDER BY indexname`)).map((i) => i.indexname);
  assert.deepEqual(indices, [
    "HistorialEtapa_contactId_creadoEn_idx",
    "HistorialEtapa_pkey",
    "HistorialEtapa_workspaceId_creadoEn_idx",
  ]);
});

await prueba("guarda una fila, pone la hora sola y se borra con el cliente", async () => {
  await db.exec(`INSERT INTO "Workspace" ("id","name","slug","updatedAt") VALUES ('w1','N','n',NOW())`).catch(() => {});
  const contacto = await filas(`SELECT column_name FROM information_schema.columns WHERE table_name='Contact' AND is_nullable='NO' AND column_default IS NULL`);
  assert.ok(contacto.length > 0);
  // Se prueba la llave sin depender de todas las columnas obligatorias de Contact: se desactivan los
  // triggers de llaves solo para sembrar el cliente y se vuelven a activar para el borrado en cascada.
  await db.exec(`SET session_replication_role = replica`);
  await db.exec(`INSERT INTO "Contact" ("id","workspaceId","phoneNumber","updatedAt") VALUES ('c1','w1','573000000000',NOW())`);
  await db.exec(`SET session_replication_role = DEFAULT`);
  await db.exec(
    `INSERT INTO "HistorialEtapa" ("id","workspaceId","contactId","etapaNueva","origen") VALUES ('h1','w1','c1','CALIFICADO','BOT')`,
  );
  const fila = (await filas(`SELECT "creadoEn" FROM "HistorialEtapa" WHERE "id" = 'h1'`))[0];
  assert.ok(fila.creadoEn instanceof Date && Math.abs(Date.now() - fila.creadoEn.getTime()) < 3_600_000 * 24);
  await assert.rejects(() =>
    db.exec(`INSERT INTO "HistorialEtapa" ("id","workspaceId","contactId","etapaNueva","origen") VALUES ('h2','w1','no-existe','X','BOT')`),
  );
  await db.exec(`DELETE FROM "Contact" WHERE "id" = 'c1'`);
  assert.equal((await filas(`SELECT count(*)::int AS n FROM "HistorialEtapa"`))[0].n, 0);
});

await prueba("no cambió la tabla Contact", async () => {
  const despues = JSON.stringify(
    await filas(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Contact' ORDER BY column_name`),
  );
  assert.equal(despues, globalThis.antes);
});

await prueba("se puede aplicar dos veces sin fallar", async () => {
  await db.exec(leer(NUEVA));
  await db.exec(leer(NUEVA));
});

console.log(`\n${pruebas} pruebas OK`);
