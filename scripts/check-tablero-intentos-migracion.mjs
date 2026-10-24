/**
 * Prueba de la migración de intentos del Tablero IA
 * (prisma/migrations/20261024120000_tablero_intentos) contra un Postgres embebido (PGlite), sin tocar
 * ninguna base real:
 *   npm run test:tablero-intentos-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía, hasta la anterior a esta.
 * 2. Inserta datos como los de hoy: un negocio, un tablero, tarjetas y flechas.
 * 3. Aplica la migración nueva y comprueba: tabla nueva con sus restricciones, columnas nuevas con su valor
 *    inicial, y nada perdido ni borrado.
 * 4. Revisa que la migración sea aditiva (sin DROP, DELETE, TRUNCATE ni RENAME) y con BEGIN/COMMIT.
 * 5. La vuelve a aplicar (no debe fallar ni duplicar nada).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261024120000_tablero_intentos";

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

// Se aplican en orden las anteriores a esta (las posteriores, si algún día existen, se ensayan en su propia prueba).
for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.indexOf(NUEVA)} migraciones anteriores`);

// ── Datos de antes de la migración ─────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Ventas');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId") VALUES
    ('c1', 'tab1', 'Agente de Ventas', 'ERROR', 'u-dueno', now(), 'tarea'),
    ('c2', 'tab1', 'Agente de Marketing', 'APROBADO', 'u-dueno', now(), 'tarea'),
    ('c3', 'tab1', 'Cerebro', 'HECHO', 'u-dueno', now(), 'tarea');
  INSERT INTO "ConexionTarjeta" ("id", "tableroId", "origenId", "destinoId") VALUES
    ('f1', 'tab1', 'c1', 'c2'), ('f2', 'tab1', 'c2', 'c3');
  INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues") VALUES
    ('h1', 'c3', 'u-dueno', 'PANTALLA', 'aprobar', '{"estado":"APROBADO"}');
`);
const tarjetasAntes = await filas(`SELECT "id", "estado", "titulo", "intentos" FROM "TarjetaTablero" ORDER BY "id"`);
const flechasAntes = await filas(`SELECT "id", "origenId", "destinoId" FROM "ConexionTarjeta" ORDER BY "id"`);

await prueba("la migración es aditiva: sin DROP, DELETE, TRUNCATE ni RENAME, y con BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA)
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .replace(/ON (DELETE|UPDATE) CASCADE/gi, "");
  assert.doesNotMatch(texto, /\b(DROP|DELETE|TRUNCATE|RENAME|UPDATE)\b/i);
  assert.match(texto, /^BEGIN;$/m);
  assert.match(texto, /^COMMIT;$/m);
  assert.match(texto, /IF NOT EXISTS/);
});

// ── La migración nueva ─────────────────────────────────────────────────────────────────────
await db.exec(leer(NUEVA));

await prueba("lo de antes sigue igual: tarjetas, flechas e historial, sin borrar nada", async () => {
  const tarjetas = await filas(`SELECT "id", "estado", "titulo", "intentos" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.deepEqual(tarjetas, tarjetasAntes);
  const flechas = await filas(`SELECT "id", "origenId", "destinoId" FROM "ConexionTarjeta" ORDER BY "id"`);
  assert.deepEqual(flechas, flechasAntes);
  const [{ h }] = await filas(`SELECT count(*)::int AS h FROM "HistorialTarjeta"`);
  assert.equal(h, 1);
});

await prueba("las tarjetas de antes quedan en 0 reparaciones y las flechas sin dependencia", async () => {
  for (const t of await filas(`SELECT "reparaciones" FROM "TarjetaTablero"`)) assert.equal(t.reparaciones, 0);
  const flechas = await filas(`SELECT "esDependencia" FROM "ConexionTarjeta"`);
  assert.equal(flechas.length, 2);
  for (const f of flechas) assert.equal(f.esDependencia, false);
});

await prueba("columnas nuevas: tipo, nulo y valor inicial correctos", async () => {
  const columnas = await filas(`
    SELECT table_name, column_name, is_nullable, data_type, column_default FROM information_schema.columns
    WHERE (table_name = 'TarjetaTablero' AND column_name = 'reparaciones')
       OR (table_name = 'ConexionTarjeta' AND column_name = 'esDependencia')`);
  const mapa = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  assert.equal(mapa.reparaciones.data_type, "integer");
  assert.equal(mapa.reparaciones.is_nullable, "NO");
  assert.equal(mapa.reparaciones.column_default, "0");
  assert.equal(mapa.esDependencia.data_type, "boolean");
  assert.equal(mapa.esDependencia.is_nullable, "NO");
  assert.equal(mapa.esDependencia.column_default, "false");
});

await prueba("IntentoTarjeta: columnas esperadas, cuentaComoIntento verdadero por defecto y creadoEn automático", async () => {
  const columnas = (
    await filas(`SELECT column_name FROM information_schema.columns WHERE table_name = 'IntentoTarjeta'`)
  ).map((c) => c.column_name);
  for (const c of ["id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn"]) {
    assert.ok(columnas.includes(c), `falta la columna ${c}`);
  }
  await db.exec(`INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "accion")
    VALUES ('i1', 'c1', 1, 'EN_CURSO', 'PRUEBAS', 'Falló una prueba', 'REPARAR')`);
  const [fila] = await filas(`SELECT "error", "cuentaComoIntento", "creadoEn" FROM "IntentoTarjeta" WHERE "id" = 'i1'`);
  assert.equal(fila.error, null);
  assert.equal(fila.cuentaComoIntento, true);
  assert.ok(fila.creadoEn);
});

await prueba("IntentoTarjeta: exige tarjeta existente y cae junto con la tarjeta", async () => {
  await assert.rejects(
    db.query(`INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "accion")
      VALUES ('i2', 'nadie', 1, 'EN_CURSO', 'PRUEBAS', 'x', 'REPARAR')`),
    /foreign key/i,
  );
  await assert.rejects(
    db.query(`INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa")
      VALUES ('i3', 'c1', 2, 'EN_CURSO', 'PRUEBAS', 'x')`),
    /null value|not-null/i,
    "la acción es obligatoria",
  );
  await db.exec(`INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId")
    VALUES ('c9', 'tab1', 'Temporal', 'IDEA', 'u-dueno', now(), 'tarea')`);
  await db.exec(`INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "accion", "cuentaComoIntento")
    VALUES ('i4', 'c9', 1, 'PLANEANDO', 'LIMITE_CLAUDE', 'Límite de uso', 'ESPERAR', false)`);
  await db.exec(`DELETE FROM "TarjetaTablero" WHERE "id" = 'c9'`);
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "IntentoTarjeta" WHERE "tarjetaId" = 'c9'`);
  assert.equal(n, 0);
  const [{ queda }] = await filas(`SELECT count(*)::int AS queda FROM "IntentoTarjeta" WHERE "id" = 'i1'`);
  assert.equal(queda, 1);
});

await prueba("existe el índice por tarjeta y fecha", async () => {
  const indices = await filas(`SELECT indexname FROM pg_indexes WHERE tablename = 'IntentoTarjeta'`);
  assert.ok(indices.some((i) => i.indexname === "IntentoTarjeta_tarjetaId_creadoEn_idx"));
});

await prueba("aplicarla otra vez no falla ni duplica ni pierde nada", async () => {
  await db.exec(leer(NUEVA));
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "IntentoTarjeta"`);
  assert.equal(n, 1);
  assert.deepEqual(await filas(`SELECT "id", "estado", "titulo", "intentos" FROM "TarjetaTablero" WHERE "id" <> 'c9' ORDER BY "id"`), tarjetasAntes);
  const [{ d }] = await filas(`SELECT count(*)::int AS d FROM "ConexionTarjeta" WHERE "esDependencia" = false`);
  assert.equal(d, 2);
});

await db.close();
console.log(`\n${pruebas} pruebas, todas bien`);
