/**
 * Prueba de la migración del Cerebro (prisma/migrations/20261026120000_cerebro) contra un Postgres embebido
 * (PGlite), sin tocar ninguna base real:
 *   npm run test:cerebro-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta.
 * 2. Inserta datos como los de hoy (usuario, negocio, tablero y tarjetas) y guarda una foto de todas las tablas.
 * 3. Aplica la migración nueva y comprueba: las 3 tablas nuevas con sus columnas, los índices únicos, y que NADA de lo
 *    que existía cambió (ni una fila, ni una tabla, ni una columna).
 * 4. Revisa que sea aditiva (el mismo detector de SQL destructivo del trabajador) y vaya en BEGIN/COMMIT.
 * 5. La vuelve a aplicar (no debe fallar ni duplicar nada).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261026120000_cerebro";
const TABLAS_NUEVAS = ["CerebroConexion", "CerebroDocumento", "CerebroCambio"];

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
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Ventas');
  INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ('cerebro:autorizados:ws1', '[]', now());
`);

/** Una foto de TODAS las tablas que existen: sus columnas y sus filas. */
async function foto() {
  const tablas = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`)).map((t) => t.table_name);
  const resultado = {};
  for (const tabla of tablas) {
    const columnas = (await filas(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`, [tabla]));
    const contenido = await filas(`SELECT * FROM "${tabla}" ORDER BY 1`);
    resultado[tabla] = { columnas, contenido: JSON.stringify(contenido) };
  }
  return resultado;
}

const antes = await foto();
for (const tabla of TABLAS_NUEVAS) assert.ok(!(tabla in antes), `${tabla} no debería existir antes`);

await db.exec(leer(NUEVA));

await prueba("las 3 tablas nuevas existen con sus columnas", async () => {
  const esperadas = {
    CerebroConexion: ["id", "workspaceId", "cuentaGoogle", "tokenCifrado", "carpetaId", "carpetaNombre", "conectadoPor", "ultimaSincronizacion", "ultimoError", "creadoEn", "actualizadoEn"],
    CerebroDocumento: ["id", "workspaceId", "driveId", "padreId", "nombre", "ruta", "tipo", "esCarpeta", "modificadoEnDrive", "versionDrive", "linkDrive", "texto", "textoTruncado", "enDrive", "sincronizadoEn"],
    CerebroCambio: ["id", "workspaceId", "userId", "quienNombre", "origen", "driveId", "nombreDocumento", "accion", "antes", "despues", "textoConfirmacion", "tarjetaId", "creadoEn"],
  };
  for (const [tabla, columnas] of Object.entries(esperadas)) {
    const reales = (await filas(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [tabla])).map((c) => c.column_name).sort();
    assert.deepEqual(reales, [...columnas].sort(), `columnas de ${tabla}`);
  }
});

await prueba("NADA de lo que existía cambió: ni tablas, ni columnas, ni filas", async () => {
  const despues = await foto();
  for (const tabla of Object.keys(antes)) assert.deepEqual(despues[tabla], antes[tabla], `la tabla ${tabla} cambió`);
  assert.deepEqual(Object.keys(despues).filter((t) => !(t in antes)).sort(), [...TABLAS_NUEVAS].sort(), "solo aparecen las 3 tablas nuevas");
});

await prueba("una conexión por negocio y un documento por (negocio, id de Drive)", async () => {
  await db.exec(`INSERT INTO "CerebroConexion" ("id", "workspaceId", "actualizadoEn") VALUES ('c1', 'ws1', now())`);
  await assert.rejects(() => db.exec(`INSERT INTO "CerebroConexion" ("id", "workspaceId", "actualizadoEn") VALUES ('c2', 'ws1', now())`), /unique|duplicate/i);
  await db.exec(`INSERT INTO "CerebroDocumento" ("id", "workspaceId", "driveId", "nombre", "ruta", "tipo") VALUES ('d1', 'ws1', 'drv1', 'a.md', 'a.md', 'text/markdown')`);
  await assert.rejects(
    () => db.exec(`INSERT INTO "CerebroDocumento" ("id", "workspaceId", "driveId", "nombre", "ruta", "tipo") VALUES ('d2', 'ws1', 'drv1', 'a.md', 'a.md', 'text/markdown')`),
    /unique|duplicate/i,
  );
  const [documento] = await filas(`SELECT "enDrive", "esCarpeta", "textoTruncado" FROM "CerebroDocumento" WHERE "id" = 'd1'`);
  assert.deepEqual(documento, { enDrive: true, esCarpeta: false, textoTruncado: false }, "valores por defecto");
});

await prueba("el registro de cambios guarda quién, cuándo, el antes y el después", async () => {
  await db.exec(
    `INSERT INTO "CerebroCambio" ("id", "workspaceId", "userId", "quienNombre", "origen", "driveId", "nombreDocumento", "accion", "antes", "despues", "textoConfirmacion", "tarjetaId")
     VALUES ('x1', 'ws1', 'u-dueno', 'Alexander', 'MCP', 'drv1', 'a.md', 'agregar', 'antes', 'después', 'sí, escríbelo en el cerebro', 't1')`,
  );
  const [cambio] = await filas(`SELECT "quienNombre", "origen", "antes", "despues", "creadoEn" FROM "CerebroCambio" WHERE "id" = 'x1'`);
  assert.equal(cambio.quienNombre, "Alexander");
  assert.equal(cambio.antes, "antes");
  assert.ok(cambio.creadoEn);
});

await prueba("existen los índices", async () => {
  const esperados = [
    "CerebroConexion_workspaceId_key",
    "CerebroDocumento_workspaceId_driveId_key",
    "CerebroDocumento_workspaceId_padreId_idx",
    "CerebroDocumento_workspaceId_enDrive_idx",
    "CerebroCambio_workspaceId_creadoEn_idx",
    "CerebroCambio_workspaceId_driveId_idx",
  ];
  const reales = (await filas(`SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`, [esperados])).map((i) => i.indexname).sort();
  assert.deepEqual(reales, [...esperados].sort());
});

await prueba("se puede aplicar dos veces sin error ni perder lo escrito", async () => {
  await db.exec(leer(NUEVA));
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "CerebroCambio"`);
  assert.equal(n, 1);
  const indices = await filas(`SELECT 1 FROM pg_indexes WHERE indexname = 'CerebroDocumento_workspaceId_driveId_key'`);
  assert.equal(indices.length, 1, "no duplicó el índice");
});

await prueba("la migración es solo aditiva, va en BEGIN/COMMIT y no toca tablas que ya existían", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  const sinComentarios = texto.replace(/^--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET|ALTER\s+TABLE)\b/i.test(sinComentarios), "sin DROP, DELETE FROM, TRUNCATE, RENAME, UPDATE ni ALTER TABLE");
  const creadas = [...sinComentarios.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(creadas, [...TABLAS_NUEVAS].sort());
  assert.ok(!/CREATE TABLE "/.test(sinComentarios), "todas las tablas con IF NOT EXISTS");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
