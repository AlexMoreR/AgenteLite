/**
 * Prueba de la migración de los eventos de conversión para Meta
 * (prisma/migrations/20261118000000_evento_de_conversion_meta), sin tocar ninguna base real:
 *   npm run test:conversiones-meta-migracion
 * Lee el migration.sql y comprueba que sea solo aditiva (CREATE TABLE / CREATE INDEX con IF NOT EXISTS,
 * dentro de BEGIN/COMMIT). Después la aplica dos veces en un Postgres embebido (PGlite).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NUEVA = "20261118000000_evento_de_conversion_meta";
const ARCHIVO = path.join(RAIZ, "prisma", "migrations", NUEVA, "migration.sql");
const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

assert.ok(fs.existsSync(ARCHIVO), `falta la migración ${NUEVA}`);
const texto = fs.readFileSync(ARCHIVO, "utf8");
const sinComentarios = texto.replace(/^\s*--.*$/gm, "");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("va dentro de BEGIN/COMMIT", async () => {
  assert.ok(/^\s*BEGIN;/m.test(sinComentarios), "falta BEGIN;");
  assert.ok(/COMMIT;\s*$/.test(sinComentarios.trim()), "falta COMMIT; al final");
});

await prueba("solo trae CREATE TABLE IF NOT EXISTS y CREATE [UNIQUE] INDEX IF NOT EXISTS", async () => {
  const sentencias = sinComentarios.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of sentencias) {
    const ok = /^(BEGIN|COMMIT)$/i.test(s)
      || /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"EventoDeConversion"\s*\(/i.test(s)
      || /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"[\w]+"\s+ON\s+"EventoDeConversion"/i.test(s);
    assert.ok(ok, `sentencia no permitida: ${s.slice(0, 80)}`);
  }
  assert.equal(sentencias.filter((s) => /^CREATE\s+TABLE/i.test(s)).length, 1);
  assert.equal(sentencias.filter((s) => /^CREATE\s+UNIQUE\s+INDEX/i.test(s)).length, 1);
  assert.equal(sentencias.filter((s) => /^CREATE\s+INDEX/i.test(s)).length, 1);
});

await prueba("no hay DROP, ALTER, FOREIGN KEY, UPDATE ni DELETE", async () => {
  assert.ok(!/\b(DROP|ALTER|FOREIGN\s+KEY|REFERENCES|UPDATE|DELETE|TRUNCATE|RENAME)\b/i.test(sinComentarios));
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
});

const db = new PGlite();
const filas = async (sql) => (await db.query(sql)).rows;

await prueba("se aplica dos veces sin error, con sus columnas e índices", async () => {
  await db.exec(texto);
  await db.exec(`INSERT INTO "EventoDeConversion" ("id","workspaceId","ventaDePautaId","evento","modo","estado") VALUES ('e1','ws1','vp1','Purchase','PRUEBA','ENVIADO')`);
  await db.exec(texto);
  assert.equal((await filas(`SELECT 1 FROM "EventoDeConversion"`)).length, 1);
  const cols = Object.fromEntries((await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'EventoDeConversion'`)).map((c) => [c.column_name, c.is_nullable]));
  for (const c of ["id", "workspaceId", "ventaDePautaId", "evento", "modo", "estado", "intentos", "creadoEn", "actualizadoEn"]) assert.equal(cols[c], "NO", c);
  for (const c of ["valor", "respuesta", "enviadoEn"]) assert.equal(cols[c], "YES", c);
  const [fila] = await filas(`SELECT "intentos" FROM "EventoDeConversion" WHERE "id" = 'e1'`);
  assert.equal(fila.intentos, 0);
  const nombres = (await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'EventoDeConversion'`)).map((i) => i.indexname);
  for (const n of ["EventoDeConversion_workspaceId_ventaDePautaId_evento_modo_key", "EventoDeConversion_workspaceId_estado_idx"]) assert.ok(nombres.includes(n), n);
});

await prueba("una sola fila por venta, evento y modo (PRUEBA y ACTIVO son distintas)", async () => {
  const meter = (id, modo) => db.exec(`INSERT INTO "EventoDeConversion" ("id","workspaceId","ventaDePautaId","evento","modo","estado") VALUES ('${id}','ws1','vp1','Purchase','${modo}','ENVIADO')`);
  await assert.rejects(() => meter("e2", "PRUEBA"), /unique|duplicate/i);
  await meter("e3", "ACTIVO");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
