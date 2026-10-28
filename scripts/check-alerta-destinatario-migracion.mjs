/**
 * Prueba de la migración de alertas personales (prisma/migrations/20261104120000_alerta_destinatario) contra un
 * Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:alerta-destinatario-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta, y crea alertas como las de hoy.
 * 2. Aplica la nueva: las alertas de siempre quedan con destinatarioId en null (del negocio), nada se pierde.
 * 3. La vuelve a aplicar (no debe fallar) y comprueba que una alerta personal se guarda y se separa por persona.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261104120000_alerta_destinatario";

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
  INSERT INTO "AlertaInterna" ("id", "workspaceId", "clave", "prioridad", "titulo", "origen") VALUES
    ('a1', 'ws1', 'auto:necesita:t1:ERROR', 'URGENTE', 'Algo del negocio', 'Coordinador'),
    ('a2', 'ws1', 'k2', 'BAJA', 'Otra', 'Supervisor');
`);

assert.match(leer(NUEVA), /^BEGIN;$/m);
assert.match(leer(NUEVA), /^COMMIT;$/m);
await db.exec(leer(NUEVA));

await prueba("las alertas de antes quedan del negocio (destinatarioId null) y no se pierde ninguna", async () => {
  assert.deepEqual(await filas(`SELECT "id", "destinatarioId" FROM "AlertaInterna" ORDER BY "id"`), [
    { id: "a1", destinatarioId: null },
    { id: "a2", destinatarioId: null },
  ]);
});

await prueba("se puede volver a aplicar sin fallar y deja el índice", async () => {
  await db.exec(leer(NUEVA));
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'AlertaInterna'`);
  assert.ok(indices.some((i) => i.indexname === "AlertaInterna_workspaceId_destinatarioId_estado_idx"));
});

await prueba("una alerta personal se guarda y cada persona ve solo la suya", async () => {
  await db.exec(`
    INSERT INTO "AlertaInterna" ("id", "workspaceId", "clave", "prioridad", "titulo", "origen", "destinatarioId") VALUES
      ('p1', 'ws1', 'auto:equipo:t1:asignada:u_em', 'MEDIA', 'Emanuel, tienes una tarea nueva', 'Tablero IA', 'u_em'),
      ('p2', 'ws1', 'auto:equipo:t2:asignada:u_ana', 'MEDIA', 'Ana, tienes una tarea nueva', 'Tablero IA', 'u_ana');
  `);
  const de = async (u) => (await filas(`SELECT "id" FROM "AlertaInterna" WHERE "workspaceId"='ws1' AND "destinatarioId" = $1 ORDER BY "id"`, [u])).map((f) => f.id);
  assert.deepEqual(await de("u_em"), ["p1"]);
  assert.deepEqual(await de("u_ana"), ["p2"]);
  const delNegocio = await filas(`SELECT "id" FROM "AlertaInterna" WHERE "destinatarioId" IS NULL ORDER BY "id"`);
  assert.deepEqual(delNegocio.map((f) => f.id), ["a1", "a2"]);
});

console.log(`\n${pruebas} pruebas de la migración de alertas personales: todas pasaron.`);
