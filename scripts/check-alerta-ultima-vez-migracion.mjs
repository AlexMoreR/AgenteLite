/**
 * Prueba de la migración "alerta repetida sube" (prisma/migrations/20261105120000_alerta_ultima_vez) contra un
 * Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:alerta-ultima-vez-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta, y crea alertas como las de hoy.
 * 2. Aplica la nueva: cada alerta de antes queda con ultimaVez = su creadoEn (nada se pierde ni cambia de orden).
 * 3. La vuelve a aplicar (no debe fallar), una alerta nueva sin ultimaVez toma la hora de ahora y una repetición
 *    la mueve sin tocar creadoEn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261105120000_alerta_ultima_vez";

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

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

await db.exec(`
  INSERT INTO "AlertaInterna" ("id", "workspaceId", "clave", "prioridad", "titulo", "origen", "veces", "creadoEn") VALUES
    ('a1', 'ws1', 'sup:INC:libro-v318:combo-camilla', 'ALTA', 'Después del cambio del libro V3', 'Supervisor', 4, '2026-10-27 08:00:00'),
    ('a2', 'ws1', 'k2', 'BAJA', 'Otra', 'Coordinador', 1, '2026-10-27 09:30:00');
`);

assert.match(leer(NUEVA), /^BEGIN;$/m);
assert.match(leer(NUEVA), /^COMMIT;$/m);
assert.doesNotMatch(leer(NUEVA), /DROP|DELETE|TRUNCATE/i, "solo aditiva");
await db.exec(leer(NUEVA));

const iso = (valor) => new Date(valor).toISOString();

await prueba("las alertas de antes quedan con ultimaVez = creadoEn y no se pierde ninguna", async () => {
  const resultado = await filas(`SELECT "id", "creadoEn", "ultimaVez", "veces" FROM "AlertaInterna" ORDER BY "id"`);
  assert.equal(resultado.length, 2);
  for (const fila of resultado) assert.equal(iso(fila.ultimaVez), iso(fila.creadoEn));
  assert.equal(resultado[0].veces, 4);
});

await prueba("se puede volver a aplicar sin fallar y la columna queda NOT NULL con valor por defecto", async () => {
  await db.exec(leer(NUEVA));
  const [columna] = await filas(
    `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'AlertaInterna' AND column_name = 'ultimaVez'`,
  );
  assert.equal(columna.is_nullable, "NO");
  assert.match(columna.column_default, /CURRENT_TIMESTAMP/i);
});

await prueba("una alerta nueva sin ultimaVez toma la hora de ahora; una repetición la mueve y deja creadoEn", async () => {
  await db.exec(`INSERT INTO "AlertaInterna" ("id", "workspaceId", "clave", "prioridad", "titulo", "origen") VALUES ('a3', 'ws1', 'k3', 'MEDIA', 'Nueva', 'Supervisor')`);
  const [nueva] = await filas(`SELECT "creadoEn", "ultimaVez" FROM "AlertaInterna" WHERE "id" = 'a3'`);
  assert.ok(nueva.ultimaVez);
  await db.exec(`UPDATE "AlertaInterna" SET "veces" = "veces" + 1, "ultimaVez" = '2026-10-27 21:40:00' WHERE "id" = 'a1'`);
  const orden = await filas(`SELECT "id" FROM "AlertaInterna" WHERE "id" IN ('a1','a2') ORDER BY "ultimaVez" DESC`);
  assert.deepEqual(orden.map((f) => f.id), ["a1", "a2"], "la repetida sube");
  const [a1] = await filas(`SELECT "creadoEn", "veces" FROM "AlertaInterna" WHERE "id" = 'a1'`);
  assert.equal(iso(a1.creadoEn), iso("2026-10-27 08:00:00"));
  assert.equal(a1.veces, 5);
});

console.log(`\n${pruebas} pruebas de la migración "alerta repetida sube": todas pasaron.`);
