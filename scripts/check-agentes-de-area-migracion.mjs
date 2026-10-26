/**
 * Prueba de la migración de los agentes de área (prisma/migrations/20261022120000_agentes_de_area) contra un
 * Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:agentes-de-area-migracion
 *
 * 1. Aplica TODAS las migraciones reales que van antes de esta, en orden.
 * 2. Aplica la nueva y comprueba las dos tablas, sus llaves, la unicidad (un resumen por negocio/área/día y
 *    una sola clave del día por envío) y que los varios BLOQUEADOS (clave en null) no estorban.
 * 3. Revisa que sea solo aditiva (el mismo detector del trabajador) y vaya en BEGIN/COMMIT.
 * 4. La vuelve a aplicar (no debe fallar ni duplicar nada ni perder filas).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261022120000_agentes_de_area";

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
  if (nombre >= NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
await db.exec(`INSERT INTO "User" ("id","email","updatedAt") VALUES ('u1','dueno@x.co', now());`).catch(() => {});
await db.exec(`INSERT INTO "Workspace" ("id","name","slug","updatedAt") VALUES ('ws1','Magilus','magilus', now());`);

const tablasAntes = (await filas(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`))[0].n;
await db.exec(leer(NUEVA));

await prueba("crea exactamente las dos tablas nuevas y no toca el resto", async () => {
  const tablasDespues = (await filas(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`))[0].n;
  assert.equal(tablasDespues, tablasAntes + 2);
  const nombres = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'AgenteDeArea%' ORDER BY 1`)).map((f) => f.table_name);
  assert.deepEqual(nombres, ["AgenteDeAreaDia", "AgenteDeAreaEnvio"]);
});

await prueba("AgenteDeAreaDia: un resumen por negocio, área y día", async () => {
  await db.exec(`INSERT INTO "AgenteDeAreaDia" ("id","workspaceId","area","fecha","updatedAt") VALUES ('d1','ws1','ventas','2026-10-26', now())`);
  await assert.rejects(() => db.exec(`INSERT INTO "AgenteDeAreaDia" ("id","workspaceId","area","fecha","updatedAt") VALUES ('d2','ws1','ventas','2026-10-26', now())`), /duplicate|unique/i);
  await db.exec(`INSERT INTO "AgenteDeAreaDia" ("id","workspaceId","area","fecha","updatedAt") VALUES ('d3','ws1','ventas','2026-10-27', now()), ('d4','ws1','marketing','2026-10-26', now())`);
  const [d1] = await filas(`SELECT "esPrueba","salioTarde" FROM "AgenteDeAreaDia" WHERE "id" = 'd1'`);
  assert.deepEqual(d1, { esPrueba: true, salioTarde: false }, "por defecto es prueba y no salió tarde");
});

await prueba("AgenteDeAreaDia: acepta JSON y rechaza un negocio que no existe", async () => {
  await db.exec(`UPDATE "AgenteDeAreaDia" SET "subagentes" = '{"cerrador":{"listas":3}}'::jsonb WHERE "id" = 'd1'`);
  const [d1] = await filas(`SELECT "subagentes" FROM "AgenteDeAreaDia" WHERE "id" = 'd1'`);
  assert.equal(d1.subagentes.cerrador.listas, 3);
  await assert.rejects(() => db.exec(`INSERT INTO "AgenteDeAreaDia" ("id","workspaceId","area","fecha","updatedAt") VALUES ('dx','nadie','ventas','2026-10-26', now())`), /foreign key|violates/i);
});

await prueba("AgenteDeAreaEnvio: no admite dos envíos con la misma clave del día", async () => {
  const insertar = (id, clave, estado = "ENVIADO") =>
    db.exec(`INSERT INTO "AgenteDeAreaEnvio" ("id","workspaceId","area","fecha","numero","tipo","texto","estado","claveDelDia","updatedAt")
             VALUES ('${id}','ws1','ventas','2026-10-26','573001112233','ALEXANDER','hola','${estado}', ${clave ? `'${clave}'` : "NULL"}, now())`);
  await insertar("e1", "ws1:ventas:2026-10-26:573001112233");
  await assert.rejects(() => insertar("e2", "ws1:ventas:2026-10-26:573001112233"), /duplicate|unique/i);
});

await prueba("AgenteDeAreaEnvio: los bloqueados (clave en null) no estorban, aunque sean varios", async () => {
  const insertar = (id) =>
    db.exec(`INSERT INTO "AgenteDeAreaEnvio" ("id","workspaceId","area","fecha","numero","tipo","texto","estado","motivo","updatedAt")
             VALUES ('${id}','ws1','ventas','2026-10-26','573120000000','ASESORA','x','BLOQUEADO','ese número no es del equipo', now())`);
  await insertar("b1");
  await insertar("b2");
  const [n] = await filas(`SELECT count(*)::int AS n FROM "AgenteDeAreaEnvio" WHERE "estado" = 'BLOQUEADO'`);
  assert.equal(n.n, 2);
});

await prueba("borrar el negocio borra sus resúmenes y envíos (ON DELETE CASCADE)", async () => {
  await db.exec(`INSERT INTO "Workspace" ("id","name","slug","updatedAt") VALUES ('ws2','Otro','otro', now())`);
  await db.exec(`INSERT INTO "AgenteDeAreaDia" ("id","workspaceId","area","fecha","updatedAt") VALUES ('o1','ws2','ventas','2026-10-26', now())`);
  await db.exec(`DELETE FROM "Workspace" WHERE "id" = 'ws2'`);
  const [n] = await filas(`SELECT count(*)::int AS n FROM "AgenteDeAreaDia" WHERE "workspaceId" = 'ws2'`);
  assert.equal(n.n, 0);
});

await prueba("se puede aplicar dos veces sin error y sin perder filas ni duplicar índices", async () => {
  const antes = (await filas(`SELECT count(*)::int AS n FROM "AgenteDeAreaDia"`))[0].n;
  await db.exec(leer(NUEVA));
  const despues = (await filas(`SELECT count(*)::int AS n FROM "AgenteDeAreaDia"`))[0].n;
  assert.equal(despues, antes);
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE tablename LIKE 'AgenteDeArea%'`);
  assert.equal(new Set(indices.map((i) => i.indexname)).size, indices.length);
});

await prueba("la migración es solo aditiva y va en BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|ALTER\s+TABLE|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")), "sin DROP, DELETE, TRUNCATE, RENAME, ALTER ni UPDATE");
  assert.equal((texto.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length, 2);
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
