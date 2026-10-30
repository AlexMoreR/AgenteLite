/**
 * Prueba de la migración del módulo Reuniones (prisma/migrations/20261023120000_reuniones) contra un
 * Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:reuniones-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía (la de reuniones incluida).
 * 2. Inserta un negocio, un usuario, una reunión con participantes y pistas.
 * 3. Comprueba los índices únicos (codigo, sala, (reunionId, identidad), egressId), los valores por
 *    defecto, las FK (SET NULL y CASCADE) y que se puede volver a aplicar sin fallar.
 * 4. Salas fijas (20261110120000_reunion_salas): en otra base, aplica todo lo anterior, crea una reunión
 *    con participantes y pistas, aplica la migración de salas (dos veces) y comprueba que la reunión
 *    queda igual y sin sala, que el link de la sala es único y que borrar la sala no borra sus reuniones.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261023120000_reuniones";
const SALAS = "20261110120000_reunion_salas";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
assert.ok(migraciones.includes(SALAS), `falta la migración ${SALAS}`);

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

await prueba("la migración de salas, aplicada en orden sobre la base vacía, corre otra vez sin fallar", async () => {
  await db.exec(leer(SALAS));
  const columna = await filas(`SELECT 1 FROM information_schema.columns WHERE table_name = 'Reunion' AND column_name = 'salaFijaId'`);
  assert.equal(columna.length, 1);
});

await db.close();

// ── Salas fijas: una base con reuniones de antes, y después la migración de salas ─────────────────────
const antes = new PGlite();
const filasAntes = async (sql, valores = []) => (await antes.query(sql, valores)).rows;
for (const nombre of migraciones.filter((nombre) => nombre < SALAS)) {
  await antes.exec(leer(nombre));
}
await antes.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES
    ('alex', 'alex@magilus.co', 'x', now()),
    ('emanuel', 'emanuel@magilus.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES ('ws1', 'Magilus', 'magilus', 'alex', now());
  INSERT INTO "Reunion" ("id", "workspaceId", "creadaPorId", "titulo", "codigo", "sala", "updatedAt") VALUES
    ('vieja', 'ws1', 'alex', 'Reunión de antes', 'reunion-de-antes', 'sala-vieja', now());
  INSERT INTO "ReunionParticipante" ("id", "reunionId", "identidad", "nombre", "userId") VALUES
    ('pv1', 'vieja', 'u_alex', 'Alex', 'alex'),
    ('pv2', 'vieja', 'i_invitado', 'Invitado', NULL);
  INSERT INTO "ReunionPista" ("id", "reunionId", "participanteId", "egressId", "trackSid", "archivo") VALUES
    ('tv1', 'vieja', 'pv1', 'EG_V1', 'TR_V1', 'sala-vieja/TR_V1.ogg');
`);

await prueba("la migración de salas es una transacción (BEGIN/COMMIT) y solo aditiva", async () => {
  const sql = leer(SALAS);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  // Las reglas de las FK (ON DELETE / ON UPDATE) no cuentan: no tocan filas.
  const sinReglas = sql.replace(/\bON\s+(DELETE|UPDATE)\b/gi, "");
  assert.doesNotMatch(sinReglas, /\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/i);
  assert.doesNotMatch(sql, /ALTER\s+COLUMN/i);
});

await prueba("en una base con reuniones de antes, la migración de salas corre dos veces sin fallar", async () => {
  await antes.exec(leer(SALAS));
  await antes.exec(leer(SALAS));
  const tablas = await filasAntes(`SELECT 1 FROM information_schema.tables WHERE table_name = 'SalaDeReuniones'`);
  assert.equal(tablas.length, 1);
  const restricciones = await filasAntes(`SELECT 1 FROM pg_constraint WHERE conname = 'Reunion_salaFijaId_fkey'`);
  assert.equal(restricciones.length, 1);
  const indices = await filasAntes(
    `SELECT indexname FROM pg_indexes WHERE indexname IN ('SalaDeReuniones_codigo_key', 'SalaDeReuniones_workspaceId_idx', 'Reunion_salaFijaId_createdAt_idx') ORDER BY indexname`,
  );
  assert.equal(indices.length, 3);
});

await prueba("la reunión de antes queda sin sala fija y conserva sus participantes y pistas", async () => {
  const [reunion] = await filasAntes(`SELECT "salaFijaId", "titulo", "codigo", "sala", "creadaPorId" FROM "Reunion" WHERE "id" = 'vieja'`);
  assert.deepEqual(reunion, { salaFijaId: null, titulo: "Reunión de antes", codigo: "reunion-de-antes", sala: "sala-vieja", creadaPorId: "alex" });
  assert.equal((await filasAntes(`SELECT 1 FROM "ReunionParticipante" WHERE "reunionId" = 'vieja'`)).length, 2);
  const [pista] = await filasAntes(`SELECT "participanteId", "archivo" FROM "ReunionPista" WHERE "id" = 'tv1'`);
  assert.deepEqual(pista, { participanteId: "pv1", archivo: "sala-vieja/TR_V1.ogg" });
});

await prueba("la sala: sinGrabar en false por defecto y el codigo (link fijo) es único", async () => {
  await antes.exec(`
    INSERT INTO "SalaDeReuniones" ("id", "workspaceId", "nombre", "codigo", "liderId", "creadaPorId", "updatedAt") VALUES
      ('s1', 'ws1', 'Sistemas - Emanuel', 'sistemas-emanuel', 'emanuel', 'alex', now());
  `);
  const [sala] = await filasAntes(`SELECT "sinGrabar", "createdAt" FROM "SalaDeReuniones" WHERE "id" = 's1'`);
  assert.equal(sala.sinGrabar, false);
  assert.ok(sala.createdAt);
  await assert.rejects(
    antes.exec(`INSERT INTO "SalaDeReuniones" ("id", "workspaceId", "nombre", "codigo", "updatedAt") VALUES ('s2', 'ws1', 'Otra', 'sistemas-emanuel', now())`),
  );
  await assert.rejects(
    antes.exec(`INSERT INTO "SalaDeReuniones" ("id", "workspaceId", "nombre", "codigo", "updatedAt") VALUES ('s3', 'nadie', 'X', 'x', now())`),
  );
});

await prueba("una reunión no puede apuntar a una sala que no existe (FK)", async () => {
  await assert.rejects(antes.exec(`UPDATE "Reunion" SET "salaFijaId" = 'no-existe' WHERE "id" = 'vieja'`));
});

await prueba("borrar al líder deja la sala sin líder (SET NULL)", async () => {
  await antes.exec(`DELETE FROM "User" WHERE "id" = 'emanuel'`);
  const [sala] = await filasAntes(`SELECT "liderId" FROM "SalaDeReuniones" WHERE "id" = 's1'`);
  assert.equal(sala.liderId, null);
});

await prueba("al borrar una sala, sus reuniones quedan sin sala fija (SET NULL) y no se borran", async () => {
  await antes.exec(`
    INSERT INTO "Reunion" ("id", "workspaceId", "titulo", "codigo", "sala", "salaFijaId", "updatedAt") VALUES
      ('ds1', 'ws1', 'Sistemas 1', 'sistemas-1', 'sala-ds1', 's1', now());
    INSERT INTO "ReunionParticipante" ("id", "reunionId", "identidad", "nombre") VALUES ('pds1', 'ds1', 'u_alex', 'Alex');
  `);
  await antes.exec(`DELETE FROM "SalaDeReuniones" WHERE "id" = 's1'`);
  const [reunion] = await filasAntes(`SELECT "salaFijaId" FROM "Reunion" WHERE "id" = 'ds1'`);
  assert.equal(reunion.salaFijaId, null);
  assert.equal((await filasAntes(`SELECT 1 FROM "ReunionParticipante" WHERE "reunionId" = 'ds1'`)).length, 1);
});

await prueba("borrar el negocio borra en cascada sus salas", async () => {
  await antes.exec(`
    INSERT INTO "SalaDeReuniones" ("id", "workspaceId", "nombre", "codigo", "updatedAt") VALUES ('s4', 'ws1', 'Ventas', 'ventas', now());
  `);
  await antes.exec(`DELETE FROM "Workspace" WHERE "id" = 'ws1'`);
  assert.equal((await filasAntes(`SELECT 1 FROM "SalaDeReuniones"`)).length, 0);
});

await antes.close();
console.log(`\n${pruebas} pruebas de la migración de reuniones OK`);
