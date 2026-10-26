/**
 * Prueba de la migración de las versiones del embudo (prisma/migrations/20261029120000_embudo_versiones)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:embudo-versiones-migracion
 * Aplica las migraciones reales hasta la anterior, luego la nueva, y comprueba las dos tablas, el
 * índice único, que sea aditiva y que se pueda correr dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261029120000_embudo_versiones";
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
  if (nombre >= NUEVA) break;
  await db.exec(leer(nombre));
}
const tablasAntes = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
await db.exec(leer(NUEVA));

await prueba("solo agrega las dos tablas nuevas", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  assert.deepEqual(despues.filter((t) => !tablasAntes.includes(t)).sort(), ["EmbudoChatVersion", "EmbudoVersion"]);
  assert.ok(tablasAntes.every((t) => despues.includes(t)));
});

await prueba("no hay dos versiones con el mismo número en un producto; el chat tiene una sola fila", async () => {
  // Sin llaves por un momento: el producto real tiene muchas columnas obligatorias que aquí no importan.
  await db.exec(`SET session_replication_role = replica`);
  const ver = (id, n) => `INSERT INTO "EmbudoVersion" ("id","workspaceId","productId","numero","origen","huella","contenido") VALUES ('${id}','ws1','p1',${n},'inicial','h','{}')`;
  await db.exec(ver("v1", 1));
  await assert.rejects(() => db.exec(ver("v1b", 1)), /unique|duplicate/i);
  await db.exec(ver("v2", 2));
  await db.exec(`INSERT INTO "EmbudoChatVersion" ("conversationId","workspaceId","productId","versionId","numero") VALUES ('c1','ws1','p1','v1',1)`);
  await assert.rejects(
    () => db.exec(`INSERT INTO "EmbudoChatVersion" ("conversationId","workspaceId","productId","versionId","numero") VALUES ('c1','ws1','p1','v2',2)`),
    /unique|duplicate/i,
  );
  const [c] = await filas(`SELECT "asignadaPor" FROM "EmbudoChatVersion" WHERE "conversationId" = 'c1'`);
  assert.equal(c.asignadaPor, "vigente");
  await db.exec(`SET session_replication_role = origin`);
});

await prueba("existen los índices y las llaves", async () => {
  const nombres = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename IN ('EmbudoVersion','EmbudoChatVersion')`)).map((i) => i.indexname);
  for (const n of [
    "EmbudoVersion_productId_numero_key",
    "EmbudoVersion_workspaceId_creadoEn_idx",
    "EmbudoChatVersion_versionId_idx",
    "EmbudoChatVersion_workspaceId_productId_creadoEn_idx",
  ]) {
    assert.ok(nombres.includes(n), n);
  }
  const llaves = (await filas(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname LIKE 'Embudo%Version_%'`)).map((l) => l.conname);
  assert.ok(llaves.includes("EmbudoVersion_productId_fkey") && llaves.includes("EmbudoChatVersion_versionId_fkey"));
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  const antes = (await filas(`SELECT 1 FROM "EmbudoVersion"`)).length;
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "EmbudoVersion"`)).length, antes);
});

await prueba("es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
