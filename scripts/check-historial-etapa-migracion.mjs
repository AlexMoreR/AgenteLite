/**
 * Prueba de la migración del historial de etapas del CRM
 * (prisma/migrations/20261025120000_historial_etapa) contra un Postgres embebido (PGlite),
 * sin tocar ninguna base real:
 *   npm run test:historial-etapa-migracion
 *
 * Aplica todas las migraciones anteriores, inserta datos como los de hoy, aplica la nueva y comprueba la
 * tabla, la llave a "Contact" (borra el historial con el cliente), los índices, que sea aditiva y que se
 * pueda correr dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261025120000_historial_etapa";

const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

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

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('ct1', 'ws1', '573001', now());
`);
const contactosAntes = await filas(`SELECT * FROM "Contact" ORDER BY "id"`);

await db.exec(leer(NUEVA));

await prueba("la tabla HistorialEtapa existe con sus columnas", async () => {
  const cols = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'HistorialEtapa' ORDER BY column_name`,
  );
  const por = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  for (const obligatoria of ["id", "workspaceId", "contactId", "etapaNueva", "origen", "creadoEn"]) {
    assert.equal(por[obligatoria]?.is_nullable, "NO", `${obligatoria} es obligatoria`);
  }
  for (const opcional of ["conversationId", "etapaAnterior", "quien", "nota"]) {
    assert.equal(por[opcional]?.is_nullable, "YES", `${opcional} es opcional`);
  }
  assert.equal(cols.length, 10);
});

await prueba("los contactos de antes quedan intactos y el historial empieza vacío", async () => {
  assert.deepEqual(await filas(`SELECT * FROM "Contact" ORDER BY "id"`), contactosAntes);
  assert.equal((await filas(`SELECT 1 FROM "HistorialEtapa"`)).length, 0);
});

await prueba("la llave a Contact existe, rechaza contactos que no existen y borra el historial con el cliente", async () => {
  const llaves = await filas(
    `SELECT c.confdeltype, f.relname AS destino FROM pg_constraint c JOIN pg_class f ON f.oid = c.confrelid
     WHERE c.conname = 'HistorialEtapa_contactId_fkey' AND c.contype = 'f'`,
  );
  assert.equal(llaves.length, 1);
  assert.equal(llaves[0].destino, "Contact");
  assert.equal(llaves[0].confdeltype, "c", "ON DELETE CASCADE");
  await assert.rejects(
    () => db.exec(`INSERT INTO "HistorialEtapa" ("id","workspaceId","contactId","etapaNueva","origen") VALUES ('h0','ws1','nadie','NUEVO','BOT')`),
    /foreign key|violates/i,
  );
  await db.exec(`INSERT INTO "HistorialEtapa" ("id","workspaceId","contactId","etapaAnterior","etapaNueva","origen","quien") VALUES ('h1','ws1','ct1','NUEVO','CALIFICADO','ASESORA','u-dueno')`);
  const [fila] = await filas(`SELECT "creadoEn" FROM "HistorialEtapa" WHERE "id" = 'h1'`);
  assert.ok(fila.creadoEn, "la fecha se pone sola");
});

await prueba("existen los dos índices", async () => {
  const indices = await filas(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'HistorialEtapa'`);
  const def = (n) => indices.find((i) => i.indexname === n)?.indexdef ?? "";
  assert.ok(def("HistorialEtapa_contactId_creadoEn_idx").includes('("contactId", "creadoEn")'));
  assert.ok(def("HistorialEtapa_workspaceId_creadoEn_idx").includes('("workspaceId", "creadoEn")'));
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "HistorialEtapa"`)).length, 1);
  assert.equal((await filas(`SELECT 1 FROM pg_constraint WHERE conname = 'HistorialEtapa_contactId_fkey'`)).length, 1);
});

await prueba("borrar el cliente borra su historial", async () => {
  await db.exec(`DELETE FROM "Contact" WHERE "id" = 'ct1'`);
  assert.equal((await filas(`SELECT 1 FROM "HistorialEtapa"`)).length, 0);
});

await prueba("la migración es solo aditiva", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  assert.ok(!/CREATE TYPE/i.test(texto), "no crea tipos nuevos");
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|ALTER\s+TABLE\s+"?(?!HistorialEtapa)\w+"?|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")), "no toca nada existente");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
