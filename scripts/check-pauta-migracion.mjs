/**
 * Prueba de la migración del origen de pauta (prisma/migrations/20261027120000_origen_de_pauta)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:pauta-migracion
 * Aplica las migraciones reales hasta la anterior, luego la nueva, y comprueba las dos tablas, los
 * índices únicos, que sea aditiva y que se pueda correr dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261027120000_origen_de_pauta";
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
  if (nombre === NUEVA) break;
  await db.exec(leer(nombre));
}
const tablasAntes = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
await db.exec(leer(NUEVA));

await prueba("solo agrega las dos tablas nuevas", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  assert.deepEqual(despues.filter((t) => !tablasAntes.includes(t)).sort(), ["OrigenDePauta", "VentaDePauta"]);
  assert.ok(tablasAntes.every((t) => despues.includes(t)));
});

await prueba("columnas obligatorias y opcionales", async () => {
  const cols = async (tabla) =>
    Object.fromEntries((await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = '${tabla}'`)).map((c) => [c.column_name, c.is_nullable]));
  const o = await cols("OrigenDePauta");
  for (const c of ["id", "workspaceId", "contactId", "anuncioId", "llegoEn"]) assert.equal(o[c], "NO", c);
  for (const c of ["conversationId", "anuncioNombre", "conjuntoId", "conjuntoNombre", "campanaId", "campanaNombre", "red", "ctwaClid", "campanaConsultadaEn"]) assert.equal(o[c], "YES", c);
  const v = await cols("VentaDePauta");
  for (const c of ["id", "workspaceId", "ventaGestionId", "pagadaEn", "categoria"]) assert.equal(v[c], "NO", c);
  for (const c of ["cotizacion", "telefono", "monto", "contactId", "origenDePautaId"]) assert.equal(v[c], "YES", c);
});

await prueba("un solo origen por cliente y una sola fila por venta de Gestión", async () => {
  await db.exec(`INSERT INTO "OrigenDePauta" ("id","workspaceId","contactId","anuncioId","llegoEn") VALUES ('o1','ws1','ct1','A1',now())`);
  await assert.rejects(() => db.exec(`INSERT INTO "OrigenDePauta" ("id","workspaceId","contactId","anuncioId","llegoEn") VALUES ('o2','ws1','ct1','A2',now())`), /unique|duplicate/i);
  await db.exec(`INSERT INTO "OrigenDePauta" ("id","workspaceId","contactId","anuncioId","llegoEn") VALUES ('o3','ws2','ct1','A1',now())`);
  await db.exec(`INSERT INTO "VentaDePauta" ("id","workspaceId","ventaGestionId","pagadaEn") VALUES ('v1','ws1','G-1',now())`);
  await assert.rejects(() => db.exec(`INSERT INTO "VentaDePauta" ("id","workspaceId","ventaGestionId","pagadaEn") VALUES ('v2','ws1','G-1',now())`), /unique|duplicate/i);
  const [v] = await filas(`SELECT "categoria" FROM "VentaDePauta" WHERE "id" = 'v1'`);
  assert.equal(v.categoria, "ORGANICO_OTRO");
});

await prueba("existen los índices", async () => {
  const nombres = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename IN ('OrigenDePauta','VentaDePauta')`)).map((i) => i.indexname);
  for (const n of ["OrigenDePauta_workspaceId_contactId_key", "OrigenDePauta_workspaceId_llegoEn_idx", "OrigenDePauta_workspaceId_anuncioId_idx", "VentaDePauta_workspaceId_ventaGestionId_key", "VentaDePauta_workspaceId_pagadaEn_idx"]) {
    assert.ok(nombres.includes(n), n);
  }
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "OrigenDePauta"`)).length, 2);
  assert.equal((await filas(`SELECT 1 FROM "VentaDePauta"`)).length, 1);
});

await prueba("es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|ALTER\s+TABLE|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
