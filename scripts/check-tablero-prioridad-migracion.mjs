/**
 * Prueba de la migración de la prioridad del Tablero IA (prisma/migrations/20261121000000_tarjeta_prioridad)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:tablero-prioridad-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta.
 * 2. Inserta tarjetas como las de hoy (sin prioridad), una de ellas marcada urgente.
 * 3. Aplica la migración nueva y comprueba: una columna de texto NOT NULL con valor por defecto MEDIA, las tarjetas de
 *    antes intactas y en MEDIA (la marcada urgente sigue contando como Urgente), y que se puede guardar la prioridad.
 * 4. Revisa que la migración sea aditiva (nada de DROP, DELETE, UPDATE, RENAME, TRUNCATE ni ALTER destructivo).
 * 5. La vuelve a aplicar (no debe fallar ni cambiar nada).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261121000000_tarjeta_prioridad";

const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");
const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

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
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea', 'tab1', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "urgente")
    VALUES ('c1', 'tab1', 'Reporte nuevo', 'APROBADO', 'u-dueno', now(), 'tarea', 'aizencrm', false),
           ('c2', 'tab1', 'Se cae el login', 'APROBADO', 'u-dueno', now(), 'tarea', 'aizencrm', true);
`);

await db.exec(leer(NUEVA));

await prueba("la columna prioridad existe, es de texto, NOT NULL y con valor por defecto MEDIA", async () => {
  const [columna] = await filas(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'TarjetaTablero' AND column_name = 'prioridad'`,
  );
  assert.ok(columna, "existe la columna");
  assert.equal(columna.data_type, "text");
  assert.equal(columna.is_nullable, "NO");
  assert.match(columna.column_default, /'MEDIA'/);
  assert.equal(trabajo.PRIORIDAD_POR_DEFECTO, "MEDIA", "el mismo valor por defecto que el código");
});

await prueba("las tarjetas de antes quedan intactas y en MEDIA; la marcada urgente sigue contando como Urgente", async () => {
  const lista = await filas(`SELECT "id", "titulo", "estado"::text AS "estado", "urgente", "prioridad" FROM "TarjetaTablero" ORDER BY "id"`);
  assert.deepEqual(
    lista.map((t) => [t.id, t.titulo, t.estado, t.urgente, t.prioridad]),
    [
      ["c1", "Reporte nuevo", "APROBADO", false, "MEDIA"],
      ["c2", "Se cae el login", "APROBADO", true, "MEDIA"],
    ],
  );
  assert.equal(trabajo.prioridadDeLaFila(lista[0]), 2, "Media");
  assert.equal(trabajo.prioridadDeLaFila(lista[1]), 0, "la marca urgente es Urgente");
});

await prueba("se puede guardar y leer la prioridad; una tarjeta nueva sin prioridad queda en MEDIA", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "prioridad" = 'URGENTE' WHERE "id" = 'c1'`);
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo")
      VALUES ('c3', 'tab1', 'Nueva', 'IDEA', 'u-dueno', now(), 'tarea', 'aizencrm')`);
  const lista = await filas(`SELECT "id", "prioridad" FROM "TarjetaTablero" WHERE "id" IN ('c1', 'c3') ORDER BY "id"`);
  assert.deepEqual(lista.map((t) => [t.id, t.prioridad]), [["c1", "URGENTE"], ["c3", "MEDIA"]]);
});

await prueba("la migración es solo aditiva: una columna con valor por defecto, dentro de BEGIN/COMMIT y con IF NOT EXISTS", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()), "va dentro de BEGIN/COMMIT");
  const sentencias = texto
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--") && linea.trim())
    .join("\n");
  assert.equal(
    sentencias,
    `BEGIN;\nALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "prioridad" TEXT NOT NULL DEFAULT 'MEDIA';\nCOMMIT;`,
    "solo agrega la columna",
  );
  assert.ok(!/CREATE TYPE|CREATE INDEX|UPDATE /i.test(sentencias), "no crea tipos ni índices y no toca datos");
});

await prueba("se puede aplicar dos veces sin error ni perder la prioridad", async () => {
  await db.exec(leer(NUEVA));
  const [tarjeta] = await filas(`SELECT "prioridad" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(tarjeta.prioridad, "URGENTE");
});

await prueba("schema.prisma declara la columna con el mismo valor por defecto", async () => {
  const schema = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const modelo = schema.slice(schema.indexOf("model TarjetaTablero {"));
  assert.match(modelo.slice(0, modelo.indexOf("\n}")), /\n\s+prioridad\s+String\s+@default\("MEDIA"\)/);
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
