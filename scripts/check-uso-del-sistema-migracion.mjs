/**
 * Prueba de la migración del contador de uso (prisma/migrations/20261023120000_uso_del_sistema)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:uso-del-sistema-migracion
 *
 * Aplica las migraciones reales anteriores, luego la nueva, y comprueba la tabla, que no admita filas
 * repetidas, que sea aditiva y que se pueda correr dos veces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261023120000_uso_del_sistema";

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

const fila = (id, extra = {}) => {
  const v = { fecha: "2026-10-27", tipo: "PANTALLA", clave: "/cliente/crm/tablero", quien: "ana", ...extra };
  return `INSERT INTO "UsoDelSistemaDia" ("id", "workspaceId", "fecha", "tipo", "clave", "quien", "actualizadoEn")
   VALUES ('${id}', 'ws1', '${v.fecha}', '${v.tipo}', '${v.clave}', '${v.quien}', now())`;
};

await prueba("la tabla existe con sus columnas obligatorias y 'veces' empieza en 1", async () => {
  const columnas = await filas(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'UsoDelSistemaDia'`);
  const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  for (const columna of ["id", "workspaceId", "fecha", "tipo", "clave", "quien", "veces", "creadoEn", "actualizadoEn"]) assert.equal(porNombre[columna]?.is_nullable, "NO", `${columna} es obligatoria`);
  assert.equal(porNombre.veces.column_default, "1");
});

await prueba("no admite filas repetidas por negocio, día, tipo, clave y persona", async () => {
  await db.exec(fila("u1"));
  await assert.rejects(() => db.exec(fila("u2")), /duplicate|unique/i);
  await db.exec(fila("u3", { quien: "luis" }));
  await db.exec(fila("u4", { fecha: "2026-10-28" }));
  await db.exec(fila("u5", { tipo: "HERRAMIENTA", clave: "ver_tablero" }));
  assert.equal((await filas(`SELECT 1 FROM "UsoDelSistemaDia"`)).length, 4);
});

await prueba("sumar al contador (upsert) deja una fila con veces = 2", async () => {
  const sumar = `INSERT INTO "UsoDelSistemaDia" ("id", "workspaceId", "fecha", "tipo", "clave", "quien", "actualizadoEn")
    VALUES ('n1', 'ws1', '2026-10-29', 'PANTALLA', '/cliente/crm/embudo', 'ana', now())
    ON CONFLICT ("workspaceId", "fecha", "tipo", "clave", "quien") DO UPDATE SET "veces" = "UsoDelSistemaDia"."veces" + 1`;
  await db.exec(sumar);
  await db.exec(sumar);
  assert.deepEqual((await filas(`SELECT "veces" FROM "UsoDelSistemaDia" WHERE "id" = 'n1'`)).map((r) => r.veces), [2]);
});

await prueba("se puede aplicar dos veces sin error ni perder filas", async () => {
  const antes = (await filas(`SELECT 1 FROM "UsoDelSistemaDia"`)).length;
  await db.exec(leer(NUEVA));
  assert.equal((await filas(`SELECT 1 FROM "UsoDelSistemaDia"`)).length, antes);
});

await prueba("solo agrega: no tocó ninguna tabla anterior", async () => {
  const despues = (await filas(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((t) => t.table_name);
  assert.deepEqual(despues.filter((t) => !tablasAntes.includes(t)).sort(), ["UsoDelSistemaDia"]);
});

await prueba("la migración es solo aditiva y va dentro de BEGIN/COMMIT", async () => {
  const texto = leer(NUEVA);
  assert.deepEqual(riesgo.destructivoDelSql(texto), []);
  assert.ok(/^\s*BEGIN;/m.test(texto) && /COMMIT;\s*$/.test(texto.trim()));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|RENAME|UPDATE\s+"?\w+"?\s+SET)\b/i.test(texto.replace(/^--.*$/gm, "")));
});

console.log(`\n${pruebas} pruebas pasaron`);
await db.close();
