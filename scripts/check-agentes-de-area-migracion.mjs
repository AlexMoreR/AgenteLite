/**
 * Prueba de la migración de los agentes de área (prisma/migrations/20261022120000_agentes_de_area)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:agentes-de-area-migracion
 *
 * Aplica las migraciones reales que ya existen (las anteriores a la fecha de la nueva), luego la
 * nueva, y comprueba las tablas, el resumen único por día, el índice parcial de "un envío vivo por
 * número y día", que sea aditiva y que se pueda correr dos veces.
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

// Las migraciones anteriores (por orden de nombre) se aplican igual que en producción.
for (const nombre of migraciones) {
  if (nombre >= NUEVA) continue;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
const tablasAntes = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);

await db.exec(leer(NUEVA));

const dia = (id, fecha) =>
  `INSERT INTO "AgenteDeAreaDia" ("id", "workspaceId", "area", "fecha", "actualizadoEn") VALUES ('${id}', 'ws1', 'ventas', '${fecha}', now())`;
const envio = (id, numero, estado) =>
  `INSERT INTO "AgenteDeAreaEnvio" ("id", "workspaceId", "area", "fecha", "tipo", "numero", "texto", "estado")
   VALUES ('${id}', 'ws1', 'ventas', '2026-10-27', 'ASESORA', '${numero}', 'hola', '${estado}')`;

await prueba("las dos tablas existen con sus columnas obligatorias", async () => {
  for (const [tabla, obligatorias] of [
    ["AgenteDeAreaDia", ["id", "workspaceId", "area", "fecha", "esPrueba", "salioTarde", "creadoEn", "actualizadoEn"]],
    ["AgenteDeAreaEnvio", ["id", "workspaceId", "area", "fecha", "tipo", "numero", "texto", "estado", "creadoEn"]],
  ]) {
    const columnas = await filas(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = '${tabla}'`);
    const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c.is_nullable]));
    for (const columna of obligatorias) assert.equal(porNombre[columna], "NO", `${tabla}.${columna} es obligatoria`);
  }
});

await prueba("el resumen es único por negocio, área y día", async () => {
  await db.exec(dia("d1", "2026-10-27"));
  await assert.rejects(() => db.exec(dia("d2", "2026-10-27")), /duplicate|unique/i);
  await db.exec(dia("d3", "2026-10-28"));
  assert.equal((await filas(`SELECT 1 FROM "AgenteDeAreaDia"`)).length, 2);
});

await prueba("un solo envío vivo por número y día; los bloqueados y fallidos no cuentan", async () => {
  await db.exec(envio("e1", "573104445566", "ENVIADO"));
  await assert.rejects(() => db.exec(envio("e2", "573104445566", "PENDIENTE")), /duplicate|unique/i);
  await assert.rejects(() => db.exec(envio("e3", "573104445566", "ENVIADO")), /duplicate|unique/i);
  await db.exec(envio("e4", "573104445566", "BLOQUEADO"));
  await db.exec(envio("e5", "573104445566", "BLOQUEADO"));
  await db.exec(envio("e6", "573001112233", "ENVIADO"));
  // Un fallido libera el lugar: se puede reintentar.
  await db.exec(envio("e7", "573207778899", "FALLIDO"));
  await db.exec(envio("e8", "573207778899", "PENDIENTE"));
  assert.equal((await filas(`SELECT 1 FROM "AgenteDeAreaEnvio"`)).length, 6);
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "AgenteDeAreaDia"`)).length, 2);
  assert.equal((await filas(`SELECT 1 FROM "AgenteDeAreaEnvio"`)).length, 6);
});

await prueba("solo agrega: no tocó ninguna tabla anterior", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  const nuevas = despues.filter((t) => !tablasAntes.includes(t)).sort();
  assert.deepEqual(nuevas, ["AgenteDeAreaDia", "AgenteDeAreaEnvio"]);
});

await prueba("la migración es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
