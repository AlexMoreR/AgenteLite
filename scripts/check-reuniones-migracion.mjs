/**
 * Prueba de la migración del módulo Reuniones (prisma/migrations/20261023120000_reuniones) contra un
 * Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:reuniones-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía (la de reuniones incluida).
 * 2. Inserta un negocio, un usuario, una reunión con participantes y pistas.
 * 3. Comprueba los índices únicos (codigo, sala, (reunionId, identidad), egressId), los valores por
 *    defecto, las FK (SET NULL y CASCADE) y que se puede volver a aplicar sin fallar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261023120000_reuniones";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
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
const contar = async (tabla) => (await filas(`SELECT count(*)::int AS n FROM "${tabla}"`))[0].n;

for (const nombre of migraciones) {
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.length} migraciones en orden`);

await prueba("la migración es una transacción (BEGIN/COMMIT) y crea el enum y las tres tablas", async () => {
  assert.match(leer(NUEVA), /^BEGIN;$/m);
  assert.match(leer(NUEVA), /^COMMIT;$/m);
  const tablas = await filas(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('Reunion', 'ReunionParticipante', 'ReunionPista') ORDER BY table_name`,
  );
  assert.deepEqual(
    tablas.map((fila) => fila.table_name),
    ["Reunion", "ReunionParticipante", "ReunionPista"],
  );
  const valores = await filas(`SELECT unnest(enum_range(NULL::"EstadoReunion"))::text AS v`);
  assert.deepEqual(
    valores.map((fila) => fila.v),
    ["ESPERANDO", "EN_VIVO", "EN_COLA", "TRANSCRIBIENDO", "HACIENDO_ACTA", "LISTA", "ERROR"],
  );
});

// ── Datos de prueba ──────────────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('alex', 'alex@magilus.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES
    ('ws1', 'Magilus', 'magilus', 'alex', now()),
    ('ws2', 'Otro', 'otro', NULL, now());
  INSERT INTO "Reunion" ("id", "workspaceId", "creadaPorId", "titulo", "codigo", "sala", "updatedAt") VALUES
    ('r1', 'ws1', 'alex', 'Reunión de ventas', 'cod-1', 'sala-1', now()),
    ('r2', 'ws2', NULL, 'Otra', 'cod-2', 'sala-2', now());
  INSERT INTO "ReunionParticipante" ("id", "reunionId", "identidad", "nombre", "userId") VALUES
    ('p1', 'r1', 'u_alex', 'Alex', 'alex'),
    ('p2', 'r1', 'i_invitado12345', 'Invitado', NULL);
  INSERT INTO "ReunionPista" ("id", "reunionId", "participanteId", "egressId", "trackSid", "archivo") VALUES
    ('t1', 'r1', 'p1', 'EG_1', 'TR_1', 'sala-1/TR_1.ogg'),
    ('t2', 'r1', 'p2', 'EG_2', 'TR_2', 'sala-1/TR_2.ogg');
`);

await prueba("los valores por defecto: origen VIVO, estado ESPERANDO, intentos 0, pista GRABANDO", async () => {
  const [reunion] = await filas(`SELECT "origen", "estado"::text AS estado, "intentos", "createdAt" FROM "Reunion" WHERE "id" = 'r1'`);
  assert.equal(reunion.origen, "VIVO");
  assert.equal(reunion.estado, "ESPERANDO");
  assert.equal(reunion.intentos, 0);
  assert.ok(reunion.createdAt);
  const [pista] = await filas(`SELECT "estado" FROM "ReunionPista" WHERE "id" = 't1'`);
  assert.equal(pista.estado, "GRABANDO");
  const [participante] = await filas(`SELECT "entroEn", "salioEn" FROM "ReunionParticipante" WHERE "id" = 'p1'`);
  assert.ok(participante.entroEn);
  assert.equal(participante.salioEn, null);
});

await prueba("un estado que no está en el enum se rechaza", async () => {
  await assert.rejects(db.exec(`UPDATE "Reunion" SET "estado" = 'INVENTADO' WHERE "id" = 'r1'`));
});

await prueba("codigo es único (y sala también)", async () => {
  await assert.rejects(
    db.exec(`INSERT INTO "Reunion" ("id", "workspaceId", "titulo", "codigo", "sala", "updatedAt") VALUES ('r3', 'ws1', 'X', 'cod-1', 'sala-3', now())`),
  );
  await assert.rejects(
    db.exec(`INSERT INTO "Reunion" ("id", "workspaceId", "titulo", "codigo", "sala", "updatedAt") VALUES ('r3', 'ws1', 'X', 'cod-3', 'sala-1', now())`),
  );
});

await prueba("(reunionId, identidad) es único; la misma identidad en otra reunión sí se permite", async () => {
  await assert.rejects(
    db.exec(`INSERT INTO "ReunionParticipante" ("id", "reunionId", "identidad", "nombre") VALUES ('p3', 'r1', 'u_alex', 'Alex otra vez')`),
  );
  await db.exec(`INSERT INTO "ReunionParticipante" ("id", "reunionId", "identidad", "nombre") VALUES ('p4', 'r2', 'u_alex', 'Alex')`);
});

await prueba("varias pistas con egressId NULL se permiten; un egressId repetido no", async () => {
  await db.exec(`
    INSERT INTO "ReunionPista" ("id", "reunionId", "archivo", "estado") VALUES
      ('s1', 'r1', 'sala-1/subido-1.mp3', 'LISTA'),
      ('s2', 'r1', 'sala-1/subido-2.mp3', 'LISTA');
  `);
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "ReunionPista" WHERE "egressId" IS NULL`);
  assert.equal(n, 2);
  await assert.rejects(db.exec(`INSERT INTO "ReunionPista" ("id", "reunionId", "egressId") VALUES ('t3', 'r2', 'EG_1')`));
});

await prueba("una pista de LiveKit (reunionId, trackSid) se graba una sola vez; en otra reunión sí", async () => {
  await assert.rejects(db.exec(`INSERT INTO "ReunionPista" ("id", "reunionId", "trackSid") VALUES ('t4', 'r1', 'TR_1')`));
  await db.exec(`INSERT INTO "ReunionPista" ("id", "reunionId", "trackSid") VALUES ('t5', 'r2', 'TR_1')`);
});

await prueba("una reunión de un negocio que no existe se rechaza (FK)", async () => {
  await assert.rejects(
    db.exec(`INSERT INTO "Reunion" ("id", "workspaceId", "titulo", "codigo", "sala", "updatedAt") VALUES ('r9', 'nadie', 'X', 'cod-9', 'sala-9', now())`),
  );
});

await prueba("borrar un participante deja su pista sin participante (SET NULL)", async () => {
  await db.exec(`DELETE FROM "ReunionParticipante" WHERE "id" = 'p2'`);
  const [pista] = await filas(`SELECT "participanteId" FROM "ReunionPista" WHERE "id" = 't2'`);
  assert.equal(pista.participanteId, null);
});

await prueba("borrar al usuario deja la reunión sin creador (SET NULL)", async () => {
  await db.exec(`UPDATE "Workspace" SET "ownerId" = NULL WHERE "id" = 'ws1'`);
  await db.exec(`DELETE FROM "User" WHERE "id" = 'alex'`);
  const [reunion] = await filas(`SELECT "creadaPorId" FROM "Reunion" WHERE "id" = 'r1'`);
  assert.equal(reunion.creadaPorId, null);
});

await prueba("se puede volver a aplicar sin fallar ni tocar los datos", async () => {
  const antes = [await contar("Reunion"), await contar("ReunionParticipante"), await contar("ReunionPista")];
  await db.exec(leer(NUEVA));
  await db.exec(leer(NUEVA));
  assert.deepEqual([await contar("Reunion"), await contar("ReunionParticipante"), await contar("ReunionPista")], antes);
  // Los índices únicos siguen siendo uno solo cada uno.
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE indexname = 'ReunionPista_egressId_key'`);
  assert.equal(indices.length, 1);
});

await prueba("borrar el negocio borra en cascada sus reuniones, participantes y pistas", async () => {
  await db.exec(`DELETE FROM "Workspace" WHERE "id" = 'ws1'`);
  assert.deepEqual(
    (await filas(`SELECT "id" FROM "Reunion" ORDER BY "id"`)).map((fila) => fila.id),
    ["r2"],
  );
  assert.equal((await filas(`SELECT 1 FROM "ReunionParticipante" WHERE "reunionId" = 'r1'`)).length, 0);
  assert.equal((await filas(`SELECT 1 FROM "ReunionPista" WHERE "reunionId" = 'r1'`)).length, 0);
  // Lo del otro negocio sigue.
  assert.equal(await contar("ReunionParticipante"), 1);
});

await db.close();
console.log(`\n${pruebas} pruebas de la migración de reuniones OK`);
