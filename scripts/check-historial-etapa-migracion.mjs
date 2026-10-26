/**
 * Prueba de la migración del historial de etapas del CRM
 * (prisma/migrations/20261025120000_historial_etapa) contra un Postgres embebido (PGlite),
 * sin tocar ninguna base real:
 *   npm run test:historial-etapa-migracion
 *
 * Aplica todas las migraciones reales hasta la anterior, luego la nueva, y comprueba la tabla, la
 * llave foránea (borra el historial si se borra el cliente), los índices, que sea aditiva y que se
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
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u1', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u1');
  INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ('ct1', 'ws1', '573001112233', now());
`);
const contactosAntes = await filas(`SELECT * FROM "Contact"`);

await db.exec(leer(NUEVA));

await prueba("la tabla HistorialEtapa tiene las columnas esperadas", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'HistorialEtapa'`,
  );
  const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  for (const obligatoria of ["id", "workspaceId", "contactId", "etapaNueva", "origen", "creadoEn"]) {
    assert.equal(porNombre[obligatoria]?.is_nullable, "NO", `${obligatoria} es obligatoria`);
  }
  for (const opcional of ["conversationId", "etapaAnterior", "quien", "nota"]) {
    assert.equal(porNombre[opcional]?.is_nullable, "YES", `${opcional} es opcional`);
  }
  assert.equal(columnas.length, 10);
});

await prueba("la fecha se pone sola y el contacto de antes queda intacto", async () => {
  await db.exec(
    `INSERT INTO "HistorialEtapa" ("id", "workspaceId", "contactId", "etapaAnterior", "etapaNueva", "origen", "quien")
     VALUES ('h1', 'ws1', 'ct1', 'NUEVO', 'CALIFICADO', 'ASESORA', 'u1')`,
  );
  const [fila] = await filas(`SELECT "creadoEn" FROM "HistorialEtapa" WHERE "id" = 'h1'`);
  assert.ok(fila.creadoEn instanceof Date);
  assert.deepEqual(await filas(`SELECT * FROM "Contact"`), contactosAntes);
});

await prueba("la llave foránea con Contact existe, borra en cascada y rechaza contactos que no existen", async () => {
  const llaves = await filas(
    `SELECT c.confdeltype, f.relname AS destino FROM pg_constraint c JOIN pg_class f ON f.oid = c.confrelid
     WHERE c.conname = 'HistorialEtapa_contactId_fkey' AND c.contype = 'f'`,
  );
  assert.equal(llaves.length, 1);
  assert.equal(llaves[0].destino, "Contact");
  assert.equal(llaves[0].confdeltype, "c", "ON DELETE CASCADE");
  await assert.rejects(
    () => db.exec(`INSERT INTO "HistorialEtapa" ("id", "workspaceId", "contactId", "etapaNueva", "origen") VALUES ('h2', 'ws1', 'nadie', 'NUEVO', 'BOT')`),
    /foreign key|violates/i,
  );
});

await prueba("existen los dos índices", async () => {
  const indices = await filas(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'HistorialEtapa'`);
  const def = (nombre) => indices.find((i) => i.indexname === nombre)?.indexdef ?? "";
  assert.ok(def("HistorialEtapa_contactId_creadoEn_idx").includes('("contactId", "creadoEn")'));
  assert.ok(def("HistorialEtapa_workspaceId_creadoEn_idx").includes('("workspaceId", "creadoEn")'));
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "HistorialEtapa"`)).length, 1);
  assert.equal((await filas(`SELECT 1 FROM pg_constraint WHERE conname = 'HistorialEtapa_contactId_fkey'`)).length, 1);
});

await prueba("borrar el contacto borra su historial", async () => {
  await db.exec(`DELETE FROM "Contact" WHERE "id" = 'ct1'`);
  assert.equal((await filas(`SELECT 1 FROM "HistorialEtapa"`)).length, 0);
});

await prueba("la migración es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
