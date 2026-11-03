// La migración del Coach con Opus tiene que ser solo aditiva (parte 1, 3-nov-2026): lee el SQL y falla
// si hay algo distinto de CREATE TABLE / CREATE [UNIQUE] INDEX (y BEGIN/COMMIT). Por ejemplo DROP,
// ALTER, DELETE o UPDATE. Sin base. Correr: npm run test:coach-opus-migracion
import fs from "node:fs";
import assert from "node:assert/strict";

const ARCHIVO = "prisma/migrations/20261102220000_coach_revision_opus/migration.sql";

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Quita los comentarios y parte el SQL en sentencias. */
function sentencias(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const PERMITIDAS = [/^BEGIN$/i, /^COMMIT$/i, /^CREATE TABLE IF NOT EXISTS "CoachRevision" \(/i, /^CREATE (UNIQUE )?INDEX IF NOT EXISTS "\w+" ON "CoachRevision"\s*\(/i];
const PROHIBIDAS = /\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT|RENAME|GRANT|REVOKE|REFERENCES|FOREIGN KEY)\b/i;

function revisar(sql) {
  const malas = [];
  for (const s of sentencias(sql)) {
    if (!PERMITIDAS.some((p) => p.test(s)) || PROHIBIDAS.test(s)) malas.push(s.slice(0, 120));
  }
  return malas;
}

prueba("la revisión de sentencias atrapa lo que no es aditivo", () => {
  assert.deepEqual(revisar('BEGIN; CREATE INDEX IF NOT EXISTS "x" ON "CoachRevision"("a"); COMMIT;'), []);
  for (const mala of [
    'DROP TABLE "CoachInforme";',
    'ALTER TABLE "CoachRevision" ADD COLUMN "x" TEXT;',
    'DELETE FROM "AppSetting";',
    'UPDATE "User" SET "name" = 1;',
    'CREATE TABLE IF NOT EXISTS "Otra" ("id" TEXT);',
    'CREATE TABLE IF NOT EXISTS "CoachRevision" ("id" TEXT REFERENCES "User"("id"));',
  ]) {
    assert.equal(revisar(mala).length, 1, mala);
  }
});

const sql = fs.readFileSync(ARCHIVO, "utf8");

prueba("la migración solo crea la tabla CoachRevision y sus índices", () => {
  const malas = revisar(sql);
  assert.deepEqual(malas, [], `sentencias no permitidas:\n${malas.join("\n")}`);
});

prueba("va dentro de BEGIN/COMMIT y con IF NOT EXISTS", () => {
  const lista = sentencias(sql);
  assert.match(lista[0], /^BEGIN$/i);
  assert.match(lista.at(-1), /^COMMIT$/i);
  for (const s of lista.slice(1, -1)) assert.match(s, /IF NOT EXISTS/i, s);
});

prueba("trae las columnas y los dos índices del plan", () => {
  for (const columna of ["id", "workspaceId", "fecha", "userId", "nombre", "modelo", "resumen", "chats", "chatsLeidos", "avisadoEn", "creadoEn", "actualizadoEn"]) {
    assert.match(sql, new RegExp(`"${columna}" `), `falta la columna ${columna}`);
  }
  assert.match(sql, /"chats" JSONB/);
  assert.match(sql, /"avisadoEn" TIMESTAMP\(3\),/);
  assert.match(sql, /"creadoEn" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "\w+"\s+ON "CoachRevision"\("workspaceId", "fecha", "userId"\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "\w+"\s+ON "CoachRevision"\("workspaceId", "userId", "fecha"\)/);
});

console.log(`\n${pruebas} pruebas ok`);
