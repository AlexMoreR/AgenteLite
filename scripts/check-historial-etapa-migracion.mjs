/**
 * Prueba de la migración del historial de etapas (prisma/migrations/20261025120000_historial_etapa)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:historial-etapa-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta.
 * 2. Inserta un negocio y un cliente como los de hoy.
 * 3. Aplica la nueva y comprueba tabla, llave foránea e índices, y que lo de antes sigue igual.
 * 4. Revisa que sea aditiva (sin DROP, DELETE, TRUNCATE, RENAME ni UPDATE) y con BEGIN/COMMIT.
 * 5. La vuelve a aplicar (no debe fallar ni duplicar nada).
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
const filas = async (texto, valores = []) => (await db.query(texto, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.indexOf(NUEVA)} migraciones anteriores`);

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u1', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u1');
  INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('ct1', 'ws1', '573000000001', now());
`);
const contactosAntes = await filas(`SELECT "id", "crmStage", "phoneNumber" FROM "Contact" ORDER BY "id"`);

await prueba("la migración es aditiva: sin DROP, DELETE, TRUNCATE, RENAME ni UPDATE, y con BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA)
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .replace(/ON (DELETE|UPDATE) CASCADE/gi, "");
  assert.doesNotMatch(texto, /\b(DROP|DELETE|TRUNCATE|RENAME|UPDATE)\b/i);
  assert.match(texto, /^BEGIN;$/m);
  assert.match(texto, /^COMMIT;$/m);
  assert.match(texto, /IF NOT EXISTS/);
});

await db.exec(leer(NUEVA));

await prueba("lo de antes sigue igual", async () => {
  assert.deepEqual(await filas(`SELECT "id", "crmStage", "phoneNumber" FROM "Contact" ORDER BY "id"`), contactosAntes);
});

await prueba("HistorialEtapa: columnas, nulos y fecha automática", async () => {
  const columnas = Object.fromEntries(
    (await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'HistorialEtapa'`)).map((c) => [
      c.column_name,
      c.is_nullable,
    ]),
  );
  for (const c of ["id", "workspaceId", "contactId", "conversationId", "etapaAnterior", "etapaNueva", "origen", "quien", "nota", "creadoEn"]) {
    assert.ok(c in columnas, `falta la columna ${c}`);
  }
  for (const c of ["conversationId", "etapaAnterior", "quien", "nota"]) assert.equal(columnas[c], "YES", `${c} puede ir vacío`);
  for (const c of ["id", "workspaceId", "contactId", "etapaNueva", "origen", "creadoEn"]) assert.equal(columnas[c], "NO", `${c} es obligatorio`);
  await db.exec(`INSERT INTO "HistorialEtapa" ("id", "workspaceId", "contactId", "etapaNueva", "origen") VALUES ('h1', 'ws1', 'ct1', 'CALIFICADO', 'ASESORA')`);
  const [fila] = await filas(`SELECT "creadoEn", "etapaAnterior" FROM "HistorialEtapa" WHERE "id" = 'h1'`);
  assert.ok(fila.creadoEn);
  assert.equal(fila.etapaAnterior, null);
});

await prueba("exige un cliente existente y cae junto con el cliente", async () => {
  await assert.rejects(
    db.query(`INSERT INTO "HistorialEtapa" ("id", "workspaceId", "contactId", "etapaNueva", "origen") VALUES ('h2', 'ws1', 'nadie', 'NUEVO', 'BOT')`),
    /foreign key/i,
  );
  await db.exec(`INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('ct2', 'ws1', '573000000002', now())`);
  await db.exec(`INSERT INTO "HistorialEtapa" ("id", "workspaceId", "contactId", "etapaNueva", "origen") VALUES ('h3', 'ws1', 'ct2', 'NUEVO', 'BOT')`);
  await db.exec(`DELETE FROM "Contact" WHERE "id" = 'ct2'`);
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "HistorialEtapa" WHERE "contactId" = 'ct2'`);
  assert.equal(n, 0);
  const [{ queda }] = await filas(`SELECT count(*)::int AS queda FROM "HistorialEtapa" WHERE "id" = 'h1'`);
  assert.equal(queda, 1);
});

await prueba("existen los dos índices", async () => {
  const indices = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'HistorialEtapa'`)).map((i) => i.indexname);
  assert.ok(indices.includes("HistorialEtapa_contactId_creadoEn_idx"));
  assert.ok(indices.includes("HistorialEtapa_workspaceId_creadoEn_idx"));
});

await prueba("aplicarla otra vez no falla ni duplica ni pierde nada", async () => {
  await db.exec(leer(NUEVA));
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "HistorialEtapa"`);
  assert.equal(n, 1);
  assert.deepEqual(await filas(`SELECT "id", "crmStage", "phoneNumber" FROM "Contact" ORDER BY "id"`), contactosAntes);
});

await db.close();
console.log(`\n${pruebas} pruebas, todas bien`);
