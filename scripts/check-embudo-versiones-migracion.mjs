/**
 * Prueba de la migración de versiones del embudo (prisma/migrations/20261026120000_embudo_versiones)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:embudo-versiones-migracion
 *
 * Aplica todas las migraciones reales hasta la anterior, luego la nueva, y comprueba las dos tablas,
 * sus llaves, índices (incluido el único que frena dos versiones con el mismo número), que sea solo
 * aditiva y que se pueda correr dos veces. También prueba el script de la V1 de todos los productos.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";
import { crearVersionesIniciales } from "./crear-versiones-iniciales.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261026120000_embudo_versiones";

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
  INSERT INTO "Product" ("id", "workspaceId", "name", "price", "thumbnailUrl", "slug", "updatedAt")
    VALUES ('p1', 'ws1', 'Combo Camilla', 100, '', 'combo', now()), ('p2', 'ws1', 'Silla', 50, '', 'silla', now());
  INSERT INTO "ProductPlaybook" ("id", "workspaceId", "productId", "updatedAt") VALUES ('pb1', 'ws1', 'p1', now()), ('pb2', 'ws1', 'p2', now());
  INSERT INTO "ProductFunnelStage" ("id", "playbookId", "stage", "goal", "script", "sortOrder", "updatedAt")
    VALUES ('s1', 'pb1', 'PRESENTACION', 'Saludar', 'Hola, soy Magilus', 0, now()), ('s2', 'pb1', 'CIERRE', null, 'Cerramos', 4, now());
  INSERT INTO "ProductStageFollowUp" ("id", "stageId", "sortOrder", "timeType", "timeValue", "content", "updatedAt")
    VALUES ('f1', 's1', 0, 'HOURS', 2, '¿Sigues ahí?', now());
  INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ('producto:embudo:quitadas:p1', '["IDENTIFICACION"]', now());
`);
const productosAntes = await filas(`SELECT * FROM "Product" ORDER BY "id"`);

await db.exec(leer(NUEVA));

await prueba("EmbudoVersion tiene las columnas esperadas", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'EmbudoVersion'`,
  );
  const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  for (const obligatoria of ["id", "workspaceId", "productId", "numero", "origen", "huella", "contenido", "creadoEn"]) {
    assert.equal(porNombre[obligatoria]?.is_nullable, "NO", `${obligatoria} es obligatoria`);
  }
  for (const opcional of ["nota", "quienId", "quienNombre"]) {
    assert.equal(porNombre[opcional]?.is_nullable, "YES", `${opcional} es opcional`);
  }
  assert.equal(porNombre.contenido.data_type, "jsonb");
  assert.equal(columnas.length, 11);
});

await prueba("EmbudoChatVersion tiene las columnas esperadas y 'vigente' por defecto", async () => {
  const columnas = await filas(`SELECT column_name FROM information_schema.columns WHERE table_name = 'EmbudoChatVersion'`);
  assert.equal(columnas.length, 7);
  await db.exec(
    `INSERT INTO "EmbudoVersion" ("id", "workspaceId", "productId", "numero", "origen", "huella", "contenido") VALUES ('v1', 'ws1', 'p1', 1, 'inicial', 'h', '{}')`,
  );
  await db.exec(
    `INSERT INTO "EmbudoChatVersion" ("conversationId", "workspaceId", "productId", "versionId", "numero") VALUES ('c1', 'ws1', 'p1', 'v1', 1)`,
  );
  const [fila] = await filas(`SELECT "asignadaPor", "creadoEn" FROM "EmbudoChatVersion" WHERE "conversationId" = 'c1'`);
  assert.equal(fila.asignadaPor, "vigente");
  assert.ok(fila.creadoEn instanceof Date);
});

await prueba("no puede haber dos versiones con el mismo número en un producto", async () => {
  await assert.rejects(
    () => db.exec(`INSERT INTO "EmbudoVersion" ("id", "workspaceId", "productId", "numero", "origen", "huella", "contenido") VALUES ('v1b', 'ws1', 'p1', 1, 'mcp', 'h2', '{}')`),
    /unique|duplicate/i,
  );
  await db.exec(`INSERT INTO "EmbudoVersion" ("id", "workspaceId", "productId", "numero", "origen", "huella", "contenido") VALUES ('v2', 'ws1', 'p1', 2, 'mcp', 'h2', '{}')`);
});

await prueba("las llaves foráneas existen, borran en cascada y rechazan lo que no existe", async () => {
  const llaves = await filas(
    `SELECT c.conname, c.confdeltype, f.relname AS destino FROM pg_constraint c JOIN pg_class f ON f.oid = c.confrelid
     WHERE c.conname IN ('EmbudoVersion_productId_fkey', 'EmbudoChatVersion_versionId_fkey') AND c.contype = 'f'`,
  );
  assert.equal(llaves.length, 2);
  for (const llave of llaves) assert.equal(llave.confdeltype, "c", "ON DELETE CASCADE");
  assert.deepEqual(llaves.map((l) => l.destino).sort(), ["EmbudoVersion", "Product"]);
  await assert.rejects(
    () => db.exec(`INSERT INTO "EmbudoVersion" ("id", "workspaceId", "productId", "numero", "origen", "huella", "contenido") VALUES ('vx', 'ws1', 'nadie', 1, 'mcp', 'h', '{}')`),
    /foreign key|violates/i,
  );
});

await prueba("existen los índices", async () => {
  const indices = await filas(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('EmbudoVersion', 'EmbudoChatVersion')`);
  const def = (nombre) => indices.find((i) => i.indexname === nombre)?.indexdef ?? "";
  assert.ok(def("EmbudoVersion_productId_numero_key").includes('("productId", numero)') || def("EmbudoVersion_productId_numero_key").includes('("productId", "numero")'));
  assert.ok(def("EmbudoVersion_workspaceId_creadoEn_idx").includes('("workspaceId", "creadoEn")'));
  assert.ok(def("EmbudoChatVersion_versionId_idx").includes('("versionId")'));
  assert.ok(def("EmbudoChatVersion_workspaceId_productId_creadoEn_idx").includes('("workspaceId", "productId", "creadoEn")'));
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "EmbudoVersion"`)).length, 2);
  assert.equal((await filas(`SELECT 1 FROM "EmbudoChatVersion"`)).length, 1);
  assert.equal((await filas(`SELECT 1 FROM pg_constraint WHERE conname = 'EmbudoVersion_productId_fkey'`)).length, 1);
});

await prueba("la migración es solo aditiva, va dentro de BEGIN/COMMIT y no toca los productos", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
  assert.deepEqual(await filas(`SELECT * FROM "Product" ORDER BY "id"`), productosAntes);
});

await prueba("el script de la V1: simular no escribe; escribir crea una V1 por producto sin versión; repetir no duplica", async () => {
  await db.exec(`DELETE FROM "EmbudoVersion"`);
  const silencio = () => {};
  const simulado = await crearVersionesIniciales(db, { escribir: false }, silencio);
  assert.deepEqual(simulado, { sinVersion: 2, creadas: 0 });
  assert.equal((await filas(`SELECT 1 FROM "EmbudoVersion"`)).length, 0);

  const real = await crearVersionesIniciales(db, { escribir: true }, silencio);
  assert.deepEqual(real, { sinVersion: 2, creadas: 2 });
  const versiones = await filas(`SELECT * FROM "EmbudoVersion" ORDER BY "productId"`);
  assert.deepEqual(versiones.map((v) => [v.productId, v.numero, v.origen, v.nota]), [
    ["p1", 1, "inicial", "V1 - embudo inicial"],
    ["p2", 1, "inicial", "V1 - embudo inicial"],
  ]);
  const combo = versiones[0].contenido;
  assert.deepEqual(combo.quitadas, ["IDENTIFICACION"]);
  assert.deepEqual(combo.pasos.map((p) => p.stage), ["PRESENTACION", "CIERRE"]);
  assert.equal(combo.pasos[0].script, "Hola, soy Magilus");
  assert.equal(combo.pasos[0].seguimientos[0].content, "¿Sigues ahí?");
  assert.equal(versiones[0].huella.length, 64);

  const otraVez = await crearVersionesIniciales(db, { escribir: true }, silencio);
  assert.deepEqual(otraVez, { sinVersion: 0, creadas: 0 });
  assert.equal((await filas(`SELECT 1 FROM "EmbudoVersion"`)).length, 2);
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
