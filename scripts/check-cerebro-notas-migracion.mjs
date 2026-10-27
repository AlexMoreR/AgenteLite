/**
 * Prueba de la migración de las notas nuevas del cerebro (prisma/migrations/20261030120000_cerebro_notas_por_crear)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:cerebro-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta, e inserta datos como los de hoy.
 * 2. Aplica la nueva: la tabla CerebroNotaPorCrear con sus columnas, valores por defecto e índice, y NADA de lo que
 *    existía cambió (ni una fila, ni una tabla, ni una columna).
 * 3. Es aditiva (el detector de SQL destructivo del trabajador), va en BEGIN/COMMIT y se puede aplicar dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261030120000_cerebro_notas_por_crear";
const TABLA = "CerebroNotaPorCrear";

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
  INSERT INTO "CerebroConexion" ("id", "workspaceId", "carpetaId", "actualizadoEn") VALUES ('c1', 'ws1', 'raiz', now());
  INSERT INTO "CerebroDocumento" ("id", "workspaceId", "driveId", "nombre", "ruta", "tipo") VALUES ('d1', 'ws1', 'drv1', 'a.md', 'a.md', 'text/markdown');
`);

async function foto() {
  const tablas = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`)).map((t) => t.table_name);
  const resultado = {};
  for (const tabla of tablas) {
    const columnas = await filas(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`, [tabla]);
    const contenido = await filas(`SELECT * FROM "${tabla}" ORDER BY 1`);
    resultado[tabla] = { columnas, contenido: JSON.stringify(contenido) };
  }
  return resultado;
}

const antes = await foto();
assert.ok(!(TABLA in antes), `${TABLA} no debería existir antes`);
await db.exec(leer(NUEVA));

await prueba("la tabla nueva existe con sus columnas", async () => {
  const reales = (await filas(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [TABLA])).map((c) => c.column_name).sort();
  assert.deepEqual(
    reales,
    ["id", "workspaceId", "ruta", "contenido", "estado", "motivo", "userId", "quienNombre", "origen", "tarjetaId", "creadoEn", "actualizadoEn", "creadaEn"].sort(),
  );
});

await prueba("NADA de lo que existía cambió: ni tablas, ni columnas, ni filas", async () => {
  const despues = await foto();
  for (const tabla of Object.keys(antes)) assert.deepEqual(despues[tabla], antes[tabla], `la tabla ${tabla} cambió`);
  assert.deepEqual(Object.keys(despues).filter((t) => !(t in antes)), [TABLA], "solo aparece la tabla nueva");
});

await prueba("un pedido nuevo queda PENDIENTE con su fecha; se marca CREADA o ERROR con motivo", async () => {
  await db.exec(`INSERT INTO "${TABLA}" ("id", "workspaceId", "ruta", "contenido", "origen") VALUES ('n1', 'ws1', 'Decisiones de Magilus.md', '### 2026-10-26\nUna', 'MCP')`);
  const [nota] = await filas(`SELECT "estado", "motivo", "creadoEn", "actualizadoEn", "creadaEn" FROM "${TABLA}" WHERE "id" = 'n1'`);
  assert.equal(nota.estado, "PENDIENTE");
  assert.equal(nota.motivo, null);
  assert.equal(nota.creadaEn, null);
  assert.ok(nota.creadoEn && nota.actualizadoEn);
  await db.exec(`UPDATE "${TABLA}" SET "estado" = 'CREADA', "creadaEn" = now() WHERE "id" = 'n1' AND "estado" = 'PENDIENTE'`);
  const [creada] = await filas(`SELECT "estado", "creadaEn" FROM "${TABLA}" WHERE "id" = 'n1'`);
  assert.equal(creada.estado, "CREADA");
  assert.ok(creada.creadaEn);
});

await prueba("existe el índice para pedir las pendientes del negocio en orden", async () => {
  const reales = await filas(`SELECT indexname FROM pg_indexes WHERE indexname = 'CerebroNotaPorCrear_workspaceId_estado_creadoEn_idx'`);
  assert.equal(reales.length, 1);
});

await prueba("se puede aplicar dos veces sin error ni perder lo escrito", async () => {
  await db.exec(leer(NUEVA));
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "${TABLA}"`);
  assert.equal(n, 1);
});

await prueba("la migración es solo aditiva, va en BEGIN/COMMIT y no toca tablas que ya existían", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  const sinComentarios = texto.replace(/^--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET|ALTER\s+TABLE)\b/i.test(sinComentarios));
  assert.deepEqual([...sinComentarios.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]), [TABLA]);
  assert.ok(!/CREATE TABLE "/.test(sinComentarios) && !/CREATE INDEX "/.test(sinComentarios), "todo con IF NOT EXISTS");
});

await prueba("schema.prisma tiene el modelo con las mismas columnas", () => {
  const schema = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const bloque = schema.match(/model CerebroNotaPorCrear \{([\s\S]*?)\n\}/);
  assert.ok(bloque, "falta el modelo");
  for (const campo of ["workspaceId", "ruta", "contenido", "estado", "motivo", "userId", "quienNombre", "origen", "tarjetaId", "creadoEn", "actualizadoEn", "creadaEn"]) {
    assert.match(bloque[1], new RegExp(`\\n\\s+${campo}\\s`), `falta ${campo}`);
  }
});

console.log(`\n${pruebas} pruebas pasaron`);
