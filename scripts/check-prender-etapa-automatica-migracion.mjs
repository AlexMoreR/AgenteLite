/**
 * Prueba de la migración que PRENDE la etapa automática (prisma/migrations/20261122000000_prender_etapa_automatica)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:prender-etapa-automatica-migracion
 *
 * 1. Un negocio con la etapa automática en off: queda en on, con descarte, ganado y barrido-ia en off
 *    (aunque el descarte estuviera en on).
 * 2. Un negocio que no la tenía apagada no cambia en nada.
 * 3. Correrla otra vez no cambia nada ni falla. No borra filas.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261122000000_prender_etapa_automatica";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
const filas = async (sql) => (await db.query(sql)).rows;
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

await db.exec(`
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt") VALUES ('ws1', 'Magilus', 'magilus', now()), ('ws2', 'Otro', 'otro', now());
  INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES
    ('crm:etapa-automatica:ws1', 'off', now()),
    ('crm:etapa-automatica:descarte:ws1', 'on', now()),
    ('reparto:cuando:ws1', '{"agentePide":true}', now());
`);

const sql = leer(NUEVA);
assert.match(sql, /^BEGIN;$/m);
assert.match(sql, /^COMMIT;$/m);
assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|ALTER/i, "solo cambia interruptores");

const ajustes = async () =>
  Object.fromEntries((await filas(`SELECT "key", "value" FROM "AppSetting" ORDER BY "key"`)).map((f) => [f.key, f.value]));

await db.exec(sql);
const despues = await ajustes();

await prueba("el negocio apagado queda prendido, con descarte, ganado y la IA del barrido apagados", async () => {
  assert.equal(despues["crm:etapa-automatica:ws1"], "on");
  assert.equal(despues["crm:etapa-automatica:descarte:ws1"], "off");
  assert.equal(despues["crm:etapa-automatica:ganado:ws1"], "off");
  assert.equal(despues["crm:etapa-automatica:barrido-ia:ws1"], "off");
  assert.equal(despues["reparto:cuando:ws1"], '{"agentePide":true}', "no toca otros ajustes");
});

await prueba("un negocio que no la tenía apagada no cambia", async () => {
  assert.deepEqual(
    Object.keys(despues).filter((clave) => clave.endsWith(":ws2")),
    [],
  );
});

await prueba("correrla otra vez no cambia nada", async () => {
  await db.exec(`UPDATE "AppSetting" SET "value" = 'on' WHERE "key" = 'crm:etapa-automatica:ganado:ws1'`);
  await db.exec(sql);
  const otraVez = await ajustes();
  assert.equal(otraVez["crm:etapa-automatica:ws1"], "on");
  assert.equal(otraVez["crm:etapa-automatica:ganado:ws1"], "on", "lo que alguien cambió después no se pisa");
  assert.equal(Object.keys(otraVez).length, Object.keys(despues).length);
});

console.log(`\n${pruebas} pruebas OK`);
