/**
 * Prueba de la migración del evento de conversión (prisma/migrations/20261118000000_evento_de_conversion_meta)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:conversiones-meta-migracion
 * Revisa el texto (BEGIN/COMMIT, solo CREATE ... IF NOT EXISTS, nada destructivo), aplica las migraciones
 * reales hasta la anterior, luego la nueva, y comprueba la tabla, los índices y que se pueda correr dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261118000000_evento_de_conversion_meta";
const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

const migraciones = fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const texto = leer(NUEVA);
// Las sentencias sin comentarios, una por elemento.
const sentencias = texto
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

await prueba("va dentro de BEGIN/COMMIT", async () => {
  assert.ok(/^\s*BEGIN;/m.test(texto));
  assert.ok(/COMMIT;\s*$/.test(texto.trim()));
  assert.equal(sentencias[0], "BEGIN");
  assert.equal(sentencias.at(-1), "COMMIT");
});

await prueba("solo trae CREATE TABLE IF NOT EXISTS y CREATE [UNIQUE] INDEX IF NOT EXISTS", async () => {
  const cuerpo = sentencias.slice(1, -1);
  assert.ok(cuerpo.length >= 3);
  for (const s of cuerpo) {
    assert.ok(/^CREATE TABLE IF NOT EXISTS "EventoDeConversion" /i.test(s) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS /i.test(s), s);
  }
  assert.equal(cuerpo.filter((s) => /^CREATE TABLE/i.test(s)).length, 1);
});

await prueba("no hay DROP, ALTER, FOREIGN KEY, UPDATE ni DELETE", async () => {
  const sinComentarios = texto.replace(/^--.*$/gm, "");
  for (const palabra of [/\bDROP\b/i, /\bALTER\b/i, /\bFOREIGN\s+KEY\b/i, /\bREFERENCES\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bRENAME\b/i]) {
    assert.ok(!palabra.test(sinComentarios), String(palabra));
  }
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
});

const db = new PGlite();
const filas = async (sql) => (await db.query(sql)).rows;
for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  await db.exec(leer(nombre));
}
const tablasAntes = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
await db.exec(texto);

await prueba("solo agrega la tabla nueva", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  assert.deepEqual(despues.filter((t) => !tablasAntes.includes(t)), ["EventoDeConversion"]);
  assert.ok(tablasAntes.every((t) => despues.includes(t)));
});

await prueba("columnas obligatorias y opcionales", async () => {
  const cols = Object.fromEntries(
    (await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'EventoDeConversion'`)).map((x) => [x.column_name, x.is_nullable]),
  );
  for (const k of ["id", "workspaceId", "ventaDePautaId", "evento", "modo", "estado", "intentos", "creadoEn", "actualizadoEn"]) assert.equal(cols[k], "NO", k);
  for (const k of ["valor", "respuesta", "enviadoEn"]) assert.equal(cols[k], "YES", k);
  assert.equal(Object.keys(cols).length, 12);
});

await prueba("un solo evento por venta, tipo y modo; intentos empieza en 0", async () => {
  const meter = (id, modo) =>
    db.exec(`INSERT INTO "EventoDeConversion" ("id","workspaceId","ventaDePautaId","evento","modo","estado") VALUES ('${id}','ws1','vp1','Purchase','${modo}','ENVIADO')`);
  await meter("e1", "PRUEBA");
  await assert.rejects(() => meter("e2", "PRUEBA"), /unique|duplicate/i);
  await meter("e3", "ACTIVO");
  const [e] = await filas(`SELECT "intentos" FROM "EventoDeConversion" WHERE "id" = 'e1'`);
  assert.equal(e.intentos, 0);
});

await prueba("existen los índices", async () => {
  const nombres = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'EventoDeConversion'`)).map((i) => i.indexname);
  for (const n of ["EventoDeConversion_pkey", "EventoDeConversion_workspaceId_ventaDePautaId_evento_modo_key", "EventoDeConversion_workspaceId_estado_idx"]) {
    assert.ok(nombres.includes(n), n);
  }
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(texto);
  assert.equal((await filas(`SELECT 1 FROM "EventoDeConversion"`)).length, 2);
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
