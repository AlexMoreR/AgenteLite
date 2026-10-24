/**
 * Prueba de la migración del riesgo del Tablero IA (prisma/migrations/20261022210000_tablero_riesgo)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:tablero-riesgo-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta.
 * 2. Inserta una tarjeta como las de hoy (sin riesgo).
 * 3. Aplica la migración nueva y comprueba: tres columnas de texto opcionales, la tarjeta de antes
 *    intacta y sin riesgo, y que se puede guardar y leer el riesgo.
 * 4. Revisa que la migración sea aditiva (nada de DROP, DELETE, UPDATE, RENAME, TRUNCATE ni ALTER destructivo).
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
const NUEVA = "20261022210000_tablero_riesgo";

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
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo")
    VALUES ('c1', 'tab1', 'Reporte nuevo', 'POR_APROBAR', 'u-dueno', now(), 'tarea', 'aizencrm');
`);

await db.exec(leer(NUEVA));

await prueba("las tres columnas existen, son de texto y aceptan nulo", async () => {
  const columnas = await filas(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'TarjetaTablero' AND column_name IN ('riesgo', 'riesgoMotivo', 'riesgoPor') ORDER BY column_name`,
  );
  assert.deepEqual(columnas.map((c) => c.column_name), ["riesgo", "riesgoMotivo", "riesgoPor"]);
  for (const columna of columnas) {
    assert.equal(columna.data_type, "text");
    assert.equal(columna.is_nullable, "YES");
  }
});

await prueba("la tarjeta de antes sigue igual y sin riesgo (cuenta como ALTO)", async () => {
  const [tarjeta] = await filas(`SELECT * FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(tarjeta.titulo, "Reporte nuevo");
  assert.equal(tarjeta.estado, "POR_APROBAR");
  assert.equal(tarjeta.riesgo, null);
  assert.equal(riesgo.riesgoEfectivo(tarjeta.riesgo), "ALTO");
});

await prueba("se puede guardar y leer el riesgo", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "riesgo" = 'BAJO', "riesgoMotivo" = 'Un reporte nuevo', "riesgoPor" = 'CLAUDE' WHERE "id" = 'c1'`);
  const [tarjeta] = await filas(`SELECT "riesgo", "riesgoMotivo", "riesgoPor" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.deepEqual({ ...tarjeta }, { riesgo: "BAJO", riesgoMotivo: "Un reporte nuevo", riesgoPor: "CLAUDE" });
});

await prueba("la migración es solo aditiva (las mismas reglas del trabajador no ven nada destructivo)", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  assert.equal((texto.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 3);
  assert.ok(!/CREATE TYPE/i.test(texto), "no crea tipos nuevos");
});

await prueba("se puede aplicar dos veces sin error ni perder el riesgo", async () => {
  await db.exec(leer(NUEVA));
  const [tarjeta] = await filas(`SELECT "riesgo" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(tarjeta.riesgo, "BAJO");
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
