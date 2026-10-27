/**
 * Prueba de la migración de las versiones del embudo (prisma/migrations/20261031120000_embudo_versiones)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:embudo-versiones-migracion
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261031120000_embudo_versiones";
const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

const migraciones = fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");
const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (texto) => (await db.query(texto)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) continue;
  await db.exec(leer(nombre));
}
const tablasAntes = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
await db.exec(leer(NUEVA));

await prueba("solo agrega las dos tablas nuevas", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  assert.deepEqual(despues.filter((t) => !tablasAntes.includes(t)).sort(), ["EmbudoChatVersion", "EmbudoVersion"]);
  assert.ok(tablasAntes.every((t) => despues.includes(t)));
});

await prueba("columnas obligatorias y opcionales", async () => {
  const cols = async (tabla) =>
    Object.fromEntries((await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = '${tabla}'`)).map((c) => [c.column_name, c.is_nullable]));
  const v = await cols("EmbudoVersion");
  for (const c of ["id", "workspaceId", "productId", "numero", "origen", "huella", "contenido", "creadoEn"]) assert.equal(v[c], "NO", c);
  for (const c of ["nota", "quienId", "quienNombre"]) assert.equal(v[c], "YES", c);
  const c = await cols("EmbudoChatVersion");
  for (const k of ["conversationId", "workspaceId", "productId", "versionId", "numero", "asignadaPor", "creadoEn"]) assert.equal(c[k], "NO", k);
});

await prueba("un solo número por producto y un solo registro por chat; por defecto 'vigente'", async () => {
  await db.exec(`INSERT INTO "Product" ("id","workspaceId","name","price","thumbnailUrl","slug","updatedAt") VALUES ('p1','ws1','Combo',1,'','combo',now())`).catch(async () => {
    // Si Product exige más columnas, se prueba sin la llave: se apaga la verificación solo para la prueba.
    await db.exec(`SET session_replication_role = replica`);
  });
  await db.exec(`INSERT INTO "EmbudoVersion" ("id","workspaceId","productId","numero","origen","huella","contenido") VALUES ('v1','ws1','p1',1,'inicial','h','{}')`);
  await assert.rejects(() => db.exec(`INSERT INTO "EmbudoVersion" ("id","workspaceId","productId","numero","origen","huella","contenido") VALUES ('v1b','ws1','p1',1,'mcp','h2','{}')`), /unique|duplicate/i);
  await db.exec(`INSERT INTO "EmbudoChatVersion" ("conversationId","workspaceId","productId","versionId","numero") VALUES ('c1','ws1','p1','v1',1)`);
  await assert.rejects(() => db.exec(`INSERT INTO "EmbudoChatVersion" ("conversationId","workspaceId","productId","versionId","numero") VALUES ('c1','ws1','p1','v1',1)`), /unique|duplicate/i);
  const [fila] = await filas(`SELECT "asignadaPor" FROM "EmbudoChatVersion" WHERE "conversationId" = 'c1'`);
  assert.equal(fila.asignadaPor, "vigente");
});

await prueba("existen los índices", async () => {
  const nombres = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename IN ('EmbudoVersion','EmbudoChatVersion')`)).map((i) => i.indexname);
  for (const n of ["EmbudoVersion_productId_numero_key", "EmbudoVersion_workspaceId_creadoEn_idx", "EmbudoChatVersion_versionId_idx", "EmbudoChatVersion_workspaceId_productId_creadoEn_idx"]) {
    assert.ok(nombres.includes(n), n);
  }
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "EmbudoVersion"`)).length, 1);
  assert.equal((await filas(`SELECT 1 FROM "EmbudoChatVersion"`)).length, 1);
});

await prueba("es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
